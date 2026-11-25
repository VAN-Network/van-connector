#!/usr/bin/env node
import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {ENVIRONMENT,validateIdentity} from '../src/network.mjs';import {Store} from '../src/store.mjs';import {VanClient} from '../src/api.mjs';import {GatewayIssuerClient,submitIssuerEvent} from '../src/issuer.mjs';import {canonical} from '../src/canonical.mjs';import {workReplyLossApi,TestReplyDropped} from '../src/testnet-work-recovery.mjs';
async function json(file){const bytes=await readFile(file);if(bytes.length>16384)throw Error('Input too large');return JSON.parse(bytes.toString('utf8'));}
async function main(){
 if(ENVIRONMENT!=='testnet')throw Error('Recovery probe is testnet-only');
 const [label,configFile,proofFile,...extra]=process.argv.slice(2);if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(label??'')||!configFile||!proofFile||extra.length)throw Error('Use LABEL CONFIG.json SIGNATURE.json for a selected test only');
 const root=new Store(resolve(process.env.VAN_STATE_DIR??'.van-connector'));await root.init();const identity=validateIdentity(await root.read('identity.json'));
 if(identity.role!=='worker')throw Error('Own admitted worker identity required');
 const credential=await root.read('credential.json'),api=new VanClient({token:credential?.token}),me=await api.me();if(me.role!=='worker'||me.source!=='registry')throw Error('Registered worker required');
 const settings=await json(configFile),store=new Store(root.root+'/issuer-events');await store.init();const state=await store.read('issuer-'+label+'.json');
 if(!settings||Object.keys(settings).sort().join(',')!=='anchor,authorityId'||!state||state.action!=='work'||state.anchor.wallet!==me.wallet?.toLowerCase()||canonical(state.anchor)!==canonical({...settings.anchor,authorityId:settings.authorityId,wallet:settings.anchor.wallet.toLowerCase()}))throw Error('Pinned own worker assignment required');
 const client=new GatewayIssuerClient({api:workReplyLossApi(api,store,label),authorityId:settings.authorityId});
 await submitIssuerEvent(client,store,label,await json(proofFile));throw Error('Probe did not discard a work acknowledgement');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{
 if(e instanceof TestReplyDropped){console.log(JSON.stringify({faultInjected:true,mode:'client_discarded_verified_work_reply',nextStep:'Restart with normal event-send using the same state, config, label and proof. No new signature or report.',paymentSent:false}));process.exitCode=75;}
 else{console.error(JSON.stringify({faultInjected:false,error:e.message}));process.exitCode=1;}
});
