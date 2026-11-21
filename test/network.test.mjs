import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm,chmod,realpath}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{spawnSync}from'node:child_process';
import{NETWORK,validateIdentity}from'../src/network.mjs';import{VanClient,TEST_ORIGIN}from'../src/api.mjs';import{Store}from'../src/store.mjs';
test('foreign server descriptions fail before credentials or payment authorizations are transmitted',async()=>{
 for(const patch of[{chainId:8453},{audience:'https://api.thevan.app'},{asset:'0x'+'1'.repeat(40)},{profileId:'base-mainnet'},{decimals:18},{network:'eip155:8453'}]){
  const calls=[];const c=new VanClient({token:'van_'+'a'.repeat(64),fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({version:1,...NETWORK,...patch});}});
  await assert.rejects(c.exchange('/jobs',{brief:'fixture'},{headers:{'PAYMENT-SIGNATURE':'fixture-authorization'}}),/context mismatch/);
  assert.equal(calls.length,1);assert.equal(calls[0].url,TEST_ORIGIN+'/.well-known/van-network.json');assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[0].options.headers['PAYMENT-SIGNATURE'],undefined);assert.equal(calls[0].options.body,undefined);
 }
});
test('concurrent requests share one verified descriptor and failed descriptions are not cached',async()=>{
 let probes=0;const c=new VanClient({token:'van_'+'a'.repeat(64),fetchImpl:async(url)=>{if(url.endsWith('/van-network.json')){probes++;return Response.json({version:1,...NETWORK});}return Response.json({ok:true});}});await Promise.all([c.me(),c.jobs()]);assert.equal(probes,1);
 let n=0;const retry=new VanClient({fetchImpl:async()=>Response.json(++n===1?{}:{version:1,...NETWORK})});await assert.rejects(retry.context());await retry.context();assert.equal(n,2);
});
test('legacy matching state is preserved; foreign state is refused by actual CLI before connecting',async()=>{
 const valid={chainId:84532,origin:TEST_ORIGIN,role:'buyer'};assert.equal(validateIdentity(valid),valid);assert.equal(valid.profileId,undefined);
 const root=await mkdtemp(join(tmpdir(),'van-network-'));await chmod(root,0o700);const s=new Store(await realpath(root));await s.init();
 try{const bad={...valid,origin:'https://api.thevan.app'};await s.write('identity.json',bad);await s.write('credential.json',{token:'van_'+'a'.repeat(64)});const r=spawnSync(process.execPath,['src/cli.mjs','doctor'],{cwd:new URL('..',import.meta.url),env:{...process.env,VAN_STATE_DIR:s.root},encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/different VAN network or API/);assert.deepEqual(await s.read('identity.json'),bad);for(const patch of[{chainId:8453},{profileId:'base-mainnet'}])assert.throws(()=>validateIdentity({...valid,...patch}));}finally{await rm(root,{recursive:true,force:true});}
});
