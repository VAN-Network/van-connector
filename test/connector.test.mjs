import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,chmod,symlink,readFile,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {VanClient,TEST_ORIGIN} from '../src/api.mjs';import {Store} from '../src/store.mjs';import {runReviewer,receiptFor,deadlines} from '../src/reviewer.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fixture=()=>{const dispatch={jobId:randomUUID(),dispatchToken:randomUUID(),attempt:1,timingVersion:2};const assignment={jobId:dispatch.jobId,brief:{brief:'Synthetic'},markdown:'Synthetic report',briefHash:hash('{"brief":"Synthetic"}'),submissionHash:hash('Synthetic report'),requiredCriteria:['Check synthetic'],timingVersion:2,leaseUntil:new Date(Date.now()+60000).toISOString(),processingDeadline:new Date(Date.now()+120000).toISOString(),hardDeadline:new Date(Date.now()+180000).toISOString()};return {dispatch,assignment};};
const decision={verdict:'INCONCLUSIVE',reason:'Server no-fetch witness',checks:[{criterion:'Check synthetic',status:'UNVERIFIED',reason:'Policy blocked, not fetched',evidenceIds:[],quote:null}]};
async function temp(){const dir=await mkdtemp(join(tmpdir(),'van-connector-'));await chmod(dir,0o700);const store=new Store(await realpath(dir));await store.init();return store;}
test('transport pins origin, refuses arbitrary paths/redirects, and keeps public requests unauthenticated',async()=>{
 const calls=[];const c=new VanClient({token:'van_'+'a'.repeat(64),fetchImpl:async(u,o)=>{calls.push({u,o});return Response.json({ok:true});}});
 await c.jobs();await c.me();assert.equal(calls[0].u,TEST_ORIGIN+'/public/jobs');assert.equal(calls[0].o.headers.Authorization,undefined);assert.equal(calls[1].o.redirect,'error');assert.equal(calls[1].o.headers.Authorization,'Bearer van_'+'a'.repeat(64));
 for(const p of ['https://evil.example','//evil.example','/jobs/../../private','/jobs/invalid'])await assert.rejects(c.request(p),/Unsupported API path/);
 await assert.rejects(new VanClient().me(),/Local API token/);
});
test('state is private and exclusive; symlink files and corrupt state fail closed',async()=>{
 const s=await temp();try{await s.write('identity.json',{n:1});assert.deepEqual(await s.read('identity.json'),{n:1});const unlock=await s.lock();await assert.rejects(s.lock(),/locked/);await unlock();await symlink(s.path('identity.json'),s.path('alias.json'));await assert.rejects(s.read('alias.json'),/Unsafe state/);await assert.rejects(s.write('../escape.json',{}),/Invalid state/);}finally{await rm(s.root,{recursive:true,force:true});}
});
test('frozen assignment context overrides no client tokens and incomplete/unsupported decisions are refused',()=>{
 const {dispatch,assignment}=fixture();assert.equal(receiptFor(decision,assignment,dispatch).dispatchToken,dispatch.dispatchToken);
 assert.throws(()=>receiptFor({...decision,dispatchToken:randomUUID()},assignment,dispatch));
 assert.throws(()=>receiptFor({...decision,verdict:'ACCEPT'},assignment,dispatch));
 assert.throws(()=>receiptFor({...decision,checks:[]},assignment,dispatch));
 assert.throws(()=>deadlines({}));
});
test('reviewer maintains heartbeat while external file handler decides; lost acknowledgement replays exact receipt after restart',async()=>{
 const s=await temp(),f=fixture(),identity={instanceId:randomUUID(),minRewardAtomic:'17000'};let pulses=0,submits=[],first=true;
 const client={async request(path,body){
  if(path==='/reviews/next')return {dispatch:f.dispatch};
  if(path.endsWith('/claim'))return f.assignment;
  if(path.endsWith('/heartbeat')&&path.startsWith('/jobs/')){pulses++;return f.assignment;}
  if(path.endsWith('/citation-check'))return {attemptId:randomUUID(),outcome:'not_fetched_policy_blocked',fetched:false,evidenceId:null};
  if(path.endsWith('/review')){submits.push(structuredClone(body));if(first){first=false;throw Error('lost acknowledgement');}return {jobId:f.dispatch.jobId,verdict:body.verdict};}
  return {};
 }};
 let handler;try{
  handler=setInterval(async()=>{const active=await s.read('active.json');if(!active?.assignment)return;const work=new Store(s.root+'/'+hash(f.dispatch.dispatchToken).slice(0,32));try{if(!await work.read('assignment.json'))return;await work.write('sources.json',{urls:[],citationCheck:true});const e=await work.read('evidence.json');if(e?.citationCheck&&pulses>=3)await work.write('decision.json',decision);}catch{}},10);
  await assert.rejects(runReviewer(client,s,identity,{once:true,pulseMs:20,interval:10}),/lost acknowledgement/);clearInterval(handler);handler=null;
  assert(pulses>=3);assert.equal(submits.length,1);const stored=await s.read('active.json');assert.deepEqual(stored.receipt,submits[0]);
  await runReviewer(client,s,identity,{once:true});assert.equal(submits.length,2);assert.deepEqual(submits[0],submits[1]);assert.equal((await s.read('active.json')).phase,'completed');
 }finally{if(handler)clearInterval(handler);await rm(s.root,{recursive:true,force:true});}
});
test('heartbeat loss stops before a verdict and retains active state',async()=>{
 const s=await temp(),f=fixture();let posted=false;
 const client={async request(p){if(p==='/reviews/next')return {dispatch:f.dispatch};if(p.endsWith('/claim'))return f.assignment;if(p.startsWith('/jobs/')&&p.endsWith('/heartbeat'))throw Error('lease lost');if(p.endsWith('/review'))posted=true;return {};}};
 try{await assert.rejects(runReviewer(client,s,{instanceId:randomUUID(),minRewardAtomic:'17000'},{once:true}),/Heartbeat failed/);assert.equal(posted,false);assert.equal((await s.read('active.json')).phase,'claimed');}finally{await rm(s.root,{recursive:true,force:true});}
});
