// Disposable local HTTP harness around the real server functions. Payout readiness
// is injected, not a live signer, and exam answers are synthetic known fixtures.
import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,readdir,mkdtemp,realpath,rm} from 'node:fs/promises';import {createServer} from 'node:http';
import {once} from 'node:events';import {resolve,join} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
import {VanClient,TEST_ORIGIN} from '../src/api.mjs';import {Store} from '../src/store.mjs';
import {calibrationChallenge} from '../src/onboarding.mjs';import {canonical} from '../src/canonical.mjs';
if((process.env.VAN_NETWORK??'testnet')!=='testnet')throw Error('Integration harness supports testnet fixtures only; use VAN_NETWORK=testnet');
const root=resolve(process.env.VAN_SERVER_ROOT??'');if(!process.env.VAN_SERVER_ROOT||!process.env.DATABASE_URL)throw Error('Set VAN_SERVER_ROOT and disposable local DATABASE_URL');
const connectionString=process.env.DATABASE_URL;if(!['localhost','127.0.0.1','[::1]'].includes(new URL(connectionString).hostname))throw Error('Local disposable database only');
const load=p=>import(pathToFileURL(root+'/'+p));
const {default:pg}=await load('node_modules/pg/lib/index.js');const {generatePrivateKey,privateKeyToAccount}=await load('node_modules/viem/_esm/accounts/index.js');
const {issueEnrollment,proveEnrollment}=await load('enrollment.ts');
const {issueExchange,readExchange,submitExchange}=await load('qualification-exchange.ts');
const {authenticateAgent,issueCredentialChallenge,proveCredential,revokeRole}=await load('agent-registry.ts');
const {instanceHeartbeat}=await load('agent-instances.ts');
const {admissionPolicy,reconcileReviewerAdmissions}=await load('reviewer-admission.ts');
const {qualificationAnswers}=await load('test/helpers/qualification.ts');const {qualificationMessage}=await load('reviewer-qualification.ts');
process.env.VAN_API_ORIGIN=TEST_ORIGIN;process.env.VAN_AUTO_REVIEWER_CALIBRATION='1';
const schema='onboarding_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});await admin.query('CREATE SCHEMA '+schema);
const db=new pg.Pool({connectionString,options:'-c search_path='+schema}),directory=await realpath(await mkdtemp(join(tmpdir(),'van-onboarding-proof-')));
const store=new Store(directory);await store.init();let http,ready=false;
const gate=async()=>ready?{policyHash:'a'.repeat(64)}:null;
const account=privateKeyToAccount(generatePrivateKey()),token='van_'+randomBytes(32).toString('hex');
const digest=v=>createHash('sha256').update(v).digest('hex');
try{
 for(const f of(await readdir(root+'/migrations')).filter(f=>/^\d{3}.*\.sql$/.test(f)).sort())await db.query(await readFile(root+'/migrations/'+f,'utf8'));
 http=createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req){chunks.push(chunk);if(Buffer.concat(chunks).length>131072)throw Error('body_too_large');}
  const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined,path=req.url;
  let r;if(path==='/agents/enrollment/challenge')r=await issueEnrollment(db,body,TEST_ORIGIN);
  else if(path==='/agents/enrollment/prove')r=await proveEnrollment(db,body,TEST_ORIGIN);
  else if(path==='/qualification/challenge')r=await issueExchange(db,body,TEST_ORIGIN);
  else if(path==='/qualification/read')r=await readExchange(db,body,TEST_ORIGIN);
  else if(path==='/qualification/submit')r=await submitExchange(db,body);
  else if(path==='/agents/credentials/challenge')r=await issueCredentialChallenge(db,body,TEST_ORIGIN);
  else if(path==='/agents/credentials/prove')r=await proveCredential(db,body,TEST_ORIGIN);
  else {const agent=await authenticateAgent(db,req.headers.authorization?.slice(7),{});
   r=!agent?{code:401,body:{error:'unauthorized'}}:path==='/agents/me'?{code:200,body:{agentId:agent.id,role:agent.role}}:
     path==='/agents/instances/heartbeat'?await instanceHeartbeat(db,agent,body,gate):{code:404,body:{error:'not_found'}};
  }res.writeHead(r.code,{'content-type':'application/json'});res.end(JSON.stringify(r.body));
 }catch{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'harness_failed'}));}});
 http.listen(0,'127.0.0.1');await once(http,'listening');const base='http://127.0.0.1:'+http.address().port;
 const client=new VanClient({token,fetchImpl:(url,options)=>fetch(base+new URL(url).pathname,options)});
 const publicCall=(p,b)=>client.request(p,b,{auth:false});
 const ch=await publicCall('/agents/enrollment/challenge',{wallet:account.address,role:'reviewer'});
 const signed={challengeId:ch.challengeId,signature:await account.signMessage({message:ch.message})};
 const enrolled=await publicCall('/agents/enrollment/prove',signed);await store.write('enroll-prove-result.json',enrolled);
 assert.deepEqual(await publicCall('/agents/enrollment/prove',signed),enrolled);
 await assert.rejects(client.me(),/401/);
 const q=await calibrationChallenge(client,store,'exam');assert.equal((await calibrationChallenge(client,store,'exam')).reused,true);
 const read=await publicCall('/qualification/read',{challengeId:q.challenge.challengeId,signature:await account.signMessage({message:q.challenge.message})});
 assert.equal(read.bundleHash,digest(canonical(read.bundle)));
 const answers=qualificationAnswers(read.bundle),submission={examId:read.bundle.examId,answers,signature:await account.signMessage({message:qualificationMessage(read.bundle.examId,read.bundleHash,answers,TEST_ORIGIN)})};
 const graded=await publicCall('/qualification/submit',submission);assert.equal(graded.passed,true);
 assert.deepEqual(await publicCall('/qualification/submit',submission),graded);
 const result=await calibrationChallenge(client,store,'result'),statusProof={challengeId:result.challenge.challengeId,signature:await account.signMessage({message:result.challenge.message})};
 const status=()=>publicCall('/qualification/read',statusProof);
 assert.equal((await status()).nextStep,'await_admission');
 const credential={requestId:enrolled.requestId,operation:'issue',keyHash:digest(token)};
 await assert.rejects(publicCall('/agents/credentials/challenge',credential),/403/);
 assert.deepEqual(await reconcileReviewerAdmissions(db,null,gate),[]);
 const approval=admissionPolicy(JSON.stringify({schemaVersion:1,chainId:84532,audience:TEST_ORIGIN,expiresAt:new Date(Date.now()+3600000).toISOString(),candidates:[{requestId:enrolled.requestId,ownerGroup:read.bundle.ownerGroup,ownershipReviewRef:'b'.repeat(64)}]}),TEST_ORIGIN);
 assert.equal((await reconcileReviewerAdmissions(db,approval,gate))[0].reason,'payout_address_not_ready');
 ready=true;await reconcileReviewerAdmissions(db,approval,gate);
 assert.equal((await status()).nextStep,'issue_credential');
 const kc=await publicCall('/agents/credentials/challenge',credential),kp={challengeId:kc.challengeId,signature:await account.signMessage({message:kc.message})};
 const issued=await publicCall('/agents/credentials/prove',kp);assert.equal(issued.accessGranted,true);
 assert.deepEqual(await publicCall('/agents/credentials/prove',kp),issued);assert.equal((await client.me()).role,'reviewer');
 assert.equal((await status()).nextStep,'use_existing_credential');
 const instanceId=randomUUID();assert.equal((await client.request('/agents/instances/heartbeat',{instanceId,slots:1,minRewardAtomic:'17000'})).maxSlots,1);
 await assert.rejects(client.request('/agents/instances/heartbeat',{instanceId,slots:2,minRewardAtomic:'17000'}),/403/);
 await revokeRole(db,issued.agentId,'reviewer');await assert.rejects(client.me(),/401/);
 assert.equal((await status()).nextStep,'contact_operator');
 assert.equal((await db.query('SELECT count(*) n FROM orders')).rows[0].n,'0');assert.equal((await db.query('SELECT count(*) n FROM settlement_instructions')).rows[0].n,'0');
 console.log('Onboarding HTTP proof passed: connector enrollment -> automatic exam -> signed fixture calibration -> pending/payout gate -> approved one-slot admission -> own credential -> actual instance heartbeat -> revocation. Exact replay tested; no orders/payments. Local HTTP harness uses real handlers; signer readiness and ownership approval are injected test fixtures, not a live independent agent.');
}finally{if(http)await new Promise(r=>http.close(r));await db.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();await rm(directory,{recursive:true,force:true});}
