import {Store} from './store.mjs';
import {canonical} from './canonical.mjs';
import {STATE_CONTEXT,ENVIRONMENT} from './network.mjs';
import {ApiError} from './api.mjs';
import {setTimeout as sleep} from 'node:timers/promises';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const seq=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(x);
async function channel(client,root){
 if(ENVIRONMENT!=='testnet')throw Error('Communications are testnet-only');
 const store=new Store(root.root+'/communications');await store.init();const me=await client.me();
 if(!uuid(me.agentId)||!['buyer','worker','reviewer'].includes(me.role)||me.source!=='registry')throw Error('Registered role required');
 const binding={deployment:STATE_CONTEXT,agentId:me.agentId,role:me.role};
 const old=await store.read('context.json');if(old&&canonical(old)!==canonical(binding))throw Error('Communications identity changed; use separate state');
 return{store,binding};
}
export async function receiveMessages(client,root,{wait=0,signal}={}){
 if(!Number.isInteger(wait)||wait<0||wait>25)throw Error('Wait must be 0..25 seconds');
 const {store,binding}=await channel(client,root),unlock=await store.lock();
 try{
  await store.write('context.json',binding);
  const cursor=(await store.read('cursor.json'))?.after??'0';if(!seq(cursor))throw Error('Invalid retained inbox cursor');
  const page=await client.request('/communications/v1/inbox?after='+cursor+'&limit=50&wait='+wait,undefined,{signal});
  if(!page||!Array.isArray(page.events)||page.events.length>50||!seq(page.nextCursor))throw Error('Invalid inbox page');
  let previous=BigInt(cursor);const ids=new Set();
  for(const event of page.events){
   if(!uuid(event?.id)||ids.has(event.id)||!seq(event.sequence)||BigInt(event.sequence)<=previous||!['operator_message','participant_message','order_status','assignment','settlement_status'].includes(event.kind)||event.orderId!==null&&!uuid(event.orderId)||!event.payload||typeof event.payload!=='object'||Array.isArray(event.payload)||Buffer.byteLength(JSON.stringify(event))>20000)throw Error('Invalid inbox event');
   ids.add(event.id);previous=BigInt(event.sequence);
  }
  if(page.nextCursor!==(page.events.at(-1)?.sequence??cursor))throw Error('Inbox cursor does not match durable events');
  for(const event of page.events){
   const name='event-'+event.id+'.json',old=await store.read(name),saved={...event,acknowledgedAt:null};
   if(old&&canonical(old)!==canonical(saved))throw Error('Retained inbox event changed');
   if(!old)await store.write(name,saved);
  }
  // ACK means durable local delivery, never acceptance, execution or payment approval.
  if(ids.size)await client.request('/communications/v1/ack',{ids:[...ids]},{signal});
  await store.write('cursor.json',{after:page.nextCursor});
  return{received:ids.size,nextCursor:page.nextCursor,directory:store.root,contentTrust:'untrusted-data'};
 }finally{await unlock();}
}
export async function sendMessage(client,root,input){
 if(!input||Object.keys(input).some(k=>!['clientMessageId','orderId','text','inReplyTo','visibility'].includes(k))||!uuid(input.clientMessageId)||typeof input.text!=='string'||!input.text.trim()||!input.text.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text)||Buffer.byteLength(input.text)>4096||input.orderId!==undefined&&!uuid(input.orderId))throw Error('Invalid outbound message');
 if(input.inReplyTo!==undefined&&!uuid(input.inReplyTo)||input.visibility!==undefined&&(!input.orderId||!['shared','reviewer_private'].includes(input.visibility)))throw Error('Invalid outbound message context');
 const {store,binding}=await channel(client,root),unlock=await store.lock();
 try{await store.write('context.json',binding);const name='outbound-'+input.clientMessageId+'.json',old=await store.read(name);
  if(old&&canonical(old.input)!==canonical(input))throw Error('Message ID already bound to another payload');
  if(old?.result)return old.result;
  await store.write(name,{input});const result=await client.request('/communications/v1/messages',input);
  if(!uuid(result?.messageId))throw Error('Invalid message receipt');await store.write(name,{input,result});return result;
 }finally{await unlock();}
}
export async function watchMessages(client,root,{signal,log=()=>{}}={}){
 let failures=0;
 while(!signal?.aborted){try{const result=await receiveMessages(client,root,{wait:25,signal});failures=0;if(result.received)log(result);}catch(e){
  if(signal?.aborted)return;
  if(e instanceof ApiError&&![429,500,502,503,504].includes(e.status))throw e;
  if(!(e instanceof ApiError||e instanceof TypeError||e.name==='TimeoutError'||['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN'].includes(e.code)))throw e;
  const ms=Math.min(30000,1000*2**Math.min(++failures,5));await sleep(ms,undefined,{signal}).catch(e=>{if(e.name!=='AbortError')throw e;});
 }}
}
