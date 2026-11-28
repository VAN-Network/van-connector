// Only reconciles a read-only exam access proof. Never resets or submits an exam.
import {randomUUID} from 'node:crypto';
export async function reconcileQualificationRead(client,store,old){
 let resolution;
 try{resolution={status:'acknowledged',result:await client.request('/qualification/read',old,{auth:false})};}
 catch(e){if(e.status!==410||e.code!=='qualification_challenge_expired')throw e;resolution={status:'expired',httpStatus:410,code:e.code};}
 await store.write('qualification-read-reconciled-'+randomUUID()+'.json',{request:old,resolution});
 await store.remove('qualification-read-pending.json');
}

export function validQualificationSubmission(body){
 return !!body&&Object.keys(body).sort().join(',')==='answers,examId,signature'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.examId??'')&&typeof body.signature==='string'&&/^0x[a-f0-9]{130}$/i.test(body.signature);
}
export async function reconcileMalformedSubmission(store,old){
 if(validQualificationSubmission(old))throw Error('Pending signed qualification differs; reconcile the exact old submission first');
 // Identical to the server pre-transaction proof-shape guard: such a body
 // cannot record an attempt. Never discard a structurally valid signed answer.
 await store.write('qualification-submit-malformed-'+randomUUID()+'.json',{request:old,resolution:'invalid_proof_shape_before_transaction'});
 await store.remove('qualification-submit-pending.json');
}

export async function reconcileRejectedQualification(client,store){
 const old=await store.read('qualification-submit-pending.json');
 if(!old)return {status:'nothing_pending'};
 if(!validQualificationSubmission(old)){await reconcileMalformedSubmission(store,old);return {status:'invalid_proof_archived',nextStep:'prepare_own_signed_answers'};}
 let rejected;
 try{const result=await client.request('/qualification/submit',old,{auth:false});await store.write('qualification-submit-result.json',result);}
 catch(e){
  if(e.status!==400||e.code!=='invalid_qualification_answers')throw e;
  rejected={status:400,code:e.code};
 }
 if(!rejected)throw Error('The original attempt was acknowledged; read its result and do not replace signed answers');
 await store.write('qualification-submit-rejected-'+randomUUID()+'.json',{request:old,resolution:rejected});
 await store.remove('qualification-submit-pending.json');
 return {status:'invalid_answer_format_archived',nextStep:'correct_own_answer_schema_then_prepare_sign_submit'};
}
