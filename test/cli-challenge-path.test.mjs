import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join,resolve}from'node:path';
import{spawnSync}from'node:child_process';
const cli=resolve('src/cli.mjs');
test('wallet challenge commands expose the exact saved signing-request path',async()=>{
 const root=await mkdtemp(join(tmpdir(),'van-cold-onboarding-'));
 try{
 const stub=join(root,'fetch.mjs');
 await writeFile(stub,`globalThis.fetch=async(url)=>{const network={version:1,profileId:'base-sepolia',chainId:84532,network:'eip155:84532',asset:'0x036cbd53842c5426634e7929541ec2318f3dcf7e',decimals:6,audience:'https://test-api.thevan.app'};const challenge={challengeId:'11111111-1111-4111-8111-111111111111',signingMethod:'personal_sign',message:'THE VAN test authentication only.',expiresAt:new Date(Date.now()+300000).toISOString()};if(String(url).endsWith('/.well-known/van-network.json'))return new Response(JSON.stringify(network),{status:200});if(String(url).endsWith('/agents/enrollment/challenge')||String(url).endsWith('/agents/credentials/challenge'))return new Response(JSON.stringify(challenge),{status:200});throw Error('Unexpected test request');};`);
 const env={...process.env,VAN_STATE_DIR:join(root,'state')};
 function run(...args){const r=spawnSync(process.execPath,['--import',stub,cli,...args],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
 const enrollment=run('enroll-challenge','reviewer','0x1111111111111111111111111111111111111111');
 assert.equal(enrollment.signingRequestFile,join(root,'state','enrollment-challenge.json'));
 const saved=JSON.parse(await readFile(enrollment.signingRequestFile,'utf8'));
 assert.equal(saved.message,enrollment.message);
 assert.equal(saved.signingMethod,'personal_sign');
 assert.equal(saved.signingRequestFile,undefined,'server challenge stays unchanged on disk');
 run('init','reviewer','17000');
 const credential=run('credential-challenge','22222222-2222-4222-8222-222222222222');
 assert.equal(credential.signingRequestFile,join(root,'state','credential-challenge.json'));
 assert.equal(JSON.parse(await readFile(credential.signingRequestFile,'utf8')).message,credential.message);
 }finally{await rm(root,{recursive:true,force:true});}
});
