// Wire-format and binding checks only. The agent supplies every judgment.
export const reviewUuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v);
const text=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export function normalizeDecision(decision,requiredCriteria=null,{allowRevise=true}={}){
 if(!decision||Array.isArray(decision)||Object.keys(decision).sort().join(',')!=='checks,reason,verdict')throw Error('Decision must contain only verdict, reason and checks; context is supplied by the connector');
 if(!(allowRevise?['ACCEPT','REJECT','REVISE','INCONCLUSIVE']:['ACCEPT','REJECT','INCONCLUSIVE']).includes(decision.verdict))throw Error('Invalid decision verdict');
 if(!text(decision.reason,2000))throw Error('Decision reason must be nonblank text, at most 2000 characters, without control characters');
 if(!Array.isArray(decision.checks)||decision.checks.length<1||decision.checks.length>32)throw Error('Decision requires 1 to 32 criterion checks');
 if(requiredCriteria!==null&&(!Array.isArray(requiredCriteria)||!requiredCriteria.length||requiredCriteria.length>32||requiredCriteria.some(c=>!text(c,4096))||new Set(requiredCriteria).size!==requiredCriteria.length))throw Error('Invalid assignment criteria');
 const seen=new Set();
 const checks=decision.checks.map(c=>{
  if(!c||Array.isArray(c)||Object.keys(c).some(k=>!['criterion','status','reason','evidenceIds','quote'].includes(k)))throw Error('Each check permits only criterion, status, reason, evidenceIds and quote');
  if(!text(c.criterion,4096)||seen.has(c.criterion)||requiredCriteria!==null&&!requiredCriteria.includes(c.criterion))throw Error('Unknown, duplicate or invalid criterion');
  seen.add(c.criterion);
  if(!['PASS','FAIL','UNVERIFIED'].includes(c.status)||!text(c.reason,1000))throw Error('Each check needs a valid status and nonblank reason of at most 1000 characters');
  if(!Array.isArray(c.evidenceIds)||c.evidenceIds.length>12||c.evidenceIds.some(id=>!reviewUuid(id)))throw Error('Evidence IDs must be at most 12 UUIDs from this assignment');
  const ids=c.evidenceIds.map(id=>id.toLowerCase());
  if(new Set(ids).size!==ids.length)throw Error('Duplicate evidence ID');
  const quote=c.quote??null;
  if(c.status==='UNVERIFIED'){
   if(ids.length||quote!==null)throw Error('UNVERIFIED must use empty evidenceIds and null quote');
  }else if(!ids.length||!text(quote,1000))throw Error('PASS or FAIL requires evidence IDs and an exact nonblank quote of at most 1000 characters');
  return {criterion:c.criterion,status:c.status,reason:c.reason,evidenceIds:ids.sort(),quote};
 });
 if(requiredCriteria!==null&&seen.size!==requiredCriteria.length)throw Error('A check is required for every assignment criterion');
 const unknown=checks.some(c=>c.status==='UNVERIFIED'),fail=checks.some(c=>c.status==='FAIL');
 if(decision.verdict==='ACCEPT'&&(unknown||fail)||['REJECT','REVISE'].includes(decision.verdict)&&(!fail||unknown)||decision.verdict==='INCONCLUSIVE'&&!unknown)throw Error('Inconsistent verdict and criterion statuses');
 return {verdict:decision.verdict,reason:decision.reason,checks};
}
export function reviewContext(context){
 if(!context||!Number.isInteger(context.attempt)||context.attempt<1||context.attempt>9||!reviewUuid(context.dispatchToken)||!digest(context.briefHash)||!digest(context.submissionHash))throw Error('Invalid retained review context');
 return {attempt:context.attempt,dispatchToken:context.dispatchToken,briefHash:context.briefHash,submissionHash:context.submissionHash};
}
export function assembleReview(decision,context,requiredCriteria){
 return {...normalizeDecision(decision,requiredCriteria),...reviewContext(context)};
}
export function assembleQualificationAnswers(bundle,answers){
 if(!Array.isArray(bundle?.cases)||!bundle.cases.length||!Array.isArray(answers)||answers.length!==bundle.cases.length)throw Error('Supply exactly one own decision per received case');
 const cases=new Map();
 for(const c of bundle.cases){if(!c||typeof c.caseId!=='string'||!c.caseId||cases.has(c.caseId))throw Error('Invalid or duplicate received case');cases.set(c.caseId,c);}
 const seen=new Set();
 return answers.map(a=>{
  const keys=Object.keys(a??{}).sort().join(',');
  if(!a||!['caseId,decision','caseId,review'].includes(keys)||!cases.has(a.caseId)||seen.has(a.caseId))throw Error('Each answer needs its unique received caseId and decision; extra or duplicate cases are refused');
  seen.add(a.caseId);const c=cases.get(a.caseId);let decision;
  if(keys==='caseId,decision')decision=a.decision;
  else{
   if(!a.review||Object.keys(a.review).sort().join(',')!=='attempt,briefHash,checks,dispatchToken,reason,submissionHash,verdict')throw Error('Invalid legacy review fields');
   for(const [k,v]of Object.entries(reviewContext(c)))if(a.review[k]!==v)throw Error('Legacy review context differs from the retained case');
   decision={verdict:a.review.verdict,reason:a.review.reason,checks:a.review.checks};
  }
  const review=assembleReview(decision,c,c.requiredCriteria);
  if(!Array.isArray(c.evidence)||!Array.isArray(c.sourceAttempts)||!c.sourceAttempts.length)throw Error('Retained case evidence and source attempts required');
  for(const check of review.checks){
   if(check.status==='UNVERIFIED')continue;
   const own=c.evidence.filter(e=>check.evidenceIds.includes(e.id?.toLowerCase()));
   if(own.length!==check.evidenceIds.length||!check.evidenceIds.every(id=>c.sourceAttempts.some(s=>s.outcome==='verified'&&s.evidence_id?.toLowerCase()===id)))throw Error('Evidence ID is not verified for this received case');
   if(!own.some(e=>typeof e.excerpt==='string'&&e.excerpt.includes(check.quote)))throw Error('Quote is not present in cited case evidence');
  }
  if(c.sourceAttempts.some(s=>['not_fetched_policy_blocked','not_fetched_no_supported_citation'].includes(s.outcome))&&(review.verdict!=='INCONCLUSIVE'||review.checks.some(c=>c.status!=='UNVERIFIED')))throw Error('No-fetch witness permits only UNVERIFIED INCONCLUSIVE');
  return {caseId:a.caseId,review};
 });
}
