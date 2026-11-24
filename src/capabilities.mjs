// Exact, versioned requirements. Display tags and self-declarations confer no admission.
export function normalizeCapabilityRequirements(value) {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='reviewer,version,worker'||value.version!=='van-capability-requirements-v1')throw Error('invalid_capability_requirements');
 const out={version:value.version};
 for(const role of ['worker','reviewer']){
  const list=value[role];if(!Array.isArray(list)||list.length<1||list.length>8)throw Error('invalid_capability_requirements');
  const seen=new Set();out[role]=list.map(item=>{
   if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join(',')!=='id,version'||typeof item.id!=='string'||!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){1,5}$/.test(item.id)||item.id.length>96||!Number.isSafeInteger(item.version)||item.version<1||item.version>1000000)throw Error('invalid_capability_requirements');
   const key=item.id+'@'+item.version;if(seen.has(key))throw Error('duplicate_capability_requirement');seen.add(key);return{id:item.id,version:item.version};
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:a.version-b.version);
 }
 return out;
}
export function validCapabilityTask(brief,requirements) {
 // This first qualification supports only the frozen chain-ID exercise, not general research or RPC.
 return [...requirements.worker,...requirements.reviewer].every(x=>x.id!=='research.chainid'||
  (brief.language?.trim().toLowerCase()==='en'&&brief.acceptanceCriteria?.length===1&&brief.acceptanceCriteria[0]==='State that the Base Sepolia chain ID is 84532.'));
}
