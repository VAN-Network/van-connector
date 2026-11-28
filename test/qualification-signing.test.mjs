import test from'node:test';import assert from'node:assert/strict';import {mkdtemp,rm}from'node:fs/promises';import {join}from'node:path';import {tmpdir}from'node:os';import {createHash}from'node:crypto';import {canonical}from'../src/canonical.mjs';import {Store}from'../src/store.mjs';import {prepareQualificationSigning,qualificationProof}from'../src/qualification-signing.mjs';
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const own={requestId:'22222222-2222-4222-8222-222222222222',wallet:'0x1111111111111111111111111111111111111111',role:'reviewer'};
const bundle={examId:'33333333-3333-4333-8333-333333333333',requestId:own.requestId,wallet:own.wallet,chainId:84532,audience:'https://test-api.thevan.app',expiresAt:new Date(Date.now()+3600000).toISOString(),cases:[{caseId:'own-case',attempt:1,dispatchToken:'55555555-5555-4555-8555-555555555555',briefHash:'11'.repeat(32),submissionHash:'22'.repeat(32),requiredCriteria:['Synthetic criterion'],evidence:[],sourceAttempts:[{outcome:'unavailable',evidence_id:null}]}]};
const answers=[{caseId:'own-case',review:{attempt:1,dispatchToken:'55555555-5555-4555-8555-555555555555',briefHash:'11'.repeat(32),submissionHash:'22'.repeat(32),verdict:'INCONCLUSIVE',reason:'Own synthetic decision',checks:[{criterion:'Synthetic criterion',status:'UNVERIFIED',reason:'No verified source in this synthetic fixture',evidenceIds:[],quote:null}]}}];
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'van-answer-signing-'));const store=new Store(root);await store.init();try{await store.write('enroll-prove-result.json',own);await store.write('qualification-read-history-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json',{request:{},result:{bundle,bundleHash:hash(bundle)}});await fn(store);}finally{await rm(root,{recursive:true,force:true});}}
test('prepares canonical own answer hash without signing or submitting',()=>fixture(async store=>{const r=await prepareQualificationSigning(store,answers);assert.equal(r.paymentAuthorized,false);assert.equal(r.examId,bundle.examId);assert.equal(r.signingRequestFile,store.path('qualification-answer-signing-request.json'));const req=await store.read('qualification-answer-signing-request.json');const [prefix,json]=req.message.split('\n\n');assert.equal(prefix,'THE VAN reviewer qualification only. This signature does not authorize payments or grant access.');assert.deepEqual(JSON.parse(json),{action:'van.reviewer-qualification.v1',chainId:84532,audience:bundle.audience,examId:bundle.examId,bundleHash:hash(bundle),answersHash:hash(answers)});assert.equal(await store.read('qualification-submit-pending.json'),null);assert.equal(await store.read('qualification-submit-ready.json'),null);}));
test('proof assembly preserves exact answers and has no network dependency',()=>fixture(async store=>{await prepareQualificationSigning(store,{examId:bundle.examId,answers});const signature='0x'+'11'.repeat(65);const r=await qualificationProof(store,{signature});assert.equal(r.submissionFile,store.path('qualification-submit-ready.json'));assert.deepEqual(await store.read('qualification-submit-ready.json'),{examId:bundle.examId,answers,signature});}));
test('tampered bundle is refused before preparing any signature',()=>fixture(async store=>{await store.write('qualification-read-history-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json',{result:{bundle:{...bundle,cases:[]},bundleHash:hash(bundle)}});await assert.rejects(prepareQualificationSigning(store,answers),/hash mismatch/);assert.equal(await store.read('qualification-answer-signing-request.json'),null);}));
test('foreign, expired or wrong-network exam cannot prepare a signature',()=>fixture(async store=>{for(const patch of [{wallet:'0x2222222222222222222222222222222222222222'},{requestId:'44444444-4444-4444-8444-444444444444'},{chainId:8453},{audience:'https://api.thevan.app'},{expiresAt:'2000-01-01T00:00:00Z'}]){const b={...bundle,...patch};await store.write('qualification-read-history-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json',{result:{bundle:b,bundleHash:hash(b)}});await assert.rejects(prepareQualificationSigning(store,answers),/unique own unexpired/);}}));
test('cannot change prepared answers behind the exact signing request',()=>fixture(async store=>{await prepareQualificationSigning(store,answers);await store.write('qualification-prepared-answers.json',{examId:bundle.examId,answers:[]});await assert.rejects(qualificationProof(store,{signature:'0x'+'11'.repeat(65)}),/context changed/);}));
test('cannot replace a valid pending signed answer with different answers',()=>fixture(async store=>{await store.write('qualification-submit-pending.json',{examId:bundle.examId,answers:[],signature:'0x'+'11'.repeat(65)});await assert.rejects(prepareQualificationSigning(store,answers),/exact pending signed/);}));

import {validateQualificationAnswerFormat}from'../src/qualification-signing.mjs';
test('incorrect answer nesting or omitted context is rejected before signing',()=>{for(const a of [[{caseId:'own-case',decision:'REJECT',criteriaMet:false,comment:'own'}],[{caseId:'own-case',review:{verdict:'REJECT'}}]])assert.throws(()=>validateQualificationAnswerFormat(a),/exactly.*caseId,review|Legacy answer/);});

test('preferred agent-only decision receives context automatically without changing judgment',()=>fixture(async store=>{
 const decision={verdict:answers[0].review.verdict,reason:answers[0].review.reason,checks:answers[0].review.checks};
 const input=[{caseId:'own-case',decision}],before=structuredClone(input);
 await prepareQualificationSigning(store,input);
 const prepared=await store.read('qualification-prepared-answers.json');
 assert.deepEqual(input,before);assert.deepEqual(prepared.answers,answers);
}));
test('a wrong-case or fabricated evidence decision cannot leave a signing request',()=>fixture(async store=>{
 const decision={verdict:'ACCEPT',reason:'Own judgment',checks:[{criterion:'Synthetic criterion',status:'PASS',reason:'Claimed',evidenceIds:['66666666-6666-4666-8666-666666666666'],quote:'Fabricated'}]};
 await assert.rejects(prepareQualificationSigning(store,[{caseId:'own-case',decision}]),/not verified/);
 assert.equal(await store.read('qualification-answer-signing-request.json'),null);
 assert.equal(await store.read('qualification-prepared-answers.json'),null);
}));

import {spawnSync}from'node:child_process';import {resolve}from'node:path';
test('actual CLI prepares a complete private wire review from agent-only input offline',()=>fixture(async store=>{
 const decision={verdict:answers[0].review.verdict,reason:answers[0].review.reason,checks:answers[0].review.checks};
 await store.write('judgments.json',[{caseId:'own-case',decision}]);
 const r=spawnSync(process.execPath,[resolve('src/cli.mjs'),'qualification-prepare',store.path('judgments.json')],{env:{...process.env,VAN_NETWORK:'testnet',VAN_STATE_DIR:store.root},encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const printed=JSON.parse(r.stdout);assert.equal(printed.examId,bundle.examId);
 assert.doesNotMatch(r.stdout,/Own synthetic decision|No verified source/);
 assert.deepEqual((await store.read('qualification-prepared-answers.json')).answers,answers);
 assert.equal(await store.read('qualification-submit-pending.json'),null);
}));
