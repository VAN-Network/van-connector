import{readFile,lstat,realpath}from'node:fs/promises';import{isAbsolute,dirname,resolve}from'node:path';import{pathToFileURL}from'node:url';
import{ParticipantBridge}from'./participant-bridge.mjs';import{A2AWorker}from'./a2a-worker.mjs';
export async function loadA2AStepConfig(path){
 if(!isAbsolute(path??''))throw Error('private_a2a_config_required');const s=await lstat(path),d=await lstat(dirname(path));
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>16384||(s.mode&0o077)||![0,process.getuid()].includes(s.uid)||!d.isDirectory()||d.isSymbolicLink()||(d.mode&0o077)||![0,process.getuid()].includes(d.uid)||await realpath(path)!==path)throw Error('unsafe_a2a_config');
 const c=JSON.parse(await readFile(path,'utf8')),keys=['environmentId','role','agentId','instanceId','stateDir','issuer','peer'];
 if(Object.keys(c).sort().join(',')!==keys.sort().join(',')||c.environmentId!=='testnet'||c.role!=='worker')throw Error('invalid_a2a_step_configuration');
 if(!c.issuer||Object.keys(c.issuer).sort().join(',')!=='anchorDirectory,authorityId,socketPath,wallet')throw Error('invalid_a2a_step_configuration');
 for(const p of[c.stateDir,c.issuer.anchorDirectory])if(!isAbsolute(p)||await realpath(p)!==p)throw Error('unsafe_a2a_directory');
 return c;
}
export async function a2aStep(config){const{peer,...binding}=config,bridge=new ParticipantBridge(binding);await bridge.init();const a=await bridge.assignment();if(!a)throw Error('a2a_assignment_not_ready');const worker=new A2AWorker(bridge,peer);await worker.init();return worker.step(a.assignmentId);}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{if(process.env.VAN_NETWORK==='mainnet'||process.env.VAN_ENVIRONMENT!=='testnet'||process.argv.length!==3)throw Error('explicit_testnet_a2a_config_required');console.log(JSON.stringify(await a2aStep(await loadA2AStepConfig(process.argv[2]))));}catch(e){console.error(JSON.stringify({phase:'refused',error:/^[a-z_]{1,80}$/.test(e.message)?e.message:'a2a_step_refused',valuesPrinted:false}));process.exitCode=2;}}
