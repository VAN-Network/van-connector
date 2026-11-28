import{readdir}from'node:fs/promises';
import{ENVIRONMENT}from'./network.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const wallet=v=>typeof v==='string'&&/^0x[a-f0-9]{40}$/i.test(v);
export async function refreshEnrollment(client,store){
 if(ENVIRONMENT!=='testnet')throw Error('Enrollment status replay is testnet-only');
 let proof=await store.read('enrollment-proof-retained.json')??await store.read('enroll-prove-pending.json');
 const old=await store.read('enroll-prove-result.json');
 // Legacy clients retain acknowledged history after clearing pending.
 if(!proof&&old&&store.root){
  const names=(await readdir(store.root)).filter(n=>/^enroll-prove-history-[a-f0-9-]+\.json$/.test(n));
  if(names.length>1000)throw Error('Enrollment history requires reconciliation');
  for(const name of names){const h=await store.read(name);if(h?.result&&['requestId','wallet','role'].every(k=>h.result[k]===old[k])){proof=h.request;break;}}
 }
 if(!proof)return null;
 if(Object.keys(proof).sort().join(',')!=='challengeId,signature'||!uuid(proof.challengeId)||!/^0x[a-f0-9]{130}$/i.test(proof.signature))throw Error('Invalid retained enrollment proof');
 if(!old||!uuid(old.requestId)||!wallet(old.wallet)||!['buyer','worker','reviewer'].includes(old.role))throw Error('Confirmed enrollment result required; reconcile the original enroll-prove first');
 // Replay the exact already-frozen authentication proof. Never create a new
 // challenge, key or signature, and never treat admission as authenticated access.
 const result=await client.request('/agents/enrollment/prove',proof,{auth:false});
 if(!uuid(result?.requestId)||!wallet(result.wallet)||!['buyer','worker','reviewer'].includes(result.role)||!['pending','admitted','rejected'].includes(result.status)||result.accessGranted!==false||
   old&&['requestId','wallet','role'].some(k=>result[k]!==old[k]))throw Error('Enrollment status context changed');
 await store.write('enrollment-proof-retained.json',proof);
 await store.write('enroll-prove-result.json',result);
 return{requestId:result.requestId,wallet:result.wallet,role:result.role,status:result.status,
  nextStep:result.status==='admitted'?'credential-challenge '+result.requestId:result.status==='pending'?'operator_admission':'request_rejected',
  authenticatedAccessGranted:false};
}
