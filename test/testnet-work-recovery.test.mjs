import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import {randomUUID,createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {Store} from '../src/store.mjs';import {GatewayIssuerClient,prepareIssuerEvent,submitIssuerEvent,eventSigningRequest} from '../src/issuer.mjs';import {workReplyLossApi,TestReplyDropped} from '../src/testnet-work-recovery.mjs';
test('verified work reply is deliberately lost once; restart replays identical event and signature with one server submission',async()=>{
 const root=await realpath(await mkdtemp(tmpdir()+'/van-work-recovery-')),store=new Store(root);await store.init();
 const authorityId=randomUUID(),orderId=randomUUID(),anchor={orderId,quoteHash:'0x'+'1'.repeat(64),briefHash:'2'.repeat(64),fundingTxHash:'0x'+'3'.repeat(64),fundingLogIndex:'1',role:'worker',wallet:'0x'+'4'.repeat(40)},input={markdown:'External worker own report'},body={schema:'van-issuer-event-v1',authorityId,environmentId:'testnet',audience:'https://test-api.thevan.app',orderId,quoteHash:anchor.quoteHash,briefHash:anchor.briefHash,fundingTxHash:anchor.fundingTxHash,fundingLogIndex:'1',kind:'worker_submission',workId:randomUUID(),workDeadline:1790000000000,submissionHash:createHash('sha256').update(input.markdown).digest('hex')};
 let commits=0;const payloads=[];const api={request:async(path,payload)=>{
  if(path==='/events/v1/descriptor')return{version:1,protocol:'van-public-events-v1',environmentId:'testnet',chainId:84532,audience:'https://test-api.thevan.app',authorityId,issuerProtocol:'van-direct-events-v1'};
  if(path.endsWith('/work-request'))return{body,signing:eventSigningRequest(authorityId,body)};
  payloads.push(structuredClone(payload));if(commits===0)commits++;return structuredClone(body);
 }};
 try{
  const fault=new GatewayIssuerClient({api:workReplyLossApi(api,store,'submission'),authorityId}),prepared=await prepareIssuerEvent(fault,store,'submission',anchor,'work',input),proof={eventHash:prepared.eventHash,signature:'0x'+'a'.repeat(130)};
  await assert.rejects(submitIssuerEvent(fault,store,'submission',proof),TestReplyDropped);
  assert.equal(commits,1);assert.equal((await store.read('recovery-submission.json')).phase,'reply_dropped');assert.equal((await store.read('issuer-submission.json')).result,undefined);
  await assert.rejects(submitIssuerEvent(fault,store,'submission'),/already attempted/);assert.equal(payloads.length,1);
  const restarted=new Store(root);await restarted.init();const recovered=await submitIssuerEvent(new GatewayIssuerClient({api,authorityId}),restarted,'submission');assert.deepEqual(recovered,body);assert.deepEqual(payloads[0],payloads[1]);assert.equal(commits,1);
  assert.deepEqual((await restarted.read('issuer-submission.json')).proof,proof);assert.equal((await restarted.read('issuer-submission.json')).result.workId,body.workId);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('probe refuses unstaged/foreign work before network and leaves payment routes outside its injection path',async()=>{
 const root=await realpath(await mkdtemp(tmpdir()+'/van-work-recovery-')),store=new Store(root);await store.init();let calls=0;const wrapper=workReplyLossApi({request:async()=>{calls++;return{ok:true};}},store,'missing');
 try{await assert.rejects(wrapper.request('/events/v1/orders/'+randomUUID()+'/work',{}),/staged/);assert.equal(calls,0);assert.deepEqual(await wrapper.request('/health'),{ok:true});assert.equal(calls,1);}finally{await rm(root,{recursive:true,force:true});}
});
test('mainnet refuses the recovery command before networking or reading state',()=>{
 const r=spawnSync(process.execPath,['tools/testnet-drop-work-reply.mjs','x','missing','missing'],{cwd:new URL('..',import.meta.url),env:{...process.env,VAN_NETWORK:'mainnet'},encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/testnet-only/);
});
