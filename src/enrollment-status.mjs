import{ENVIRONMENT}from'./network.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const wallet=v=>typeof v==='string'&&/^0x[a-f0-9]{40}$/i.test(v);
export async function refreshEnrollment(client,store){
 if(ENVIRONMENT!=='testnet')throw Error('Enrollment status replay is testnet-only');
 const proof=await store.read('enroll-prove-pending.json');
 if(!proof)return null;
 if(Object.keys(proof).sort().join(',')!=='challengeId,signature'||!uuid(proof.challengeId)||!/^0x[a-f0-9]{130}$/i.test(proof.signature))throw Error('Invalid retained enrollment proof');
 const old=await store.read('enroll-prove-result.json');
 if(!old||!uuid(old.requestId)||!wallet(old.wallet)||!['buyer','worker','reviewer'].includes(old.role))throw Error('Confirmed enrollment result required; reconcile the original enroll-prove first');
 // Replay the exact already-frozen authentication proof. Never create a new
 // challenge, key or signature, and never treat admission as authenticated access.
 const result=await client.request('/agents/enrollment/prove',proof,{auth:false});
 if(!uuid(result?.requestId)||!wallet(result.wallet)||!['buyer','worker','reviewer'].includes(result.role)||!['pending','admitted','rejected'].includes(result.status)||result.accessGranted!==false||
   old&&['requestId','wallet','role'].some(k=>result[k]!==old[k]))throw Error('Enrollment status context changed');
 await store.write('enroll-prove-result.json',result);
 return{requestId:result.requestId,wallet:result.wallet,role:result.role,status:result.status,
  nextStep:result.status==='admitted'?'credential-challenge '+result.requestId:result.status==='pending'?'operator_admission':'request_rejected',
  authenticatedAccessGranted:false};
}
