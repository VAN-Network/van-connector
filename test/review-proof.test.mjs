import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {canonical} from '../src/canonical.mjs';
import {receiptFor,validateAssignment} from '../src/reviewer.mjs';
import {proofContext,criteriaFor,DEFAULT_CRITERION} from '../src/review-proof.mjs';
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
function fixture(){
 const dispatch={jobId:randomUUID(),dispatchToken:randomUUID(),attempt:1,timingVersion:2};
 const brief={brief:'Test',acceptanceCriteria:['Check'],platformCriteria:[]};
 const assignment={jobId:dispatch.jobId,brief,briefHash:hash(canonical(brief)),markdown:'Source https://example.org/source',submissionHash:hash('Source https://example.org/source'),requiredCriteria:['Check'],timingVersion:2};
 const context=proofContext(assignment,dispatch),id=randomUUID();
 const record={url:'https://example.org/source',status:200,context,body:{id,attemptId:randomUUID(),sourceUrl:'https://example.org/source',excerpt:'Exact café quote\r\nwith original spacing.',bodyHash:'b'.repeat(64),fetchedAt:new Date().toISOString()}};
 const proof={context,sources:[record],citationCheck:null};
 const decision={verdict:'ACCEPT',reason:'Independent assessment',checks:[{criterion:'Check',status:'PASS',reason:'Supported',evidenceIds:[id],quote:'Exact café quote'}]};
 return {dispatch,assignment,context,proof,decision};
}
test('Python-generated UTF-8/JCS vectors match exact brief, submission and raw-body hashes',async()=>{
 const v=JSON.parse(await readFile(new URL('../examples/vectors/hash-preimages.json',import.meta.url),'utf8'));
 assert.equal(canonical(v.brief),v.briefCanonicalUtf8);assert.equal(hash(canonical(v.brief)),v.briefHash);
 assert.deepEqual(criteriaFor(v.brief),v.requiredCriteria);
 assert.equal(hash(v.submissionMarkdown),v.submissionHash);
 assert.equal(hash(v.evidenceRawBodyUtf8),v.evidenceBodyHash);
 assert.notEqual(hash(v.evidenceExcerpt),v.evidenceBodyHash);
 assert.notEqual(hash(v.submissionMarkdown.trimEnd()),v.submissionHash);
 assert.deepEqual(criteriaFor({acceptanceCriteria:['B','A','B'],platformCriteria:['A','C']}),['B','A','C']);
 assert.deepEqual(criteriaFor({acceptanceCriteria:['B'],platformCriteria:[]}),['B']);
 assert.deepEqual(criteriaFor({acceptanceCriteria:['B']}),['B',DEFAULT_CRITERION]);
});
test('valid retained exact quote is accepted; invented IDs, quotes and stale dispatches are refused locally',()=>{
 const f=fixture(),check=()=>receiptFor(f.decision,f.assignment,f.dispatch,f.proof);
 check();f.decision.checks[0].evidenceIds=[randomUUID()];assert.throws(check,/not retained/);
 f.decision.checks[0].evidenceIds=[f.proof.sources[0].body.id];f.decision.checks[0].quote='Invented quote';assert.throws(check,/Exact quote/);
 f.decision.checks[0].quote='Exact café quote';f.proof.sources[0].context={...f.context,dispatchToken:randomUUID()};assert.throws(check,/context mismatch/);
 f.proof.sources[0].context=f.context;f.proof.context={...f.context,submissionHash:'f'.repeat(64)};assert.throws(check,/Current-dispatch/);
});
test('quote must occur in a cited evidence ID, and source errors cannot become evidence',()=>{
 const f=fixture(),id=randomUUID();f.proof.sources.push({...structuredClone(f.proof.sources[0]),body:{...f.proof.sources[0].body,id,attemptId:randomUUID(),excerpt:'Unrelated text'}});
 f.decision.checks[0].evidenceIds=[id];assert.throws(()=>receiptFor(f.decision,f.assignment,f.dispatch,f.proof),/Exact quote/);
 f.decision.checks[0].evidenceIds=[f.proof.sources[0].body.id];f.proof.sources[0].status=422;f.proof.sources[0].error='source_unverified';f.proof.sources[0].attemptId=randomUUID();assert.throws(()=>receiptFor(f.decision,f.assignment,f.dispatch,f.proof),/not retained/);
});
test('no-fetch and unavailable witnesses permit honest inconclusive; bare/blocked/pending claims do not',()=>{
 const f=fixture();f.decision.verdict='INCONCLUSIVE';f.decision.checks[0]={...f.decision.checks[0],status:'UNVERIFIED',evidenceIds:[],quote:null};
 const check=()=>receiptFor(f.decision,f.assignment,f.dispatch,f.proof);
 f.proof.sources=[];assert.throws(check,/Completed server source witness/);
 f.proof.sources=[{context:f.context,url:'https://example.org/source',status:400,error:'source_not_allowed'}];assert.throws(check,/Completed server source witness/);
 f.proof.sources[0]={...f.proof.sources[0],status:422,error:'source_unverified'};assert.throws(check,/Unwitnessed source failure/);
 f.proof.sources[0].attemptId=randomUUID();check();
 f.proof.sources[0].status=409;assert.throws(check,/Unresolved evidence/);
 f.proof.sources=[];f.proof.citationCheck={context:f.context,status:200,body:{attemptId:randomUUID(),outcome:'not_fetched_policy_blocked',fetched:false,evidenceId:null}};check();
 f.proof.citationCheck.body.fetched=true;assert.throws(check,/Invalid retained citation/);
});
test('wrong URL, missing server metadata, duplicate IDs and altered criteria are refused',()=>{
 for(const mutate of [f=>f.proof.sources[0].body.sourceUrl='https://evil.example',f=>delete f.proof.sources[0].body.attemptId,f=>f.proof.sources[0].body.bodyHash='bad',f=>f.proof.sources[0].body.fetchedAt='bad',f=>f.proof.sources[0].url='https://not-in-report.example',f=>f.decision.checks[0].evidenceIds.push(f.decision.checks[0].evidenceIds[0])]){
  const f=fixture();mutate(f);assert.throws(()=>receiptFor(f.decision,f.assignment,f.dispatch,f.proof));
 }
 const f=fixture();assert.throws(()=>validateAssignment({...f.assignment,requiredCriteria:['Invented']},f.dispatch),/Invalid assignment/);
});

test('daemon exact-retries an uncertain evidence response and submits only retained IDs/quotes',async()=>{
 const {mkdtemp,realpath,chmod,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {Store}=await import('../src/store.mjs');const {runReviewer}=await import('../src/reviewer.mjs');
 const dir=await realpath(await mkdtemp(join(tmpdir(),'van-proof-retry-')));await chmod(dir,0o700);const store=new Store(dir);await store.init();
 const f=fixture(),now=Date.now();Object.assign(f.assignment,{leaseUntil:new Date(now+60000).toISOString(),processingDeadline:new Date(now+120000).toISOString(),hardDeadline:new Date(now+180000).toISOString()});
 const requests=[];let lose=true,posts=0,handler,handlerBusy=false;
 const client={request:async(path,body)=>{
  if(path==='/reviews/next')return {dispatch:f.dispatch};if(path.endsWith('/claim'))return f.assignment;
  if(path.startsWith('/jobs/')&&path.endsWith('/heartbeat'))return f.assignment;
  if(path.endsWith('/evidence')){requests.push(structuredClone(body));if(lose){lose=false;throw Error('uncertain_evidence_response');}return f.proof.sources[0].body;}
  if(path.endsWith('/review')){posts++;assert.equal(body.checks[0].evidenceIds[0],f.proof.sources[0].body.id);return {jobId:f.dispatch.jobId,verdict:'ACCEPT'};}return {};
 }};
 try{
  const work=new Store(dir+'/'+hash(f.dispatch.dispatchToken).slice(0,32));
  handler=setInterval(async()=>{if(handlerBusy)return;handlerBusy=true;try{if(!await work.read('assignment.json'))return;await work.write('sources.json',{urls:[f.proof.sources[0].url]});const e=await work.read('evidence.json');if(e?.sources[0]?.status===200)await work.write('decision.json',f.decision);}catch{}finally{handlerBusy=false;}},10);
  await assert.rejects(runReviewer(client,store,{instanceId:randomUUID(),minRewardAtomic:'17000'},{once:true,interval:10}),/uncertain_evidence_response/);
  assert.equal(posts,0);await runReviewer(client,store,{instanceId:randomUUID(),minRewardAtomic:'17000'},{once:true,interval:10});
  assert.equal(posts,1);assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
 }finally{clearInterval(handler);while(handlerBusy)await new Promise(r=>setTimeout(r,5));await rm(dir,{recursive:true,force:true});}
});
