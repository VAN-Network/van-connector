import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileQualificationRead} from '../src/qualification-recovery.mjs';
const old={challengeId:'11111111-1111-4111-8111-111111111111',signature:'0x'+'11'.repeat(65)};
function fixture(){const log=[];return {log,store:{write:async(name,value)=>log.push({name,value}),remove:async name=>log.push({remove:name})}};}
test('expired read is rechecked and durably archived before allowing replacement',async()=>{
 const {log,store}=fixture();await reconcileQualificationRead({request:async(path,body,options)=>{assert.equal(path,'/qualification/read');assert.deepEqual(body,old);assert.deepEqual(options,{auth:false});throw Object.assign(Error('expired'),{status:410,code:'qualification_challenge_expired'});}},store,old);
 assert.equal(log[0].value.resolution.status,'expired');assert.deepEqual(log[0].value.request,old);assert.equal(log[1].remove,'qualification-read-pending.json');
});
test('a previously acknowledged read is archived without submitting or resetting the exam',async()=>{
 const {log,store}=fixture();await reconcileQualificationRead({request:async(path)=>{assert.equal(path,'/qualification/read');return {bundleHash:'example'};}},store,old);assert.equal(log[0].value.resolution.status,'acknowledged');assert.equal(log.length,2);
});
test('network uncertainty and unrelated rejections preserve pending proof',async()=>{
 for(const error of [Error('lost acknowledgement'),Object.assign(Error('forbidden'),{status:403,code:'invalid_signature'}),Object.assign(Error('other'),{status:410,code:'other_expiry'})]){
 const {log,store}=fixture();await assert.rejects(reconcileQualificationRead({request:async()=>{throw error;}},store,old));assert.equal(log.length,0);
 }
});
test('archive failure cannot discard a pending proof',async()=>{
 let removed=false;await assert.rejects(reconcileQualificationRead({request:async()=>({})},{write:async()=>{throw Error('disk full')},remove:async()=>{removed=true}},old));assert.equal(removed,false);
});
