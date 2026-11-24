import{createServer}from'node:http';import{randomUUID,createHash}from'node:crypto';import{Store}from'../../src/store.mjs';import{canonical}from'../../src/canonical.mjs';
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex'),source='https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId';
export async function officialReport(){const r=await fetch(source,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'text/markdown'}});if(!r.ok)throw Error('fixture_source_unavailable');const reader=r.body.getReader(),parts=[];let bytes=0;try{for(;;){const x=await reader.read();if(x.done)break;bytes+=x.value.length;if(bytes>1048576)throw Error('fixture_source_too_large');parts.push(x.value);}}finally{await reader.cancel().catch(()=>{});}if(!Buffer.concat(parts).toString('utf8').includes('(84532) for Base Sepolia'))throw Error('fixture_quote_not_found');return'Base Sepolia uses chain ID **84532**. The official documentation states “(84532) for Base Sepolia”. Source: '+source;}
export async function startA2AFixture({stateDir,report=officialReport,dropFirstPoll=true,onPollDrop=()=>{},port=0}){
 const store=new Store(stateDir);await store.init();const old=await store.read('peer.json'),generation=(await store.read('generation.json'))?.generation??0;let origin,tail=Promise.resolve();
 const server=createServer((req,res)=>{const run=tail.then(()=>handle(req,res));tail=run.catch(()=>{if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'fixture_request_failed'}));}else res.destroy();});});
 function send(res,id,result){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({jsonrpc:'2.0',id,result}));}
 async function handle(req,res){
  if(req.headers.host!==new URL(origin).host||req.headers.origin||req.headers.authorization||req.headers.cookie||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){res.writeHead(403);res.end();return;}
  if(req.method==='GET'&&req.url==='/.well-known/agent-card.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({protocolVersion:'0.3.0',name:'VAN-owned A2A research fixture',description:'Controlled Base Sepolia research fixture; no external ownership claim.',version:'1.0.0',url:origin+'/a2a',preferredTransport:'JSONRPC',capabilities:{streaming:false,pushNotifications:false},security:[],defaultInputModes:['application/json'],defaultOutputModes:['application/json'],skills:[{id:'van-research-report-v1',name:'Public research report',description:'VAN-owned test fixture only',tags:['testnet'],examples:[]}]}));return;}
  if(req.method!=='POST'||req.url!=='/a2a'){res.writeHead(404);res.end();return;}const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>98304){res.writeHead(413);res.end();return;}parts.push(part);}const rpc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));if(rpc.jsonrpc!=='2.0'||typeof rpc.id!=='string')throw Error('bad_rpc');
  if(rpc.method==='message/send'){
   const m=rpc.params?.message,data=m?.parts?.[0]?.data;
   if(m?.kind!=='message'||m.role!=='user'||!/^[-a-f0-9]{36}$/.test(m.messageId)||m.parts.length!==1||m.parts[0].kind!=='data'||data?.schema!=='van.research-report.request.v1'||data.binding?.environmentId!=='testnet'||data.binding?.audience!=='https://test-api.thevan.app'||data.binding.role!=='worker'||sha(data.binding)!==data.bindingHash||sha(data.brief)!==data.binding.briefHash||data.brief.visibility!=='public'||Date.parse(data.binding.workDeadline)<=Date.now())throw Error('bad_fixture_request');
   let state=await store.read('task.json');if(state){if(state.messageId!==m.messageId||state.requestHash!==sha(rpc))throw Error('fixture_one_task_only');state.sendCalls++;}else state={messageId:m.messageId,requestHash:sha(rpc),sendCalls:1,pollCalls:0,droppedPolls:0,researchRuns:0,data,task:{kind:'task',id:randomUUID(),contextId:randomUUID(),status:{state:'working'},metadata:{vanBindingHash:data.bindingHash}}};
   await store.write('task.json',state);send(res,rpc.id,state.task);return;
  }
  if(rpc.method==='tasks/get'){
   const state=await store.read('task.json');if(!state||rpc.params?.id!==state.task.id)throw Error('fixture_task_not_found');state.pollCalls++;
   if(dropFirstPoll&&state.droppedPolls===0){state.droppedPolls=1;await store.write('task.json',state);res.destroy();onPollDrop();return;}
   if(state.task.status.state!=='completed'){const markdown=await report(state.data);state.researchRuns++;state.task.status={state:'completed',timestamp:new Date().toISOString()};state.task.artifacts=[{artifactId:'report',parts:[{kind:'data',data:{schema:'van.research-report.result.v1',bindingHash:state.data.bindingHash,markdown}}]}];}
   await store.write('task.json',state);send(res,rpc.id,state.task);return;
  }
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,error:{code:-32601,message:'Unsupported method'}}));
 }
 server.requestTimeout=20000;server.headersTimeout=5000;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(old?Number(new URL(old.endpoint).port):port,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 const peer={cardUrl:origin+'/.well-known/agent-card.json',endpoint:origin+'/a2a',protocolVersion:'0.3.0',transport:'loopback-testnet',consentRef:'van-owned-a2a-fixture-20261124',skill:'van-research-report-v1'};await store.write('peer.json',peer);await store.write('generation.json',{generation:generation+1});
 return{peer,store,server,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
