import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store} from '../src/store.mjs';import {canonical} from '../src/canonical.mjs';
import {TEST_ORIGIN} from '../src/api.mjs';
import {validateCalibrationChallenge,calibrationChallenge} from '../src/onboarding.mjs';
const prefix='THE VAN qualification read only. This signature does not authorize payments or grant marketplace access.\n\n';
function challenge(requestId,operation,changes={}){
 const p={action:'van.qualification-read.v1',audience:TEST_ORIGIN,chainId:84532,challengeId:randomUUID(),
  examId:randomUUID(),expiresAt:new Date(Date.now()+300000).toISOString(),operation,requestId,...changes};
 return {challengeId:p.challengeId,message:prefix+canonical(p),expiresAt:p.expiresAt,signingMethod:'personal_sign',accessGranted:false};
}
test('calibration signing rejects foreign contexts, payments, expiry and noncanonical messages',()=>{
 const id=randomUUID(),valid=challenge(id,'exam');assert.equal(validateCalibrationChallenge(valid,id,'exam'),valid);
 for(const changes of [{audience:'https://evil.invalid'},{chainId:8453},{requestId:randomUUID()},
  {operation:'result'},{value:'1'},{expiresAt:new Date(Date.now()-1).toISOString()},
  {expiresAt:new Date(Date.now()+3600000).toISOString()}])assert.throws(()=>validateCalibrationChallenge(challenge(id,'exam',changes),id,'exam'));
 assert.throws(()=>validateCalibrationChallenge({...valid,challengeId:randomUUID()},id,'exam'));
 assert.throws(()=>validateCalibrationChallenge({...valid,message:valid.message+' '},id,'exam'));
 assert.throws(()=>validateCalibrationChallenge({...valid,accessGranted:true},id,'exam'));
});
test('calibration helper reuses one context, respects its lock and never enrolls or claims work',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'van-onboarding-test-'))),s=new Store(root),id=randomUUID();
 await s.init();await s.write('enroll-prove-result.json',{requestId:id,role:'reviewer',status:'pending'});
 const calls=[],client={async request(path,body,options){calls.push({path,body,options});return challenge(body.requestId,body.operation);}};
 try{
  const unlock=await s.lock();await assert.rejects(()=>calibrationChallenge(client,s,'exam'),/locked/);await unlock();assert.equal(calls.length,0);
  const a=await calibrationChallenge(client,s,'exam'),b=await calibrationChallenge(client,s,'exam');
  assert.deepEqual(a.challenge,b.challenge);assert.equal(b.reused,true);assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{path:'/qualification/challenge',body:{requestId:id,operation:'exam'},options:{auth:false}});
  const result=await calibrationChallenge(client,s,'result');assert.notEqual(result.challenge.challengeId,a.challenge.challengeId);
  // A cached request for another enrollment is never silently reused/relabelled.
  await s.write('enroll-prove-result.json',{requestId:randomUUID(),role:'reviewer',status:'pending'});
  await assert.rejects(()=>calibrationChallenge(client,s,'exam'),/context/);
  assert.equal(calls.length,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('uncertain challenge response leaves no fabricated cache; exact input retries safely',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'van-onboarding-test-'))),s=new Store(root),id=randomUUID();
 await s.init();let calls=0;
 const client={async request(path,body){calls++;if(calls===1)throw Error('lost response');return challenge(body.requestId,body.operation);}};
 try{
  await assert.rejects(()=>calibrationChallenge(client,s,'exam'),/saved reviewer/);assert.equal(calls,0);
  await s.write('enroll-prove-result.json',{requestId:id,role:'reviewer',status:'pending'});
  await assert.rejects(()=>calibrationChallenge(client,s,'exam'),/lost response/);assert.equal(await s.read('calibration-exam-challenge.json'),null);
  assert.equal((await calibrationChallenge(client,s,'exam')).reused,false);assert.equal(calls,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
