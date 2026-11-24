import {setTimeout as sleep} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {ENVIRONMENT,NETWORK,STATE_CONTEXT,validateIdentity} from './network.mjs';
import {ApiError} from './api.mjs';
import {runWorker} from './worker.mjs';
import {runReviewer,uuid} from './reviewer.mjs';
import {canonical} from './canonical.mjs';

export function workerPolicy(value){
 const strings=(a,max)=>Array.isArray(a)&&a.length>0&&a.length<=max&&a.every(s=>typeof s==='string'&&s.length>0&&s.length<=64&&s===s.trim())&&new Set(a).size===a.length;
 if(!value||Object.keys(value).sort().join(',')!=='languages,minTimeRemainingSeconds,skills'||!strings(value.languages,10)||!strings(value.skills,20)||!Number.isInteger(value.minTimeRemainingSeconds)||value.minTimeRemainingSeconds<60||value.minTimeRemainingSeconds>86400)throw Error('Explicit worker policy required: languages, skills, minTimeRemainingSeconds');
 return structuredClone(value);
}
export function eligibleJob(job,identity,p,now=Date.now()){
 return uuid(job?.jobId??job?.publicId)&&job.currency==='USDC'&&job.jobType==='research_report'&&job.status==='open'&&job.timingVersion===2
  &&typeof job.rewardAtomic==='string'&&/^[1-9][0-9]{0,12}$/.test(job.rewardAtomic)&&BigInt(job.rewardAtomic)>=BigInt(identity.minRewardAtomic)
  &&p.languages.includes(job.language)&&Array.isArray(job.publicListing?.requiredSkills)&&job.publicListing.requiredSkills.every(s=>typeof s==='string'&&p.skills.includes(s))
  &&(!job.reservedInstanceId||job.reservedInstanceId===identity.instanceId)
  &&Number.isFinite(Date.parse(job.workDeadline))&&Date.parse(job.workDeadline)-now>=p.minTimeRemainingSeconds*1000;
}
const transient=e=>e instanceof ApiError?[429,500,502,503,504].includes(e.status):e instanceof TypeError||['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT'].includes(e?.code)||['TimeoutError'].includes(e?.name);
const wait=(ms,signal)=>sleep(ms,undefined,{signal}).catch(e=>{if(e.name!=='AbortError')throw e;});
// Persistent transport/scheduling only. A separately operated agent evaluates
// assignments through the file bridge. No shell, model or wallet is invoked.
export async function startDaemon(client,store,identity,{signal,handlerReady=false,acceptJobs=false,policy:rawPolicy,pollMs=5000,pulseMs=30000,log=()=>{}}={}){
 if(ENVIRONMENT!=='testnet')throw Error('Persistent start is testnet-only; mainnet activation requires a separate rollout');
 validateIdentity(identity);
 if(!['buyer','worker','reviewer'].includes(identity.role)||!uuid(identity.instanceId)||!/^[1-9][0-9]{0,12}$/.test(identity.minRewardAtomic))throw Error('Valid role, instance and reward floor required');
 if(identity.role!=='buyer'&&!handlerReady)throw Error('Start your independent file handler and pass --handler-ready');
 if(identity.role==='worker'&&!acceptJobs)throw Error('Automatic worker claims require explicit --accept-jobs and a local policy');
 const p=identity.role==='worker'?workerPolicy(rawPolicy):undefined;
 const daemonUnlock=await store.lock('daemon');let runUnlock,me,failures=0;
 const record=async(state,extra={})=>{await store.write('daemon-status.json',{version:1,deployment:STATE_CONTEXT,role:identity.role,instanceId:identity.instanceId,state,checkedAt:new Date().toISOString(),...extra});log({event:'daemon_'+state,role:identity.role,...extra});};
 try{
  if(identity.role!=='buyer')runUnlock=await store.lock();
  for(const name of ['active.json','worker-active.json']){const a=await store.read(name);if(a?.deployment&&canonical(a.deployment)!==canonical(STATE_CONTEXT))throw Error('Retained work belongs to a different deployment');}
  const saved=await store.read('daemon-config.json'),config={version:1,deployment:STATE_CONTEXT,role:identity.role,instanceId:identity.instanceId,...(p?{policy:p}:{})};
  if(saved&&canonical(saved)!==canonical(config))throw Error('Daemon configuration changed; reconcile existing state before changing policy');
  await store.write('daemon-config.json',config);await record('starting');
  while(!signal?.aborted){
   try{
    const current=await client.me();if(current.role!==identity.role||!uuid(current.agentId))throw Error('Credential role/agent mismatch');
    if(me&&me.agentId!==current.agentId)throw Error('Agent identity changed');me=current;
    const binding=await store.read('daemon-agent.json');if(binding&&binding.agentId!==me.agentId)throw Error('Stored daemon agent changed');if(!binding)await store.write('daemon-agent.json',{agentId:me.agentId});
    if(identity.role==='buyer'){
     const unlock=await store.lock();try{
      const ledger=await store.read('buyer-ledger.json');
      if(ledger){if(ledger.buyerId!==me.agentId||ledger.policy?.wallet!==me.wallet?.toLowerCase()||!ledger.orders||typeof ledger.orders!=='object')throw Error('Buyer ledger identity mismatch');
       for(const order of Object.values(ledger.orders)){
        const id=order?.validated?.quote?.jobId;if(!id)continue;if(!uuid(id)||order.validated.quote.chainId!==NETWORK.chainId)throw Error('Invalid retained buyer order context');
        const result=await client.request('/jobs/'+id);await store.write('buyer-status-'+id+'.json',{jobId:id,checkedAt:new Date().toISOString(),result});
       }
      }
     }finally{await unlock();}
    }else if(identity.role==='reviewer'){
     await runReviewer(client,store,identity,{signal,once:true,pulseMs,lockHeld:true,log:event=>log({event,role:'reviewer'})});
    }else{
     await workerCycle(client,store,identity,p,{signal,pulseMs,log});
    }
    failures=0;await record('online');await wait(pollMs,signal);
   }catch(e){
    if(signal?.aborted)break;
    if(!transient(e))throw e;
    failures++;const retryInMs=Math.min(60000,pollMs*2**Math.min(failures,6));await record('reconnecting',{retryInMs});await wait(retryInMs,signal);
   }
  }
  await record('stopped');
 }catch(e){await record('paused',{reason:'reconciliation_required'});throw e;}
 finally{
  // Best effort, bounded by the API transport timeout. Never abandon or clear
  // a retained assignment: the server decides its lease/reassignment outcome.
  if(me&&identity.role!=='buyer')await client.request('/agents/instances/heartbeat',{instanceId:identity.instanceId,slots:0,minRewardAtomic:identity.minRewardAtomic}).catch(()=>{});
  if(runUnlock)await runUnlock();await daemonUnlock();
 }
}
async function workerCycle(client,store,identity,p,{signal,pulseMs,log}){
 const pulse=()=>client.request('/agents/instances/heartbeat',{instanceId:identity.instanceId,slots:1,minRewardAtomic:identity.minRewardAtomic});
 await pulse();let active=await store.read('worker-active.json');
 if(active&&active.phase!=='submitted'){
  await runWorker(client,store,identity,active.jobId,{signal,pulseMs,lockHeld:true,log:event=>log({event,role:'worker'})});return;
 }
 if(active?.phase==='submitted'){
  const publicJob=await client.request('/public/jobs/'+active.jobId,undefined,{auth:false});
  if(publicJob.publicId!==active.jobId)throw Error('Worker status identity mismatch');
  if(!['completed','closed'].includes(publicJob.status)){
   try{const revision=await client.request('/jobs/'+active.jobId+'/revision');
    if(!uuid(revision.leaseId))throw Error('Invalid revision lease');
    if(revision.leaseId!==active.assignment.leaseId)await runWorker(client,store,identity,active.jobId,{revision:true,signal,pulseMs,lockHeld:true,log:event=>log({event,role:'worker'})});
   }catch(e){if(!(e instanceof ApiError&&e.status===404&&e.code==='revision_unavailable'))throw e;}
   return;
  }
 }
 const discovery=await store.read('worker-discovery.json');
 if(discovery?.cursor!==undefined&&discovery.cursor!==null&&!uuid(discovery.cursor))throw Error('Invalid retained discovery cursor');
 let cursor=discovery?.cursor??null;const visited=new Set();
 for(let page=0;page<10;page++){
  const list=await client.request('/jobs?status=open'+(cursor?'&after='+cursor:''));
  if(!Array.isArray(list.jobs)||list.jobs.length>50||list.nextCursor!==null&&!uuid(list.nextCursor))throw Error('Invalid worker queue page');
  const job=list.jobs.find(j=>eligibleJob(j,identity,p));
  if(job){
   try{await runWorker(client,store,identity,job.jobId,{signal,pulseMs,lockHeld:true,acceptListing:j=>eligibleJob(j,identity,p),log:event=>log({event,role:'worker'})});}
   catch(e){
    // A definitive refusal is not an ambiguous claim. Archive it before
    // clearing only the unallocated intent; network failures retain it.
    const intent=await store.read('worker-active.json');
    if(e instanceof ApiError&&e.status===409&&['claim_unavailable','reserved_instance_required'].includes(e.code)&&intent?.jobId===job.jobId&&intent.phase==='claim_pending'&&!intent.assignment){
     await store.write('worker-declined-'+job.jobId+'.json',{intent,reason:e.code});await store.remove('worker-active.json');return;
    }
    throw e;
   }
   return;
  }
  if(!list.nextCursor){await store.write('worker-discovery.json',{cursor:null});return;}if(visited.has(list.nextCursor))throw Error('Repeated worker queue cursor');visited.add(list.nextCursor);cursor=list.nextCursor;
 }
 await store.write('worker-discovery.json',{cursor});log({event:'worker_queue_page_limit',role:'worker'});
}
