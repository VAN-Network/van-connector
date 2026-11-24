import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHash} from 'node:crypto';import {readFile,readdir,mkdtemp,chmod,rm,realpath} from 'node:fs/promises';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {fileURLToPath,pathToFileURL} from 'node:url';import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {VanClient,TEST_ORIGIN} from '../src/api.mjs';
import {runWorker} from '../src/worker.mjs';
import {startDaemon} from '../src/daemon.mjs';
import {quoteOrder,payOrder as connectorPay,brief as normalizeBrief,sha,ASSET,TARIFF} from '../src/buyer.mjs';
import {createServer} from 'node:http';import {Store} from '../src/store.mjs';import {runReviewer} from '../src/reviewer.mjs';import {canonical} from '../src/canonical.mjs';
if((process.env.VAN_NETWORK??'testnet')!=='testnet')throw Error('Integration harness supports testnet fixtures only; use VAN_NETWORK=testnet');
if(!process.env.VAN_SERVER_ROOT||!process.env.DATABASE_URL)throw Error('Set VAN_SERVER_ROOT to the marketplace server directory and DATABASE_URL to a disposable local database');
const root=resolve(process.env.VAN_SERVER_ROOT),connectionString=process.env.DATABASE_URL;
const dbUrl=new URL(connectionString);if(!['localhost','127.0.0.1','[::1]'].includes(dbUrl.hostname))throw Error('Disposable local database only');
const {default:pg}=await import(pathToFileURL(root+'/node_modules/pg/lib/index.js'));
const schema='connector_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema);const db=new pg.Pool({connectionString,options:'-c search_path='+schema});
const hash=s=>createHash('sha256').update(s).digest(),reviewer=randomUUID(),token='van_'+randomBytes(32).toString('hex'),job=randomUUID(),submission=randomUUID(),lease=randomUUID(),worker=randomUUID(),workerToken='van_'+randomBytes(32).toString('hex'),strangerToken='van_'+randomBytes(32).toString('hex'),dispatchToken=randomUUID(),brief={brief:'Check sources',language:'en',acceptanceCriteria:['Check sources']},markdown='Source: http://127.0.0.1/private',port=31678;
const dir=await realpath(await mkdtemp(join(tmpdir(),'van-connector-http-state-')));await chmod(dir,0o700);const store=new Store(dir);await store.init();let child,handler,paymentServer;
const {generatePrivateKey,privateKeyToAccount}=await import(pathToFileURL(root+'/node_modules/viem/_esm/accounts/index.js'));
const buyerAccount=privateKeyToAccount(generatePrivateKey()),buyerId=randomUUID(),buyerToken='van_'+randomBytes(32).toString('hex');
const daemonProof=process.env.VAN_DAEMON_PROOF==='1';let daemonWorkerAbort;
try{
 for(const name of(await readdir(root+'/migrations')).filter(n=>/^\d{3}.*\.sql$/.test(n)).sort())await db.query(await readFile(root+'/migrations/'+name,'utf8'));
 await db.query(`INSERT INTO orders(id,buyer_id,idempotency_key,brief,brief_hash,price,worker_reward,reviewer_reward,protocol_fee,status,quote_expires_at,deadline,lease_id,worker_id,worker_address,timing_version) VALUES($1::uuid,$2,$1::text,$3,$4,100000,68000,17000,15000,'verifying',clock_timestamp(),clock_timestamp()+interval '30 minutes',$5,$6,$7,2)`,[job,randomUUID(),brief,hash(canonical(brief)),lease,worker,'0x'+'2'.repeat(40)]);
 await db.query('INSERT INTO submissions(id,order_id,lease_id,worker_id,markdown,content_hash) VALUES($1,$2,$3,$4,$5,$6)',[submission,job,lease,worker,markdown,hash(markdown)]);
 await db.query("INSERT INTO review_dispatches(order_id,submission_id,reviewer_id,token,lease_until,starts) VALUES($1,$2,$3,$4,clock_timestamp()+interval '2 minutes',1)",[job,submission,reviewer,dispatchToken]);
 await store.write('active.json',{dispatch:{jobId:job,dispatchToken,attempt:1,timingVersion:2},phase:'offered'});
 child=spawn(process.execPath,['server.ts'],{cwd:root,env:{...process.env,DATABASE_URL:connectionString,PGOPTIONS:'-c search_path='+schema,PORT:String(port),VAN_API_ORIGIN:TEST_ORIGIN,VAN_SIGNER_URL:'',VAN_SETTLEMENT_KEY:'',VAN_PAID_PILOT_REVIEW:'',VAN_TRUSTED_TEST_REVIEW:'1',VAN_EVIDENCE_URLS:'https://example.org/supported',VAN_AGENT_KEYS:JSON.stringify({[hash(buyerToken).toString('hex')]:{id:buyerId,role:'buyer',address:buyerAccount.address.toLowerCase()},[hash(token).toString('hex')]:{id:reviewer,role:'reviewer',address:'0x'+'3'.repeat(40)},[hash(workerToken).toString('hex')]:{id:worker,role:'worker',address:'0x'+'2'.repeat(40)},[hash(strangerToken).toString('hex')]:{id:randomUUID(),role:'worker',address:'0x'+'5'.repeat(40)}})},stdio:['ignore','ignore','inherit']});
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:'+port+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 // Buyer: actual payOrder verification/registration with a local signature-
 // checking facilitator and synthetic RPC. Quote is seeded; capacity admission
 // and blockchain settlement are deliberately not exercised by this proof.
 const {verifyTypedData}=await import(pathToFileURL(root+'/node_modules/viem/_esm/index.js'));
 const buyJob=randomUUID();
 const buyerPolicy={wallet:buyerAccount.address.toLowerCase(),treasury:'0x'+'4'.repeat(40),maxOrderAtomic:'100000',maxTotalAtomic:'100000'};
 process.env.VAN_API_ORIGIN=TEST_ORIGIN;process.env.VAN_TREASURY_ADDRESS=buyerPolicy.treasury;process.env.VAN_SIGNER_URL='';process.env.VAN_SETTLEMENT_KEY='';
 let verified=0;
 paymentServer=createServer(async(req,res)=>{let chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));let out;
  if(req.url==='/verify'){verified++;const a=input.paymentPayload.payload.authorization;out={isValid:await verifyTypedData({address:a.from,domain:{name:'USDC',version:'2',chainId:84532,verifyingContract:ASSET},primaryType:'TransferWithAuthorization',types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},message:{...a,value:BigInt(a.value),validAfter:BigInt(a.validAfter),validBefore:BigInt(a.validBefore)},signature:input.paymentPayload.payload.signature})};}
  else{assert.ok(['eth_blockNumber','eth_chainId'].includes(input.method));out={jsonrpc:'2.0',id:input.id,result:input.method==='eth_chainId'?'0x14a34':'0x64'};}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(out));
 });paymentServer.listen(0,'127.0.0.1');await once(paymentServer,'listening');const paymentUrl='http://127.0.0.1:'+paymentServer.address().port;
 process.env.VAN_FACILITATOR_URL=paymentUrl;process.env.VAN_RPC_URL=paymentUrl;
 const {payOrder:serverPay}=await import(pathToFileURL(root+'/payment.ts'));
 const buyerInput=normalizeBrief({brief:'Research topic',language:'en',acceptanceCriteria:['Source claims'],visibility:'public',budgetAtomic:'100000',publicListing:{title:'Test',summary:'Synthetic',requiredSkills:[],deliverables:['Report']}});
 const expiresAt=new Date(Date.now()+590000).toISOString(),quote={version:TARIFF,jobId:buyJob,buyerId,briefHash:sha(buyerInput),budgetAtomic:'100000',workerAtomic:'68000',reviewerAtomic:'17000',protocolAtomic:'15000',chainId:84532,asset:ASSET,payTo:buyerPolicy.treasury,expiresAt,resource:TEST_ORIGIN+'/jobs/'+buyJob};
 await db.query(`INSERT INTO orders(id,buyer_id,idempotency_key,brief,brief_hash,price,worker_reward,reviewer_reward,protocol_fee,quote_expires_at,timing_version,budget_quote,budget_quote_hash) VALUES($1,$2,'connector-buyer',$3,$4,100000,68000,17000,15000,$5,2,$6,$7)`,[buyJob,buyerId,buyerInput,Buffer.from(sha(buyerInput),'hex'),expiresAt,quote,Buffer.from(sha(quote),'hex')]);
 const buyerStore=new Store(dir+'/buyer');await buyerStore.init();let losePayment=true;
 const buyerClient={me:async()=>({agentId:buyerId,role:'buyer',wallet:buyerPolicy.wallet}),exchange:async(_path,_body,opt)=>{const o=(await db.query('SELECT * FROM orders WHERE id=$1',[buyJob])).rows[0];o.price=String(o.price);const result=await serverPay(db,o,opt.headers['PAYMENT-SIGNATURE']);if(opt.headers['PAYMENT-SIGNATURE']&&losePayment){losePayment=false;throw Error('lost_registered_payment');}return {status:result.code,body:JSON.parse(JSON.stringify(result.body)),paymentRequired:result.headers['PAYMENT-REQUIRED']};}};
 const offered=await quoteOrder(buyerClient,buyerStore,'test',buyerInput,buyerPolicy),signing=await buyerStore.read('buyer-signing-test.json');const signature=await buyerAccount.signTypedData({...signing,message:{...signing.message,value:BigInt(signing.message.value),validAfter:BigInt(signing.message.validAfter),validBefore:BigInt(signing.message.validBefore)}});
 await assert.rejects(connectorPay(buyerClient,buyerStore,'test',offered.quoteHash,{quoteHash:offered.quoteHash,signature}),/lost_registered_payment/);
 assert.equal((await connectorPay(buyerClient,buyerStore,'test',offered.quoteHash)).status,'payment_pending');assert.equal(verified,1);assert.equal((await db.query('SELECT count(*)::int n FROM incoming_payments WHERE order_id=$1',[buyJob])).rows[0].n,1);
 // Worker: seeded confirmed funding, actual HTTP claim/recovery/heartbeat/submit.
 await db.query("UPDATE orders SET status='open',deadline=clock_timestamp()+interval '90 minutes' WHERE id=$1",[buyJob]);
 await db.query("UPDATE incoming_payments SET log_index='1',tx_hash=$2 WHERE order_id=$1",[buyJob,'0x'+'a'.repeat(64)]);
 const workerStore=new Store(dir+'/worker');await workerStore.init();let lostClaim=true,lostSubmit=true,claims=0;
 const workerClient=new VanClient({token:workerToken,fetchImpl:async(url,opts)=>{const path=new URL(url).pathname;if(path==='/agents/instances/heartbeat')return Response.json({instanceId:'synthetic-availability'});const result=await fetch('http://127.0.0.1:'+port+path,opts);if(path.endsWith('/claim')){claims++;if(lostClaim&&result.ok){lostClaim=false;await result.body.cancel();throw Error('lost_worker_claim');}}if(path.endsWith('/submit')&&lostSubmit&&result.ok){lostSubmit=false;await result.body.cancel();throw Error('lost_worker_submit');}if(path.endsWith('/submit')&&result.ok)daemonWorkerAbort?.abort();return result;}});
 const workerIdentity={instanceId:randomUUID(),minRewardAtomic:'68000'};
 await assert.rejects(runWorker(workerClient,workerStore,workerIdentity,buyJob),/lost_worker_claim/);
 assert.equal((await fetch('http://127.0.0.1:'+port+'/jobs/'+buyJob+'/assignment',{headers:{Authorization:'Bearer '+strangerToken}})).status,404);
 const owned=await workerClient.request('/jobs/'+buyJob+'/assignment');assert.equal(owned.jobId,buyJob);
 handler=setInterval(async()=>{const workStore=new Store(workerStore.root+'/work-'+hash(owned.leaseId).toString('hex').slice(0,32));try{if(await workStore.read('assignment.json'))await workStore.write('report.json',{markdown:'Synthetic independent report'});}catch{}},20);
 await assert.rejects(runWorker(workerClient,workerStore,workerIdentity,buyJob,{interval:20}),/lost_worker_submit/);clearInterval(handler);handler=null;
 await runWorker(workerClient,workerStore,workerIdentity,buyJob);assert.equal(claims,1);assert.equal((await db.query('SELECT count(*)::int n FROM submissions WHERE order_id=$1',[buyJob])).rows[0].n,1);
 assert.equal((await fetch('http://127.0.0.1:'+port+'/jobs/'+buyJob+'/assignment',{headers:{Authorization:'Bearer '+workerToken}})).status,404);
 // A server-requested revision obtains a different lease and preserves report 1.
 const revisionLease=randomUUID();await db.query("UPDATE orders SET status='revision',lease_id=$2,lease_expires_at=clock_timestamp()+interval '10 minutes' WHERE id=$1",[buyJob,revisionLease]);
 handler=setInterval(async()=>{const workStore=new Store(workerStore.root+'/work-'+hash(revisionLease).toString('hex').slice(0,32));try{if(await workStore.read('assignment.json'))await workStore.write('report.json',{markdown:'Synthetic revised independent report'});}catch{}},20);
 await runWorker(workerClient,workerStore,workerIdentity,buyJob,{revision:true,interval:20});clearInterval(handler);handler=null;
 assert.equal(claims,1);assert.equal((await db.query('SELECT count(*)::int n FROM submissions WHERE order_id=$1',[buyJob])).rows[0].n,2);
 let lost=true,submits=0;
 const client=new VanClient({token,fetchImpl:async(url,opts)=>{const path=new URL(url).pathname;if(path==='/agents/instances/heartbeat')return Response.json({instanceId:'synthetic-availability'});const r=await fetch('http://127.0.0.1:'+port+path,opts);if(path==='/jobs/'+job+'/review'){submits++;if(lost&&r.ok){lost=false;await r.body.cancel();throw Error('simulated_lost_ack');}}return r;}});
 handler=setInterval(async()=>{const work=new Store(dir+'/'+hash(dispatchToken).toString('hex').slice(0,32));try{const a=await work.read('assignment.json');if(!a)return;await work.write('sources.json',{urls:[],citationCheck:true});const e=await work.read('evidence.json');if(e?.citationCheck?.body?.fetched===false)await work.write('decision.json',{verdict:'INCONCLUSIVE',reason:'Server policy blocked; no fetch occurred',checks:a.requiredCriteria.map(criterion=>({criterion,status:'UNVERIFIED',reason:'No supported source',evidenceIds:[],quote:null}))});}catch{}},20);
 await assert.rejects(runReviewer(client,store,{instanceId:randomUUID(),minRewardAtomic:'17000'},{once:true,interval:20}),/simulated_lost_ack/);clearInterval(handler);handler=null;
 await runReviewer(client,store,{instanceId:randomUUID(),minRewardAtomic:'17000'},{once:true});assert.equal(submits,2);assert.equal((await db.query('SELECT count(*)::int n FROM review_iterations WHERE order_id=$1',[job])).rows[0].n,1);assert.equal((await db.query('SELECT count(*)::int n FROM settlement_instructions WHERE order_id=$1',[job])).rows[0].n,0);assert.equal((await store.read('active.json')).phase,'completed');
 if(daemonProof){
  const roleIdentity=role=>({role,instanceId:randomUUID(),minRewardAtomic:role==='worker'?'68000':'17000',chainId:84532,profileId:'base-sepolia',origin:TEST_ORIGIN});
  // Persistent worker notices an actual server-issued revision without a manual job command.
  const daemonLease=randomUUID();await db.query("UPDATE orders SET status='revision',lease_id=$2,lease_expires_at=clock_timestamp()+interval '10 minutes' WHERE id=$1",[buyJob,daemonLease]);
  await db.query("INSERT INTO review_iterations(order_id,submission_id,receipt) SELECT $1,id,$2 FROM submissions WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[buyJob,Buffer.from(JSON.stringify({verdict:'REVISE',reason:'Synthetic revision fixture'}))]);
  daemonWorkerAbort=new AbortController();
  handler=setInterval(async()=>{const work=new Store(workerStore.root+'/work-'+hash(daemonLease).toString('hex').slice(0,32));try{if(await work.read('assignment.json'))await work.write('report.json',{markdown:'Synthetic daemon revision report'});}catch{}},20);
  await startDaemon(workerClient,workerStore,roleIdentity('worker'),{signal:AbortSignal.any([daemonWorkerAbort.signal,AbortSignal.timeout(15000)]),handlerReady:true,acceptJobs:true,policy:{languages:['en'],skills:['research'],minTimeRemainingSeconds:60},pollMs:20});clearInterval(handler);handler=null;
  assert.equal(claims,1);assert.equal((await db.query('SELECT count(*)::int n FROM submissions WHERE order_id=$1',[buyJob])).rows[0].n,3);
  // Persistent reviewer processes a separately seeded dispatch using its own file handler.
  const daemonDispatch=randomUUID(),latest=(await db.query('SELECT id FROM submissions WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[buyJob])).rows[0].id;
  await db.query("INSERT INTO review_dispatches(order_id,submission_id,reviewer_id,token,lease_until,starts) VALUES($1,$2,$3,$4,clock_timestamp()+interval '2 minutes',1)",[buyJob,latest,reviewer,daemonDispatch]);
  const reviewStore=new Store(dir+'/daemon-reviewer');await reviewStore.init();await reviewStore.write('active.json',{dispatch:{jobId:buyJob,dispatchToken:daemonDispatch,attempt:1,timingVersion:2},phase:'offered'});
  const reviewAbort=new AbortController();let daemonReceipt;
  const reviewClient=new VanClient({token,fetchImpl:async(url,opts)=>{const path=new URL(url).pathname;if(path==='/agents/instances/heartbeat')return Response.json({instanceId:'synthetic-availability'});const r=await fetch('http://127.0.0.1:'+port+path,opts);if(path==='/jobs/'+buyJob+'/review'&&r.ok){daemonReceipt=JSON.parse(opts.body);reviewAbort.abort();}return r;}});
  handler=setInterval(async()=>{const work=new Store(reviewStore.root+'/'+hash(daemonDispatch).toString('hex').slice(0,32));try{const a=await work.read('assignment.json');if(!a)return;await work.write('sources.json',{urls:[],citationCheck:true});if((await work.read('evidence.json'))?.citationCheck?.body?.fetched===false)await work.write('decision.json',{verdict:'INCONCLUSIVE',reason:'Synthetic handler: no fetched source',checks:a.requiredCriteria.map(criterion=>({criterion,status:'UNVERIFIED',reason:'No supported source',evidenceIds:[],quote:null}))});}catch{}},20);
  await startDaemon(reviewClient,reviewStore,roleIdentity('reviewer'),{signal:AbortSignal.any([reviewAbort.signal,AbortSignal.timeout(15000)]),handlerReady:true,pollMs:20});clearInterval(handler);handler=null;assert.equal(daemonReceipt.verdict,'INCONCLUSIVE');assert.equal((await reviewStore.read('active.json')).phase,'completed');
  const watchAbort=new AbortController(),watchClient=new VanClient({token:buyerToken,fetchImpl:async(url,opts)=>{assert.equal(opts.method,'GET');const path=new URL(url).pathname,r=await fetch('http://127.0.0.1:'+port+path,opts);if(path==='/jobs/'+buyJob)watchAbort.abort();return r;}});
  await startDaemon(watchClient,buyerStore,roleIdentity('buyer'),{signal:AbortSignal.any([watchAbort.signal,AbortSignal.timeout(15000)]),pollMs:20});assert.equal((await buyerStore.read('buyer-status-'+buyJob+'.json')).result.jobId,buyJob);
  console.log(JSON.stringify({persistentDaemonHttpProof:true,workerAutoRevision:true,reviewerReceiptRecorded:true,buyerStatusWatching:true,realServerAndDatabase:true,availabilityMocked:true,dispatchSeeded:true,judgmentSynthetic:true,realPaymentSent:false}));
 }
 console.log('Three-role proof passed: actual buyer signature verification/registration with exact replay; worker HTTP claim recovery/heartbeat/submission once;  actual VAN claim, v2 heartbeat, no-fetch witness and exact receipt replay; one retained iteration, no transfer. Availability mocked and dispatch pre-seeded; independent judgment synthetic, not external-agent proof.');
}finally{if(handler)clearInterval(handler);child?.kill();if(child&&child.exitCode===null)await once(child,'exit');if(paymentServer)await new Promise(r=>paymentServer.close(r));await db.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();await rm(dir,{recursive:true,force:true});}
