import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,chmod,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID,createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {Store} from '../src/store.mjs';import {NETWORK} from '../src/network.mjs';import {ApiError} from '../src/api.mjs';import {startDaemon,workerPolicy,eligibleJob} from '../src/daemon.mjs';
const p={languages:['en'],skills:['research'],minTimeRemainingSeconds:60};
const identity=role=>({instanceId:randomUUID(),role,minRewardAtomic:role==='worker'?'68000':'17000',profileId:NETWORK.profileId,chainId:NETWORK.chainId,origin:NETWORK.audience});
const listing=id=>({jobId:id,publicId:id,currency:'USDC',jobType:'research_report',status:'open',timingVersion:2,rewardAtomic:'68000',language:'en',publicListing:{requiredSkills:['research']},workDeadline:new Date(Date.now()+600000).toISOString()});
async function temp(){const d=await realpath(await mkdtemp(join(tmpdir(),'van-daemon-')));await chmod(d,0o700);const s=new Store(d);await s.init();return s;}
async function handler(store,fn){let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{await fn();}finally{busy=false;}},5);return async()=>{clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,5));};}
test('worker policy requires language, capabilities, reward, instance and sufficient deadline',()=>{
 const i=identity('worker'),j=listing(randomUUID());assert.equal(eligibleJob(j,i,workerPolicy(p)),true);
 for(const change of [{language:'ru'},{rewardAtomic:'67999'},{reservedInstanceId:randomUUID()},{workDeadline:new Date().toISOString()},{publicListing:{requiredSkills:['shell-access']}},{jobType:'arbitrary-code'},{status:'in_progress'}])assert.equal(!!eligibleJob({...j,...change},i,p),false);
 assert.throws(()=>workerPolicy({...p,command:'run anything'}));assert.throws(()=>workerPolicy({...p,minTimeRemainingSeconds:0}));
});
test('worker daemon discovers jobs, recovers an uncertain claim without another claim, replays exact submission and handles revision',async()=>{
 const s=await temp(),i=identity('worker'),agentId=randomUUID(),job=randomUUID(),abort=new AbortController();let claims=0,posts=[],revision=false,lostClaim=true,lostSubmit=true;const leases=[randomUUID(),randomUUID()];
 const assignment=()=>({jobId:job,leaseId:leases[revision?1:0],brief:{brief:revision?'Revise with evidence':'Research with evidence'},status:revision?'revision':'claimed',timingVersion:2,expiresAt:new Date(Date.now()+60000).toISOString(),workDeadline:new Date(Date.now()+600000).toISOString(),deadline:new Date(Date.now()+900000).toISOString()});
 const client={me:async()=>({agentId,role:'worker'}),async request(path,body){
  if(path==='/agents/instances/heartbeat')return {};
  if(path.startsWith('/jobs?'))return {jobs:[listing(job)],nextCursor:null};
  if(path.startsWith('/public/jobs/'))return {...listing(job),status:posts.length?'in_progress':'open'};
  if(path.endsWith('/claim')){claims++;if(lostClaim){lostClaim=false;throw new TypeError('network disconnected');}throw Error('duplicate claim');}
  if(path.endsWith('/assignment'))return assignment();
  if(path.endsWith('/revision')){revision=true;return {leaseId:leases[1]};}
  if(path.endsWith('/heartbeat'))return {expiresAt:assignment().expiresAt};
  if(path.endsWith('/submit')){posts.push(structuredClone(body));if(lostSubmit){lostSubmit=false;throw new TypeError('lost acknowledgement');}if(revision)abort.abort();return {submissionId:randomUUID()};}
  throw Error('unexpected path');
 }};
 const stop=await handler(s,async()=>{const active=await s.read('worker-active.json');if(!active?.assignment)return;const name='work-'+createHash('sha256').update(active.assignment.leaseId).digest('hex').slice(0,32),work=new Store(s.root+'/'+name);if(await work.read('assignment.json'))await work.write('report.json',{markdown:revision?'Revision report':'Initial report'});});
 try{
  await startDaemon(client,s,i,{signal:abort.signal,handlerReady:true,acceptJobs:true,policy:p,pollMs:5,pulseMs:20});
  assert.equal(claims,1);assert.equal(posts.length,3);assert.deepEqual(posts[0],posts[1]);assert.equal(posts[2].leaseId,leases[1]);assert.equal(posts[2].markdown,'Revision report');assert.equal((await s.read('worker-active.json')).phase,'submitted');assert.equal((await s.read('daemon-status.json')).state,'stopped');const unlock=await s.lock();await unlock();
 }finally{await stop();await rm(s.root,{recursive:true,force:true});}
});
test('buyer daemon only reads existing order statuses and leaves payment bytes untouched',async()=>{
 const s=await temp(),i=identity('buyer'),agentId=randomUUID(),wallet='0x'+'1'.repeat(40),id=randomUUID(),abort=new AbortController();const ledger={buyerId:agentId,policy:{wallet},reservedAtomic:'100000',orders:{first:{payment:'unchanged-sensitive-payment',validated:{quote:{jobId:id,chainId:84532}}}}};
 await s.write('buyer-ledger.json',ledger);let calls=0;
 const client={me:async()=>({agentId,role:'buyer',wallet}),async request(path,body){assert.equal(path,'/jobs/'+id);assert.equal(body,undefined);calls++;abort.abort();return {status:'accepted',settlementStatus:'pending'};}};
 try{await startDaemon(client,s,i,{signal:abort.signal,pollMs:5});assert.equal(calls,1);assert.deepEqual(await s.read('buyer-ledger.json'),ledger);assert.equal((await s.read('buyer-status-'+id+'.json')).result.settlementStatus,'pending');}finally{await rm(s.root,{recursive:true,force:true});}
});
test('daemon reconnects transient service failures but stops on revoked credentials and excludes another daemon',async()=>{
 const s=await temp(),i=identity('buyer'),agentId=randomUUID(),abort=new AbortController();let tries=0;
 const client={me:async()=>{tries++;if(tries===1)throw new ApiError(503,'temporarily_unavailable');abort.abort();return {agentId,role:'buyer'};}};
 try{await startDaemon(client,s,i,{signal:abort.signal,pollMs:5});assert.equal(tries,2);const unlock=await s.lock('daemon');await assert.rejects(startDaemon(client,s,i),/locked/);await unlock();await assert.rejects(startDaemon({me:async()=>{throw new ApiError(401,'credential_revoked');}},s,i),/401/);assert.equal((await s.read('daemon-status.json')).state,'paused');}finally{await rm(s.root,{recursive:true,force:true});}
});
test('explicit worker acceptance is required and foreign retained state is refused before connecting',async()=>{
 const s=await temp(),i=identity('worker');let calls=0;const client={me:async()=>{calls++;throw Error('must not connect');}};
 try{await assert.rejects(startDaemon(client,s,i,{handlerReady:true,policy:p}),/accept-jobs/);await s.write('worker-active.json',{deployment:{environmentId:'mainnet'}});await assert.rejects(startDaemon(client,s,i,{handlerReady:true,acceptJobs:true,policy:p}),/different deployment/);assert.equal(calls,0);}finally{await rm(s.root,{recursive:true,force:true});}
});
test('persistent daemon refuses mainnet before any state or API access',()=>{
 const r=spawnSync(process.execPath,['--input-type=module','-e',"const {startDaemon}=await import('./src/daemon.mjs');try{await startDaemon({},null,null);process.exit(9);}catch(e){if(!e.message.includes('testnet-only'))throw e;}"],{cwd:new URL('..',import.meta.url),env:{PATH:process.env.PATH,VAN_NETWORK:'mainnet'},encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('reviewer daemon handles successive assignments and replays an uncertain verdict without changing it',async()=>{
 const s=await temp(),i=identity('reviewer'),agentId=randomUUID(),abort=new AbortController(),hash=v=>createHash('sha256').update(v).digest('hex');
 const {canonical}=await import('../src/canonical.mjs');
 const tasks=[0,1].map(()=>{const dispatch={jobId:randomUUID(),dispatchToken:randomUUID(),attempt:1,timingVersion:2},brief={brief:'Research',acceptanceCriteria:['Source claim'],platformCriteria:[]},markdown='Research report';return {dispatch,assignment:{jobId:dispatch.jobId,timingVersion:2,brief,markdown,briefHash:hash(canonical(brief)),submissionHash:hash(markdown),requiredCriteria:['Source claim'],leaseUntil:new Date(Date.now()+60000).toISOString(),processingDeadline:new Date(Date.now()+120000).toISOString(),hardDeadline:new Date(Date.now()+180000).toISOString()}};});
 let index=0,lost=true;const sent=[];
 const client={me:async()=>({agentId,role:'reviewer'}),async request(path,body){
  const task=tasks[index];if(path==='/reviews/next')return {dispatch:task?.dispatch??null};
  if(path.endsWith('/claim')||path.includes('/jobs/')&&path.endsWith('/heartbeat'))return task.assignment;
  if(path.endsWith('/citation-check'))return {attemptId:randomUUID(),outcome:'not_fetched_policy_blocked',fetched:false,evidenceId:null};
  if(path.endsWith('/review')){sent.push(structuredClone(body));if(lost){lost=false;throw new TypeError('lost verdict reply');}index++;if(index===2)abort.abort();return {status:'recorded'};}
  return {};
 }};
 const stop=await handler(s,async()=>{const a=await s.read('active.json');if(!a?.assignment)return;const w=new Store(s.root+'/'+hash(a.dispatch.dispatchToken).slice(0,32));if(!await w.read('assignment.json'))return;await w.write('sources.json',{urls:[],citationCheck:true});if((await w.read('evidence.json'))?.citationCheck)await w.write('decision.json',{verdict:'INCONCLUSIVE',reason:'No fetched evidence',checks:[{criterion:'Source claim',status:'UNVERIFIED',reason:'Policy blocked',evidenceIds:[],quote:null}]});});
 try{await startDaemon(client,s,i,{signal:abort.signal,handlerReady:true,pollMs:5,pulseMs:20});assert.equal(index,2);assert.equal(sent.length,3);assert.deepEqual(sent[0],sent[1]);assert.notEqual(sent[1].dispatchToken,sent[2].dispatchToken);}finally{await stop();await rm(s.root,{recursive:true,force:true});}
});
test('buyer watcher works through actual HTTP transport with pinned descriptor and authenticated GET only',async()=>{
 const {createServer}=await import('node:http');const {VanClient}=await import('../src/api.mjs');const s=await temp(),i=identity('buyer'),agentId=randomUUID(),job=randomUUID(),wallet='0x'+'1'.repeat(40),abort=new AbortController(),token='van_'+'a'.repeat(64),calls=[];
 const server=createServer((req,res)=>{calls.push({method:req.method,path:req.url,auth:req.headers.authorization});res.setHeader('Content-Type','application/json');if(req.url==='/.well-known/van-network.json')return res.end(JSON.stringify({version:1,...NETWORK}));if(req.url==='/agents/me')return res.end(JSON.stringify({agentId,role:'buyer',wallet}));assert.equal(req.url,'/jobs/'+job);res.end(JSON.stringify({status:'accepted',settlementStatus:'confirmed'}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 await s.write('buyer-ledger.json',{buyerId:agentId,policy:{wallet},orders:{one:{validated:{quote:{jobId:job,chainId:84532}}}}});
 const client=new VanClient({token,fetchImpl:async(url,options)=>{assert.equal(new URL(url).origin,NETWORK.audience);assert.equal(options.redirect,'error');const r=await fetch('http://127.0.0.1:'+server.address().port+new URL(url).pathname,options);if(url.endsWith('/jobs/'+job))abort.abort();return r;}});
 try{await startDaemon(client,s,i,{signal:abort.signal,pollMs:5});assert(calls.every(c=>c.method==='GET'));assert.equal(calls[0].auth,undefined);assert(calls.slice(1).every(c=>c.auth==='Bearer '+token));assert.equal((await s.read('buyer-status-'+job+'.json')).result.settlementStatus,'confirmed');}finally{await new Promise(r=>server.close(r));await rm(s.root,{recursive:true,force:true});}
});
test('bounded queue scanning resumes at its persisted cursor rather than starving later pages',async()=>{
 const s=await temp(),i=identity('worker'),agentId=randomUUID(),abort=new AbortController(),cursors=Array.from({length:10},()=>randomUUID());let reads=0;
 const client={me:async()=>({agentId,role:'worker'}),async request(path){if(path.startsWith('/agents/'))return {};assert(path.startsWith('/jobs?'));return {jobs:[],nextCursor:cursors[reads++]};}};
 try{
  await startDaemon(client,s,i,{signal:abort.signal,handlerReady:true,acceptJobs:true,policy:p,pollMs:5,log:e=>{if(e.event==='worker_queue_page_limit')abort.abort();}});assert.equal(reads,10);assert.equal((await s.read('worker-discovery.json')).cursor,cursors[9]);
  const next=new AbortController();await startDaemon({me:client.me,async request(path){if(path.startsWith('/agents/'))return {};assert.equal(path,'/jobs?status=open&after='+cursors[9]);next.abort();return {jobs:[],nextCursor:null};}},s,i,{signal:next.signal,handlerReady:true,acceptJobs:true,policy:p,pollMs:5});assert.equal((await s.read('worker-discovery.json')).cursor,null);
 }finally{await rm(s.root,{recursive:true,force:true});}
});
test('worker heartbeat failure pauses without posting a report or dropping the retained lease',async()=>{
 const s=await temp(),i=identity('worker'),agentId=randomUUID(),job=randomUUID(),lease=randomUUID();let posts=0;
 const client={me:async()=>({agentId,role:'worker'}),async request(path){if(path.startsWith('/agents/'))return {};if(path.startsWith('/jobs?'))return {jobs:[listing(job)],nextCursor:null};if(path.startsWith('/public/'))return listing(job);if(path.endsWith('/claim'))return {jobId:job,leaseId:lease,timingVersion:2,brief:{brief:'Research'},expiresAt:new Date(Date.now()+60000).toISOString(),workDeadline:new Date(Date.now()+600000).toISOString(),deadline:new Date(Date.now()+900000).toISOString()};if(path.endsWith('/heartbeat'))throw new TypeError('heartbeat lost');posts++;throw Error('must not submit');}};
 try{await assert.rejects(startDaemon(client,s,i,{handlerReady:true,acceptJobs:true,policy:p,pollMs:5}),/heartbeat failed/);assert.equal(posts,0);assert.equal((await s.read('daemon-status.json')).state,'paused');assert.equal((await s.read('worker-active.json')).assignment.leaseId,lease);}finally{await rm(s.root,{recursive:true,force:true});}
});
