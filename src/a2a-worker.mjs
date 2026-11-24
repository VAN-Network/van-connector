import {randomUUID,createHash} from 'node:crypto';
import {Store} from './store.mjs';
import {canonical} from './canonical.mjs';
import {ENVIRONMENT,NETWORK} from './network.mjs';
import {workerReport} from './worker.mjs';
import {validateA2APeer,createA2ATransport} from './a2a-transport.mjs';
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex');
const label=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!/[\u0000-\u001f]/.test(v);
const states=['submitted','working','input-required','auth-required','completed','canceled','failed','rejected','unknown'];

export class A2AWorker{
 constructor(bridge,peer,{transport}={}){if(ENVIRONMENT!=='testnet'||bridge.config.role!=='worker')throw Error('a2a_testnet_worker_only');this.bridge=bridge;this.peer=validateA2APeer(peer);this.transport=transport??createA2ATransport(this.peer);this.store=new Store(bridge.config.stateDir+'/a2a-tasks');}
 async init(){await this.store.init();}
 async card(){const c=await this.transport(this.peer.cardUrl);if(c?.protocolVersion!=='0.3.0'||c.url!==this.peer.endpoint||(c.preferredTransport??'JSONRPC')!=='JSONRPC'||(c.security?.length??0)||(c.securityRequirements?.length??0)||!c.skills?.some(s=>s.id===this.peer.skill)||!c.defaultInputModes?.includes('application/json')||!c.defaultOutputModes?.includes('application/json'))throw Error('a2a_peer_card_mismatch');}
 rpcReply(reply,id){if(reply?.jsonrpc!=='2.0'||reply.id!==id||reply.error!==undefined)throw Error('a2a_rpc_context_refused');return reply.result;}
 validateTask(task,state){if(task?.kind!=='task'||!label(task.id)||!label(task.contextId)||!states.includes(task.status?.state)||task.metadata?.vanBindingHash!==state.bindingHash||state.taskId&&task.id!==state.taskId||state.contextId&&task.contextId!==state.contextId)throw Error('a2a_task_context_refused');}
 async current(id,state,file){try{const c=await this.bridge.current(id);if(!c)throw Error('assignment_not_ready');return c;}catch{if(state){state.phase='late';state.error='van_assignment_unavailable';await this.store.write(file,state);}throw Error('a2a_van_assignment_unavailable');}}
 async step(id){
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('invalid_assignment_id');const unlock=await this.store.lock(),file='task-'+id+'.json';
  try{
   let state=await this.store.read(file);const c=await this.current(id,state,file),brief=c.assignment.brief;
   if(brief?.visibility!=='public'||Object.keys(brief).some(k=>!['brief','language','acceptanceCriteria','platformCriteria','publicListing','visibility','budgetAtomic'].includes(k)))throw Error('a2a_public_brief_required');
   const binding={environmentId:'testnet',audience:NETWORK.audience,role:'worker',jobId:c.jobId,assignmentId:id,briefHash:sha(brief),workDeadline:c.active.assignment.workDeadline};
   if(!Number.isFinite(Date.parse(binding.workDeadline))||Date.parse(binding.workDeadline)<=Date.now())throw Error('a2a_work_deadline_expired');
   const bindingHash=sha(binding),peerHash=sha(this.peer);
   if(state&&(state.bindingHash!==bindingHash||state.peerHash!==peerHash))throw Error('a2a_frozen_context_changed');
   if(!state){
    const data={schema:'van.research-report.request.v1',binding,bindingHash,brief};
    if(Buffer.byteLength(canonical(data))>24576||/\bvan_[0-9a-f]{64}\b|\b0x[0-9a-f]{64}\b|\bsk-[a-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(canonical(data)))throw Error('a2a_public_payload_refused');
    state={version:1,assignmentId:id,jobId:c.jobId,bindingHash,peerHash,phase:'prepared',request:{jsonrpc:'2.0',id:randomUUID(),method:'message/send',params:{message:{kind:'message',role:'user',messageId:randomUUID(),parts:[{kind:'data',data}]},configuration:{blocking:false,historyLength:0,acceptedOutputModes:['application/json']}}}};await this.store.write(file,state);
   }
   if(state.phase==='ready')return{phase:'ready',jobId:c.jobId,taskId:state.taskId,contextId:state.contextId,markdown:state.markdown,untrustedRemoteText:true};
   if(['sending','uncertain'].includes(state.phase))throw Error('a2a_initial_send_uncertain_no_resubmit');
   if(['late','failed','refused','paused'].includes(state.phase))throw Error('a2a_task_requires_reconciliation');
   try{await this.card();}catch(e){if(state.phase==='waiting'&&['a2a_network_error','a2a_rate_limited'].includes(e.message)){state.pollFailures=(state.pollFailures??0)+1;await this.store.write(file,state);return{phase:'waiting',taskId:state.taskId,contextId:state.contextId,retrySameTask:true};}throw e;}await this.current(id,state,file);let task;
   if(state.phase==='prepared'){
    state.phase='sending';await this.store.write(file,state);
    try{task=this.rpcReply(await this.transport(this.peer.endpoint,state.request),state.request.id);this.validateTask(task,state);}
    catch{state.phase='uncertain';await this.store.write(file,state);throw Error('a2a_initial_send_uncertain_no_resubmit');}
    state.taskId=task.id;state.contextId=task.contextId;state.phase='waiting';await this.store.write(file,state);
   }else{
    const rpc={jsonrpc:'2.0',id:randomUUID(),method:'tasks/get',params:{id:state.taskId,historyLength:0}};
    try{task=this.rpcReply(await this.transport(this.peer.endpoint,rpc),rpc.id);}
    catch(e){if(['a2a_network_error','a2a_rate_limited'].includes(e.message)){state.pollFailures=(state.pollFailures??0)+1;await this.store.write(file,state);return{phase:'waiting',taskId:state.taskId,contextId:state.contextId,retrySameTask:true};}throw e;}
    try{this.validateTask(task,state);}catch{state.phase='refused';await this.store.write(file,state);throw Error('a2a_task_context_refused');}
   }
   await this.current(id,state,file);
   if(task.status.state==='completed'){
    const a=task.artifacts;
    if(!Array.isArray(a)||a.length!==1||!label(a[0].artifactId)||!Array.isArray(a[0].parts)||a[0].parts.length!==1||a[0].parts[0].kind!=='data')throw Error('a2a_inline_artifact_required');
    const data=a[0].parts[0].data;
    if(!data||Object.keys(data).sort().join(',')!=='bindingHash,markdown,schema'||data.schema!=='van.research-report.result.v1'||data.bindingHash!==bindingHash)throw Error('a2a_artifact_context_refused');
    state.markdown=workerReport({markdown:data.markdown});state.phase='ready';state.artifactHash=sha(data);await this.store.write(file,state);
    return{phase:'ready',jobId:c.jobId,taskId:state.taskId,contextId:state.contextId,markdown:state.markdown,untrustedRemoteText:true};
   }
   if(['failed','rejected','canceled'].includes(task.status.state)){state.phase='failed';await this.store.write(file,state);throw Error('a2a_peer_task_failed');}
   if(['input-required','auth-required','unknown'].includes(task.status.state)){state.phase='paused';await this.store.write(file,state);throw Error('a2a_peer_input_not_authorized');}
   state.phase='waiting';state.remoteState=task.status.state;await this.store.write(file,state);
   return{phase:'waiting',taskId:state.taskId,contextId:state.contextId,retrySameTask:true};
  }finally{await unlock();}
 }
}
