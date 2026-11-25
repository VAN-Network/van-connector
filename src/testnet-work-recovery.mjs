import {ENVIRONMENT,NETWORK} from './network.mjs';import {canonical} from './canonical.mjs';import {createHash} from 'node:crypto';
export class TestReplyDropped extends Error {constructor(){super('Test work acknowledgement deliberately discarded; retry original event-send');this.name='TestReplyDropped';}}
// Explicit testnet harness, not installed in the normal client. Discards a verified
// acknowledgement locally; it does not claim a physical network failure or SIGKILL.
export function workReplyLossApi(api,store,label){
 if(ENVIRONMENT!=='testnet'||typeof label!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(label))throw Error('Explicit testnet recovery label required');
 return{async request(path,input,options){
  if(!/^\/events\/v1\/orders\/[a-f0-9-]{36}\/work$/.test(path))return api.request(path,input,options);
  const state=await store.read('issuer-'+label+'.json'),body=state?.request?.body;
  if(!state||state.action!=='work'||state.anchor.role!=='worker'||state.result||body?.environmentId!=='testnet'||body.audience!==NETWORK.audience||body.kind!=='worker_submission'||path!=='/events/v1/orders/'+state.anchor.orderId+'/work'||canonical(input)!==canonical({event:body,input:state.input,signature:state.proof?.signature}))throw Error('Recovery probe must match the staged signed worker event');
  const file='recovery-'+label+'.json';if(await store.read(file))throw Error('Recovery probe already attempted; use normal event-send with original label');
  const probe={version:1,phase:'armed',orderId:state.anchor.orderId,eventHash:createHash('sha256').update(canonical(body)).digest('hex')};await store.write(file,probe);
  const result=await api.request(path,input,options);
  if(canonical(result)!==canonical(body))throw Error('Recovery probe received an unexpected acknowledgement');
  await store.write(file,{...probe,phase:'reply_dropped',acknowledgementObservedAt:new Date().toISOString()});
  throw new TestReplyDropped();
 }};
}
