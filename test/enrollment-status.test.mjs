import test from'node:test';import assert from'node:assert/strict';
import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{spawnSync}from'node:child_process';
import{Store}from'../src/store.mjs';import{refreshEnrollment}from'../src/enrollment-status.mjs';
const proof={challengeId:'11111111-1111-4111-8111-111111111111',signature:'0x'+'11'.repeat(65)};
const identity={requestId:'22222222-2222-4222-8222-222222222222',wallet:'0x1111111111111111111111111111111111111111',role:'buyer',status:'pending',accessGranted:false,nextStep:'operator_admission'};
async function fixture(run){const root=await mkdtemp(join(tmpdir(),'van-enrollment-status-'));const store=new Store(root);await store.init();try{await store.write('enroll-prove-pending.json',proof);await store.write('enroll-prove-result.json',identity);await run(store);}finally{await rm(root,{recursive:true,force:true});}}
test('pending admission refreshes to admitted with the same proof and no key issuance',()=>fixture(async store=>{
 const calls=[];const result=await refreshEnrollment({request:async(path,body,options)=>{calls.push({path,body,options});return{...identity,status:'admitted'};}},store);
 assert.deepEqual(calls,[{path:'/agents/enrollment/prove',body:proof,options:{auth:false}}]);
 assert.equal(result.status,'admitted');assert.equal(result.authenticatedAccessGranted,false);assert.equal(result.nextStep,'credential-challenge '+identity.requestId);
 assert.deepEqual(await store.read('enroll-prove-pending.json'),proof);assert.equal((await store.read('enroll-prove-result.json')).status,'admitted');assert.equal(await store.read('credential.json'),null);
}));
test('foreign identity or unsupported status cannot replace the retained enrollment',()=>fixture(async store=>{
 for(const change of [{wallet:'0x2222222222222222222222222222222222222222'},{role:'worker'},{requestId:'33333333-3333-4333-8333-333333333333'},{status:'active'},{accessGranted:true}]){
  await assert.rejects(refreshEnrollment({request:async()=>({...identity,...change})},store),/context changed/);
  assert.deepEqual(await store.read('enroll-prove-result.json'),identity);
 }
}));
test('a lost refresh response preserves proof and status; retry sends the same proof',()=>fixture(async store=>{
 const calls=[];let first=true;const client={request:async(p,b,o)=>{calls.push({p,b,o});if(first){first=false;throw new TypeError('lost response');}return{...identity,status:'admitted'};}};
 await assert.rejects(refreshEnrollment(client,store));assert.deepEqual(await store.read('enroll-prove-result.json'),identity);
 await refreshEnrollment(client,store);assert.deepEqual(calls[0],calls[1]);
}));
test('missing or malformed proof cannot trigger status networking',async()=>{
 let calls=0;const client={request:async()=>{calls++;throw Error('must not request')}};
 assert.equal(await refreshEnrollment(client,{read:async()=>null}),null);
 await assert.rejects(refreshEnrollment(client,{read:async()=>({...proof,extra:'not allowed'})}),/Invalid retained/);assert.equal(calls,0);
});
test('mainnet refuses enrollment status replay before reading files or networking',()=>{
 const script="import{refreshEnrollment}from'./src/enrollment-status.mjs';await refreshEnrollment({request:()=>{throw Error('NETWORK_TOUCHED')}},{read:()=>{throw Error('FILES_TOUCHED')}})";
 const r=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,VAN_NETWORK:'mainnet'},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/testnet-only/);assert.doesNotMatch(r.stderr,/Error: NETWORK_TOUCHED|Error: FILES_TOUCHED/);
});

test('an unacknowledged first proof is reconciled through enroll-prove, not a status request',async()=>{
 let calls=0;await assert.rejects(refreshEnrollment({request:async()=>{calls++;throw Error('must not request')}},{read:async name=>name==='enroll-prove-pending.json'?proof:null}),/Confirmed enrollment result/);assert.equal(calls,0);
});

test('older acknowledged history recovers the exact own proof',()=>fixture(async store=>{
 await store.write('enroll-prove-history-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json',{request:proof,result:identity});
 await store.remove('enroll-prove-pending.json');
 const result=await refreshEnrollment({request:async(path,body)=>{assert.deepEqual(body,proof);return {...identity,status:'admitted'};}},store);
 assert.equal(result.status,'admitted');assert.deepEqual(await store.read('enrollment-proof-retained.json'),proof);
}));
test('foreign history cannot authorize a status replay',()=>fixture(async store=>{
 await store.write('enroll-prove-history-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json',{request:proof,result:{...identity,role:'worker'}});
 await store.remove('enroll-prove-pending.json');
 let calls=0;const result=await refreshEnrollment({request:async()=>{calls++;}},store);assert.equal(result,null);assert.equal(calls,0);
}));
