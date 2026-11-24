import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';import{brief,sha}from'../src/buyer.mjs';import{normalizeCapabilityRequirements as normalize}from'../src/capabilities.mjs';
const req=()=>({version:'van-capability-requirements-v1',worker:[{id:'research.chainid',version:1}],reviewer:[{id:'research.chainid',version:1}]}),input=()=>({brief:'Identify the Base Sepolia chain ID.',language:'en',acceptanceCriteria:['State that the Base Sepolia chain ID is 84532.'],budgetAtomic:'100000',visibility:'public',publicListing:{title:'Fixture',summary:'Controlled fixture',requiredSkills:['Research'],deliverables:['Report']}});
test('buyer freezes role-specific capability requirements in the brief commitment and refuses malformed claims',()=>{
 const original=brief(input()),typed=brief({...input(),capabilityRequirements:req()});assert.equal(sha(original),sha(brief(original)));assert.notEqual(sha(original),sha(typed));assert.equal(sha(typed),sha(brief(typed)));
 const changed=req();changed.reviewer[0].version=2;assert.notEqual(sha(typed),sha(brief({...input(),capabilityRequirements:changed})));
 for(const mutate of [r=>r.worker=[],r=>r.reviewer.push(r.reviewer[0]),r=>r.worker[0].version='1',r=>r.worker[0].id='blockchain.*',r=>r.worker[0].verified=true,r=>r.buyer=[]]){const r=req();mutate(r);assert.throws(()=>normalize(r));}
 assert.throws(()=>brief({...input(),acceptanceCriteria:['Diagnose arbitrary RPC failures'],capabilityRequirements:req()}),/qualification profile/);
});
test('specialized experimental requirements cannot be sent under mainnet profile',()=>{
 const code=`const {brief}=await import('./src/buyer.mjs');try{brief(${JSON.stringify({...input(),capabilityRequirements:req()})});process.exit(2);}catch(e){if(!e.message.includes('testnet-only'))throw e;}`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('..',import.meta.url),env:{...process.env,VAN_NETWORK:'mainnet'},encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
