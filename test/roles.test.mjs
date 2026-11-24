import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,chmod,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID,createHash} from 'node:crypto';
import {Store} from '../src/store.mjs';import {runWorker,workerReport} from '../src/worker.mjs';
import {quoteOrder,payOrder,brief,sha,validateQuote,ASSET,TARIFF} from '../src/buyer.mjs';import {TEST_ORIGIN,ApiError} from '../src/api.mjs';
async function temp(){const d=await realpath(await mkdtemp(join(tmpdir(),'van-roles-')));await chmod(d,0o700);const s=new Store(d);await s.init();return s;}
const p={wallet:'0x'+'1'.repeat(40),treasury:'0x'+'2'.repeat(40),maxOrderAtomic:'100000',maxTotalAtomic:'150000'};
const input={brief:'Research topic',language:'en',acceptanceCriteria:['Source claims'],budgetAtomic:'100000',visibility:'public',publicListing:{title:'Research',summary:'Source research',requiredSkills:['research'],deliverables:['Markdown report']}};
function quoteFixture(body,me){const q={version:TARIFF,jobId:randomUUID(),buyerId:me.agentId,briefHash:sha(body),budgetAtomic:'100000',workerAtomic:'68000',reviewerAtomic:'17000',protocolAtomic:'15000',chainId:84532,asset:ASSET,payTo:p.treasury,expiresAt:new Date(Date.now()+590000).toISOString()};q.resource=TEST_ORIGIN+'/jobs/'+q.jobId;
 const offer={scheme:'exact',network:'eip155:84532',amount:'100000',asset:ASSET,payTo:p.treasury,maxTimeoutSeconds:580,extra:{name:'USDC',version:'2'}};
 return {status:402,body:{jobId:q.jobId,status:'awaiting_payment',timingVersion:2,quoteExpiresAt:q.expiresAt,quote:q,quoteHash:'0x'+sha(q)},paymentRequired:Buffer.from(JSON.stringify({x402Version:2,resource:{url:q.resource},accepts:[offer]})).toString('base64')};}
test('buyer freezes exact budget, quote and authorization; lost payment reply replays bytes without another signature',async()=>{
 const s=await temp(),me={role:'buyer',wallet:p.wallet,agentId:randomUUID()};let r,payments=[],lost=true,quoted=0;
 const client={me:async()=>me,exchange:async(path,body,options)=>{assert.equal(path,'/jobs');if(!options.headers['PAYMENT-SIGNATURE']){quoted++;return r??=quoteFixture(body,me);}payments.push(structuredClone(options.headers));if(lost){lost=false;throw Error('lost_payment_ack');}return {status:202,body:{jobId:r.body.jobId,status:'payment_pending'}};}};
 try{
  const q=await quoteOrder(client,s,'first',input,p);const signing=await s.read('buyer-signing-first.json');assert.equal(signing.domain.chainId,84532);assert.equal(signing.message.nonce,q.quoteHash);
  await assert.rejects(payOrder(client,s,'first','0x'+'0'.repeat(64),{quoteHash:q.quoteHash,signature:'0x'+'a'.repeat(130)}),/approval/);assert.equal(payments.length,0);
  await assert.rejects(payOrder(client,s,'first',q.quoteHash,{quoteHash:q.quoteHash,signature:'0x'+'a'.repeat(130)}),/lost_payment_ack/);
  assert.equal((await payOrder(client,s,'first',q.quoteHash)).status,'payment_pending');assert.deepEqual(payments[0],payments[1]);
  const payment=JSON.parse(Buffer.from(payments[0]['PAYMENT-SIGNATURE'],'base64'));assert.deepEqual(payment.payload.authorization,signing.message);
  await assert.rejects(payOrder(client,s,'first',q.quoteHash,{signature:'0x'+'b'.repeat(130)}),/replacement/);
  await assert.rejects(quoteOrder(client,s,'second',input,p),/cap exceeded/);assert.equal(quoted,1);
  await assert.rejects(quoteOrder(client,s,'first',{...input,brief:'changed'},p),/different brief/);
  await assert.rejects(quoteOrder(client,s,'first',input,{...p,maxTotalAtomic:'200000'}),/immutable/);
 }finally{await rm(s.root,{recursive:true,force:true});}
});
test('quote validation rejects wrong network, recipient, allocation, brief, owner, expiry and challenge',()=>{
 const me={agentId:randomUUID()},o={brief:brief(input)},r=quoteFixture(o.brief,me);validateQuote(r,o,p,me);
 for(const mutate of [x=>x.body.quote.chainId=8453,x=>x.body.quote.payTo='0x'+'3'.repeat(40),x=>x.body.quote.workerAtomic='1',x=>x.body.quote.briefHash='f'.repeat(64),x=>x.body.quote.buyerId=randomUUID(),x=>x.body.quote.expiresAt=new Date(0).toISOString(),x=>x.paymentRequired=Buffer.from(JSON.stringify({x402Version:2,accepts:[]})).toString('base64')]){const x=structuredClone(r);mutate(x);x.body.quoteHash='0x'+sha(x.body.quote);assert.throws(()=>validateQuote(x,o,p,me));}
});
test('ambiguous quote retry preserves idempotency identity and reserves the total cap only once',async()=>{
 const s=await temp(),me={role:'buyer',wallet:p.wallet,agentId:randomUUID()},keys=[];let first=true;
 const client={me:async()=>me,exchange:async(_path,body,opt)=>{keys.push(opt.headers['Idempotency-Key']);if(first){first=false;throw Error('lost_quote');}return quoteFixture(body,me);}};
 try{await assert.rejects(quoteOrder(client,s,'one',input,p),/lost_quote/);await quoteOrder(client,s,'one',input,p);assert.equal(keys[0],keys[1]);assert.equal((await s.read('buyer-ledger.json')).reservedAtomic,'100000');}finally{await rm(s.root,{recursive:true,force:true});}
});
function work(jobId){return {jobId,leaseId:randomUUID(),brief:{brief:'Do independent research'},timingVersion:2,expiresAt:new Date(Date.now()+60000).toISOString(),workDeadline:new Date(Date.now()+120000).toISOString(),deadline:new Date(Date.now()+180000).toISOString()};}
test('worker recovers a lost claim read-only, heartbeats while agent writes report, then replays a lost submission',async()=>{
 const s=await temp(),job=randomUUID(),a=work(job),identity={instanceId:randomUUID(),minRewardAtomic:'68000'};let claims=0,pulses=0,reports=[],lose=true,handler;
 const client={request:async(path,body)=>{if(path.startsWith('/public/jobs/'))return {publicId:job,currency:'USDC',timingVersion:2,jobType:'research_report',rewardAtomic:'68000',status:'open'};if(path.endsWith('/claim')){claims++;throw Error('lost_claim');}if(path.endsWith('/assignment'))return a;if(path.includes('/jobs/')&&path.endsWith('/heartbeat')){pulses++;return {expiresAt:a.expiresAt};}if(path.endsWith('/submit')){reports.push(structuredClone(body));if(lose){lose=false;throw Error('lost_submit');}return {submissionId:randomUUID(),submissionHash:'b'.repeat(64)};}return {};}};
 try{
  await assert.rejects(runWorker(client,s,identity,job),/lost_claim/);assert.equal(claims,1);
  const dir='work-'+createHash('sha256').update(a.leaseId).digest('hex').slice(0,32),handoff=new Store(s.root+'/'+dir);
  handler=setInterval(async()=>{try{if(await handoff.read('assignment.json')&&pulses>=3)await handoff.write('report.json',{markdown:'Independently generated synthetic report'});}catch{}},10);
  await assert.rejects(runWorker(client,s,identity,job,{interval:10,pulseMs:20}),/lost_submit/);clearInterval(handler);handler=null;
  await runWorker(client,s,identity,job);assert.equal(claims,1);assert(pulses>=3);assert.equal(reports.length,2);assert.deepEqual(reports[0],reports[1]);assert.equal((await s.read('worker-active.json')).phase,'submitted');
 }finally{if(handler)clearInterval(handler);await rm(s.root,{recursive:true,force:true});}
});
test('worker refuses changed/oversized reports and stops on heartbeat failure',async()=>{
 assert.throws(()=>workerReport({markdown:'x',leaseId:randomUUID()}));assert.throws(()=>workerReport({markdown:'x'.repeat(65537)}));
 const s=await temp(),job=randomUUID();let posted=false;const client={request:async(path)=>{if(path.startsWith('/public/jobs/'))return {publicId:job,currency:'USDC',timingVersion:2,jobType:'research_report',rewardAtomic:'68000',status:'open'};if(path.endsWith('/claim'))return work(job);if(path.includes('/jobs/')&&path.endsWith('/heartbeat'))throw Error('lost');if(path.endsWith('/submit'))posted=true;return {};}};
 try{await assert.rejects(runWorker(client,s,{instanceId:randomUUID(),minRewardAtomic:'68000'},job),/heartbeat failed/);assert.equal(posted,false);assert((await s.read('worker-active.json')).assignment);}finally{await rm(s.root,{recursive:true,force:true});}
});
test('worker refuses a below-floor job before allocating a claim',async()=>{
 const s=await temp(),job=randomUUID();let claims=0;
 const client={request:async(path)=>{if(path.startsWith('/public/'))return {publicId:job,currency:'USDC',timingVersion:2,jobType:'research_report',rewardAtomic:'67999',status:'open'};claims++;return {};}};
 try{await assert.rejects(runWorker(client,s,{instanceId:randomUUID(),minRewardAtomic:'68000'},job),/reward floor mismatch/);assert.equal(claims,0);assert.equal(await s.read('worker-active.json'),null);}finally{await rm(s.root,{recursive:true,force:true});}
});
test('review fee quote requires explicit consent and validates both frozen refund branches',()=>{
 const me={agentId:randomUUID()},o={brief:brief(input)},r=quoteFixture(o.brief,me);
 Object.assign(r.body.quote,{version:'van-budget-quote-v3',environmentId:'testnet',tariffVersion:'buyer-budget-68-17-15-review-fee-v2',refundPolicy:'completed-review-fee-nonrefundable',rejectedRefundAtomic:'83000',technicalRefundAtomic:'100000'});
 r.body.quoteHash='0x'+sha(r.body.quote);
 const consent={...p,reviewFeePolicy:'completed-review-fee-nonrefundable'};
 assert.throws(()=>validateQuote(r,o,p,me),/consent/);validateQuote(r,o,consent,me);
 for(const patch of [{rejectedRefundAtomic:'100000'},{technicalRefundAtomic:'83000'},{environmentId:'mainnet'},{refundPolicy:'full-refund'},{unexpected:'x'}]){
  const x=structuredClone(r);Object.assign(x.body.quote,patch);x.body.quoteHash='0x'+sha(x.body.quote);assert.throws(()=>validateQuote(x,o,consent,me));
 }
});
