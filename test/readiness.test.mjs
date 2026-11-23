import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
function run(code){const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('..',import.meta.url),env:{PATH:process.env.PATH,VAN_NETWORK:'mainnet'},encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
test('readiness transport never accepts work routes/tokens and validates both descriptors first',()=>run(`
 const {ReadinessClient}=await import('./tools/readiness.mjs');const {NETWORK}=await import('./src/network.mjs');
 let calls=[];const c=new ReadinessClient({fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('van-network.json')?{version:1,...NETWORK}:url.endsWith('van-deployment.json')?{version:2,...NETWORK,environmentId:'testnet'}:{});}});
 for(const [path,token] of [['/jobs','van_ready_'+'a'.repeat(64)],['/readiness/me','van_'+'a'.repeat(64)]]){let bad=false;try{await c.request(path,undefined,token);}catch{bad=true;}if(!bad||calls.length)throw Error('wrong_token_or_route_sent');}
 let bad=false;try{await c.request('/readiness/me',undefined,'van_ready_'+'a'.repeat(64));}catch{bad=true;}if(!bad||calls.length!==2||calls.some(x=>x.init.headers.Authorization))throw Error('token_sent_to_foreign_context');
`));
test('readiness signing rejects changed qualification, key, wallet domain and expiry',()=>run(`
 const {validateReadinessChallenge}=await import('./tools/readiness.mjs');const {canonical}=await import('./src/canonical.mjs');const {randomUUID}=await import('node:crypto');const requestId=randomUUID(),key='a'.repeat(64),q='b'.repeat(64),id=randomUUID();
 const prefix='THE VAN readiness credential only. This key cannot authorize work, admission, orders or payments.\\n\\n';
 const p={action:'van.readiness-credential.v1',chainId:8453,audience:'https://api.thevan.app',scope:'readiness-only',challengeId:id,requestId,keyHash:key,qualificationRef:q,expiresAt:new Date(Date.now()+290000).toISOString()};
 const ch=()=>({challengeId:id,message:prefix+canonical(p),expiresAt:p.expiresAt,scope:'readiness-only',signingMethod:'personal_sign',accessGranted:false});validateReadinessChallenge(ch(),requestId,key,q);
 for(const patch of [{chainId:84532},{keyHash:'c'.repeat(64)},{qualificationRef:'d'.repeat(64)},{audience:'https://test-api.thevan.app'},{expiresAt:new Date(0).toISOString()},{scope:'reviewer'}]){const v={...p,...patch};let bad=false;try{validateReadinessChallenge({...ch(),message:prefix+canonical(v),expiresAt:v.expiresAt},requestId,key,q);}catch{bad=true;}if(!bad)throw Error('foreign_signing_context');}
`));
test('readiness request sends only its isolated token to the pinned readiness endpoint',()=>run(`
 const {ReadinessClient}=await import('./tools/readiness.mjs');const {NETWORK}=await import('./src/network.mjs');let calls=[];const token='van_ready_'+'a'.repeat(64);
 const c=new ReadinessClient({fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('van-network.json')?{version:1,...NETWORK}:url.endsWith('van-deployment.json')?{version:2,...NETWORK,environmentId:'mainnet'}:{scope:'readiness-only'});}});
 await c.request('/readiness/me',undefined,token);if(calls.length!==3||calls[2].url!=='https://api.thevan.app/readiness/me'||calls[2].init.headers.Authorization!=='Bearer '+token||calls[2].init.redirect!=='error'||calls.slice(0,2).some(x=>x.init.headers.Authorization))throw Error('bad_readiness_transport');
`));
