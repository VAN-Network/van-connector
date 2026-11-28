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
