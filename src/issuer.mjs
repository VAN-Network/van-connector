import{request as httpRequest}from'node:http';
import{isAbsolute,dirname}from'node:path';import{lstat}from'node:fs/promises';
import{createHash}from'node:crypto';import{canonical}from'./canonical.mjs';import{ENVIRONMENT,NETWORK}from'./network.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v),hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),hash=v=>typeof v==='string'&&/^0x[a-f0-9]{64}$/.test(v);
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex');
const kinds={work:'worker_submission',claim:'review_claim',witness:'witness_fetch',review:'review_decision',renew:'review_renewal'};
export function eventSigningRequest(authorityId,body){return{domain:{name:'VAN Independent Settlement Events',version:'1',chainId:84532,salt:'0x'+sha({authorityId,audience:NETWORK.audience})},primaryType:'VANEvent',types:{VANEvent:[{name:'bodyHash',type:'bytes32'}]},message:{bodyHash:'0x'+sha(body)}};}
export class IssuerClient{
 constructor({socketPath,authorityId,requestImpl=httpRequest}={}){
  if(ENVIRONMENT!=='testnet')throw Error('Direct issuer events are testnet-only');if(!isAbsolute(socketPath??'')||socketPath.length>100||!uuid(authorityId))throw Error('Private issuer socket and pinned authority ID required');this.socketPath=socketPath;this.authorityId=authorityId;this.requestImpl=requestImpl;
 }
 binding(){return{protocol:'van-direct-events-v1',environmentId:'testnet',chainId:84532,audience:NETWORK.audience,authorityId:this.authorityId,socketPath:this.socketPath};}
 async context(){
  if(!this.checked)this.checked=this.#transport('GET','/descriptor').then(d=>{if(canonical(d)!==canonical({version:1,environmentId:'testnet',chainId:84532,audience:NETWORK.audience,authorityId:this.authorityId,protocol:'van-direct-events-v1'}))throw Error('Independent issuer descriptor mismatch');return d;}).catch(e=>{this.checked=undefined;throw e;});return this.checked;
 }
 async exchange(orderId,action,input){if(!uuid(orderId)||!Object.hasOwn(kinds,action.replace(/-request$/,'')))throw Error('Unsupported independent event route');await this.context();return this.#transport('POST','/orders/'+orderId+'/'+action,input);}
 async #transport(method,path,input){
  const stat=await lstat(this.socketPath),parent=await lstat(dirname(this.socketPath));if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o077)||![0,process.getuid()].includes(parent.uid)||!stat.isSocket()||stat.isSymbolicLink()||(stat.mode&0o077)||![0,process.getuid()].includes(stat.uid))throw Error('Unsafe independent issuer socket');
  const body=input===undefined?undefined:JSON.stringify(input);if(body&&Buffer.byteLength(body)>262144)throw Error('Independent event too large');
  return new Promise((resolve,reject)=>{const req=this.requestImpl({socketPath:this.socketPath,path,method,agent:false,timeout:15000,headers:{Host:'van-issuer.local',Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})}},r=>{const parts=[];let size=0;r.on('data',chunk=>{size+=chunk.length;if(size>262144){r.destroy();reject(Error('Independent response too large'));}else parts.push(chunk);});r.on('error',()=>reject(Error('Independent channel unavailable')));r.on('end',()=>{if(r.statusCode!==200){reject(Error('Independent issuer refused event (HTTP '+r.statusCode+')'));return;}try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(Error('Invalid independent response'));}});});req.on('timeout',()=>req.destroy());req.on('error',()=>reject(Error('Independent channel unavailable')));req.end(body);});
 }
}
export class GatewayIssuerClient{
 constructor({api,authorityId}={}){if(ENVIRONMENT!=='testnet'||!api||typeof api.request!=='function'||!uuid(authorityId))throw Error('Testnet API and pinned authority required');this.api=api;this.authorityId=authorityId;}
 binding(){return{protocol:'van-public-events-v1',environmentId:'testnet',chainId:84532,audience:NETWORK.audience,authorityId:this.authorityId};}
 async context(){if(!this.checked)this.checked=this.api.request('/events/v1/descriptor',undefined,{auth:false}).then(d=>{if(canonical(d)!==canonical({version:1,...this.binding(),issuerProtocol:'van-direct-events-v1'}))throw Error('Public event descriptor mismatch');return d;}).catch(e=>{this.checked=undefined;throw e;});return this.checked;}
 async exchange(orderId,action,input){if(!uuid(orderId)||!['work','claim','witness','review','work-request','claim-request','witness-request','review-request','renew','renew-request'].includes(action))throw Error('Unsupported public event route');await this.context();return this.api.request('/events/v1/orders/'+orderId+'/'+action,input);}
 eventPayload(state){return{event:state.request.body,input:state.input,signature:state.proof.signature};}
}
export async function discoverIssuerAssignment(api,{orderId,authorityId,role,wallet}){
 if(!uuid(orderId)||!uuid(authorityId)||!['worker','reviewer'].includes(role)||!/^0x[a-f0-9]{40}$/i.test(wallet))throw Error('Pinned order, authority, role and own wallet required');
 const client=new GatewayIssuerClient({api,authorityId});await client.context();const r=await api.request('/events/v1/orders/'+orderId+'/assignment');
 if(!r||Object.keys(r).sort().join(',')!=='anchor,audience,authorityId,chainId,environmentId,version'||r.version!=='van-participant-assignment-v1'||r.environmentId!=='testnet'||r.chainId!==84532||r.audience!==NETWORK.audience||r.authorityId!==authorityId||r.anchor?.orderId!==orderId||r.anchor?.role!==role||r.anchor?.wallet!==wallet.toLowerCase())throw Error('Discovered assignment changed pinned participant scope');
 const a=anchorFor(r.anchor,client);delete a.authorityId;return{authorityId,anchor:a};
}
function eventInput(action,input){
 const fields={work:['markdown'],claim:[],witness:['url'],review:['verdict','reason','checks'],renew:['leaseId','attempt','previousExpiresAt','renewalSequence']}[action];
 if(!fields||!input||Array.isArray(input)||Object.keys(input).sort().join(',')!==fields.sort().join(','))throw Error('Independent input contains unsupported fields');
 if(action==='work'&&(typeof input.markdown!=='string'||!input.markdown.trim()||Buffer.byteLength(input.markdown)>65536)||action==='witness'&&(typeof input.url!=='string'||input.url.length>4096)||action==='review'&&(typeof input.reason!=='string'||input.reason.length>2000||!Array.isArray(input.checks)||input.checks.length>32))throw Error('Invalid independent event input');
 return JSON.parse(canonical(input));
}
function anchorFor(value,client){
 if(!value||Object.keys(value).some(k=>!['orderId','quoteHash','briefHash','fundingTxHash','fundingLogIndex','role','wallet','submissionHash'].includes(k))||!uuid(value.orderId)||!hash(value.quoteHash)||!hex(value.briefHash)||!hash(value.fundingTxHash)||!/^\d{1,10}$/.test(value.fundingLogIndex)||!['worker','reviewer'].includes(value.role)||!/^0x[a-f0-9]{40}$/i.test(value.wallet)||(value.role==='reviewer'&&!hex(value.submissionHash)))throw Error('Exact independent assignment anchor required');
 return{...value,wallet:value.wallet.toLowerCase(),authorityId:client.authorityId};
}
export function validateEventRequest(response,anchor,action,input){
 const b=response?.body,base=['schema','authorityId','environmentId','audience','orderId','quoteHash','briefHash','fundingTxHash','fundingLogIndex','kind'];const fields=action==='renew'?['leaseId','attempt','submissionHash','renewalSequence','previousExpiresAt','observedAt','expiresAt','processingDeadline','hardDeadline']:action==='work'?['workId','workDeadline','submissionHash']:action==='claim'?['attempt','leaseId','reviewDeadline','submissionHash']:action==='witness'?['leaseId','attempt','submissionHash','url']:['leaseId','attempt','submissionHash','verdict','reason','checks','witnessHash'];
 if(!b||Object.keys(b).sort().join(',')!==[...base,...fields].sort().join(',')||b.schema!=='van-issuer-event-v1'||b.authorityId!==anchor.authorityId||b.environmentId!=='testnet'||b.audience!==NETWORK.audience||b.kind!==kinds[action]||['orderId','quoteHash','briefHash','fundingTxHash','fundingLogIndex'].some(k=>b[k]!==anchor[k])||canonical(response.signing)!==canonical(eventSigningRequest(anchor.authorityId,b)))throw Error('Independent signing request changed scope');
 if((action==='work')!==(anchor.role==='worker')||action==='work'&&(!uuid(b.workId)||!Number.isSafeInteger(b.workDeadline)||b.workDeadline<=0||typeof input.markdown!=='string'||createHash('sha256').update(input.markdown).digest('hex')!==b.submissionHash)||action!=='work'&&(!uuid(b.leaseId)||!Number.isInteger(b.attempt)||b.attempt<1||b.attempt>9||b.submissionHash!==anchor.submissionHash))throw Error('Independent signing request changed assignment');
 if(action==='claim'&&(!Number.isSafeInteger(b.reviewDeadline)||b.reviewDeadline<=0)||action==='witness'&&b.url!==input.url)throw Error('Independent event details changed');
 if(action==='renew'&&(['leaseId','attempt','previousExpiresAt','renewalSequence'].some(k=>b[k]!==input[k])||!['renewalSequence','previousExpiresAt','observedAt','expiresAt','processingDeadline','hardDeadline'].every(k=>Number.isSafeInteger(b[k]))||b.renewalSequence<1||b.renewalSequence>120||b.expiresAt<=b.previousExpiresAt||b.expiresAt>b.hardDeadline||b.processingDeadline>b.hardDeadline||b.expiresAt>b.observedAt+180000||b.processingDeadline>b.observedAt+600000))throw Error('Independent renewal changed lease bounds');
 if(action==='review'){
  if(!['ACCEPT','REJECT','INCONCLUSIVE'].includes(input.verdict)||!Array.isArray(input.checks))throw Error('Invalid independent review');const checks=input.checks.map(c=>({...c,evidenceIds:[...new Set(c.evidenceIds.map(id=>id.toLowerCase()))].sort(),quote:c.quote??null}));
  if(b.verdict!==input.verdict||b.reason!==input.reason||canonical(b.checks)!==canonical(checks)||!hex(b.witnessHash))throw Error('Independent review decision changed');
 }
 return response;
}
export async function prepareIssuerEvent(client,store,label,anchorInput,action,input){
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(label)||!Object.hasOwn(kinds,action))throw Error('Independent event name/action required');input=eventInput(action,input);const anchor=anchorFor(JSON.parse(canonical(anchorInput)),client),release=await store.lock();
 try{const file='issuer-'+label+'.json',binding=client.binding();let state=await store.read(file);if(state&&(canonical(state.anchor)!==canonical(anchor)||canonical(state.binding)!==canonical(binding)||state.action!==action||canonical(state.input)!==canonical(input)))throw Error('Independent event is frozen; use its original binding and input');
  if(!state){state={binding,anchor,action,input};await store.write(file,state);}if(!state.request){state.request=validateEventRequest(await client.exchange(anchor.orderId,action+'-request',input),anchor,action,input);await store.write(file,state);}else validateEventRequest(state.request,anchor,action,input);
  return{eventHash:sha(state.request.body),expectedSigner:anchor.wallet,body:state.request.body,signing:state.request.signing,note:'Sign this exact non-payment EIP-712 event locally; never send your private key.'};
 }finally{await release();}
}
function validReviewAcknowledgement(state,result,eventHash){
 if(result?.version==='van-local-review-pending-v1')return Object.keys(result).sort().join(',')==='attempt,completedReviews,eventHash,leaseId,orderId,outcome,version'&&state.input.verdict==='INCONCLUSIVE'&&result.outcome==='INCONCLUSIVE'&&result.eventHash===eventHash&&result.orderId===state.anchor.orderId&&result.leaseId===state.request.body.leaseId&&result.attempt===state.request.body.attempt&&[1,2].includes(result.completedReviews);
 return result?.version==='van-local-settlement-plan-v1'&&result.outcome===state.input.verdict&&result.evidenceHash===eventHash&&Array.isArray(result.operations)&&result.operations.length===2&&result.operations.every(o=>o.orderId===state.anchor.orderId&&o.fundingTxHash===state.anchor.fundingTxHash&&o.fundingLogIndex===state.anchor.fundingLogIndex&&'0x'+sha(o.quote)===state.anchor.quoteHash);
}
export async function submitIssuerEvent(client,store,label,proof){
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(label))throw Error('Independent event name required');if(proof)proof=JSON.parse(canonical(proof));const release=await store.lock();try{const file='issuer-'+label+'.json',state=await store.read(file);if(!state?.request||canonical(state.binding)!==canonical(client.binding()))throw Error('Prepare the bound independent event first');eventInput(state.action,state.input);validateEventRequest(state.request,state.anchor,state.action,state.input);const eventHash=sha(state.request.body);
  if(!state.proof){if(!proof||Object.keys(proof).sort().join(',')!=='eventHash,signature'||proof.eventHash!==eventHash||!/^0x[a-f0-9]{130}$/i.test(proof.signature))throw Error('Exact {eventHash,signature} required');state.proof=proof;await store.write(file,state);}else if(proof&&canonical(proof)!==canonical(state.proof))throw Error('Independent signature is frozen; replacement refused');
  if(state.proof.eventHash!==eventHash||!/^0x[a-f0-9]{130}$/i.test(state.proof.signature))throw Error('Retained independent signature changed context');
  const payload=client.eventPayload?client.eventPayload(state):['claim','renew'].includes(state.action)?{body:state.request.body,signature:state.proof.signature}:{...state.input,signature:state.proof.signature};const result=await client.exchange(state.anchor.orderId,state.action,payload);
  if(state.action==='work'&&canonical(result)!==canonical(state.request.body)||state.action==='claim'&&(result.id!==state.request.body.leaseId||result.attempt!==state.request.body.attempt||!Number.isSafeInteger(result.expiresAt)||result.expiresAt>state.request.body.reviewDeadline)||state.action==='witness'&&(!uuid(result.id)||result.source_url!==state.input.url)||state.action==='renew'&&(result?.version!=='van-review-renewal-v1'||result.eventHash!==eventHash||result.orderId!==state.anchor.orderId||['leaseId','attempt','renewalSequence','expiresAt','processingDeadline','hardDeadline'].some(k=>result[k]!==state.request.body[k]))||state.action==='review'&&!validReviewAcknowledgement(state,result,eventHash))throw Error('Independent acknowledgement changed event context');
  state.result=result;await store.write(file,state);return result;
 }finally{await release();}
}
