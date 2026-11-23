#!/usr/bin/env node
// Isolated mainnet connectivity credential. Never imported into work/financial flows.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../src/store.mjs';
import {VanClient} from '../src/api.mjs';
import {NETWORK,ENVIRONMENT} from '../src/network.mjs';
import {canonical} from '../src/canonical.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const prefix='THE VAN readiness credential only. This key cannot authorize work, admission, orders or payments.\n\n';
export function validateReadinessChallenge(ch,requestId,keyHash,qualificationRef,now=Date.now()){
 if(ENVIRONMENT!=='mainnet'||!ch||ch.scope!=='readiness-only'||ch.signingMethod!=='personal_sign'||ch.accessGranted!==false||!uuid(ch.challengeId)||typeof ch.message!=='string'||!ch.message.startsWith(prefix))throw Error('Invalid readiness challenge');
 const p=JSON.parse(ch.message.slice(prefix.length));
 if(Object.keys(p).sort().join(',')!=='action,audience,chainId,challengeId,expiresAt,keyHash,qualificationRef,requestId,scope'||p.action!=='van.readiness-credential.v1'||p.chainId!==8453||p.audience!==NETWORK.audience||p.scope!=='readiness-only'||p.challengeId!==ch.challengeId||p.requestId!==requestId||p.keyHash!==keyHash||p.qualificationRef!==qualificationRef||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=now||Date.parse(p.expiresAt)>now+330000||Date.parse(p.expiresAt)!==Date.parse(ch.expiresAt)||ch.message!==prefix+canonical(p))throw Error('Invalid readiness signing context');
 return ch;
}
export class ReadinessClient{
 constructor({fetchImpl=fetch}={}){if(ENVIRONMENT!=='mainnet')throw Error('Use explicit VAN_NETWORK=mainnet');this.fetch=fetchImpl;this.context=new VanClient({fetchImpl});}
 async request(path,body,token){
 if(!['/readiness/challenge','/readiness/prove','/readiness/me','/readiness/heartbeat'].includes(path))throw Error('Readiness route required');
 if(token!==undefined&&!/^van_ready_[a-f0-9]{64}$/.test(token))throw Error('Readiness token required; never reuse a work token');
 await this.context.context();
 const r=await this.fetch(NETWORK.audience+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const reader=r.body.getReader(),chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw Error('Readiness response too large');}chunks.push(value);}
 const out=JSON.parse(Buffer.concat(chunks).toString());if(!r.ok)throw Error('Readiness HTTP '+r.status+': '+(/^[a-z_]{1,80}$/.test(out.error)?out.error:'request_failed'));return out;
 }
}
async function main(){
 const [command,...args]=process.argv.slice(2);
 if(!['init','challenge','prove','status','heartbeat'].includes(command))throw Error('Use init REQUEST_ID QUALIFICATION_REF | challenge | prove PROOF.json | status | heartbeat');
 if(!process.env.VAN_READINESS_STATE_DIR||ENVIRONMENT!=='mainnet')throw Error('Set VAN_NETWORK=mainnet and separate private VAN_READINESS_STATE_DIR');
 const root=resolve(process.env.VAN_READINESS_STATE_DIR);if(process.env.VAN_STATE_DIR&&root===resolve(process.env.VAN_STATE_DIR))throw Error('Readiness state must be separate from work state');
 const store=new Store(root);await store.init();const release=await store.lock();
 try{
 if(await store.read('identity.json')||await store.read('credential.json'))throw Error('Working connector state directory refused');
 const client=new ReadinessClient();let state=await store.read('readiness.json');
 if(command==='init'){
  if(state||await store.read('readiness-key.json'))throw Error('Existing readiness state preserved; do not reset');
  if(args.length!==2||!uuid(args[0])||!/^[a-f0-9]{64}$/.test(args[1]))throw Error('Verified request UUID and qualification reference required');
  const token='van_ready_'+randomBytes(32).toString('hex');state={requestId:args[0],qualificationRef:args[1],keyHash:createHash('sha256').update(token).digest('hex'),instanceId:randomUUID(),chainId:8453,audience:NETWORK.audience,scope:'readiness-only'};
  await store.write('readiness.json',state);await store.write('readiness-key.json',{token});console.log(JSON.stringify({initialized:true,scope:'readiness-only',tokenPrinted:false}));return;
 }
 if(!state||state.chainId!==8453||state.audience!==NETWORK.audience||state.scope!=='readiness-only')throw Error('Matching readiness state required');
 const key=await store.read('readiness-key.json');if(!key||createHash('sha256').update(key.token).digest('hex')!==state.keyHash)throw Error('Readiness key mismatch; preserve state');
 if(command==='challenge'){
  const ch=validateReadinessChallenge(await client.request('/readiness/challenge',{requestId:state.requestId,keyHash:state.keyHash}),state.requestId,state.keyHash,state.qualificationRef);
  await store.write('readiness-challenge.json',ch);console.log(JSON.stringify({signingRequestFile:store.path('readiness-challenge.json'),scope:'readiness-only',note:'Inspect exact message and sign locally; no payment or work authorization.'}));
 }else if(command==='prove'){
  if(args.length!==1)throw Error('Private proof file required');const bytes=await readFile(args[0]);if(bytes.length>2048)throw Error('Proof too large');const proof=JSON.parse(bytes.toString());const ch=await store.read('readiness-challenge.json');
  // Exact persisted proof may be replayed even if the read-only challenge expired after an accepted reply.
  const old=await store.read('readiness-proof.json');if(old&&canonical(old)!==canonical(proof))throw Error('Pending proof differs; reconcile before replacement');
  if(!ch||proof.challengeId!==ch.challengeId||Object.keys(proof).sort().join(',')!=='challengeId,signature'||!/^0x[a-f0-9]{130}$/i.test(proof.signature??''))throw Error('Proof does not match saved readiness challenge');
  if(!old)validateReadinessChallenge(ch,state.requestId,state.keyHash,state.qualificationRef);
  await store.write('readiness-proof.json',proof);const result=await client.request('/readiness/prove',proof);if(result.scope!=='readiness-only'||result.accessGranted!==false||result.workEnabled!==false||result.paymentsEnabled!==false)throw Error('Unexpected readiness grant');await store.write('readiness-proof-result.json',result);console.log(JSON.stringify(result));
 }else{
  const result=command==='status'?await client.request('/readiness/me',undefined,key.token):await client.request('/readiness/heartbeat',{instanceId:state.instanceId,slots:1,minRewardAtomic:'170000'},key.token);
  if(result.scope!=='readiness-only'||result.workEnabled!==false||result.paymentsEnabled!==false||result.admissionEnabled!==false)throw Error('Unexpected readiness status');
  await store.write('readiness-status.json',result);console.log(JSON.stringify(result));
 }
 }finally{await release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
