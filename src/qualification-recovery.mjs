// Only reconciles a read-only exam access proof. Never resets or submits an exam.
import {randomUUID} from 'node:crypto';
export async function reconcileQualificationRead(client,store,old){
 let resolution;
 try{resolution={status:'acknowledged',result:await client.request('/qualification/read',old,{auth:false})};}
 catch(e){if(e.status!==410||e.code!=='qualification_challenge_expired')throw e;resolution={status:'expired',httpStatus:410,code:e.code};}
 await store.write('qualification-read-reconciled-'+randomUUID()+'.json',{request:old,resolution});
 await store.remove('qualification-read-pending.json');
}
