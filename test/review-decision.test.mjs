import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDecision,assembleReview,assembleQualificationAnswers}from'../src/review-decision.mjs';
const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222';
function fixture(){
 const context={attempt:2,dispatchToken:token,briefHash:'ab'.repeat(32),submissionHash:'cd'.repeat(32)};
 const decision={verdict:'ACCEPT',reason:'Own assessment',checks:[{criterion:'Check synthetic evidence',status:'PASS',reason:'Supported by the supplied excerpt',evidenceIds:[id],quote:'Exact café evidence.'}]};
 const c={...context,caseId:'one',requiredCriteria:['Check synthetic evidence'],evidence:[{id,excerpt:'Prefix. Exact café evidence. Suffix.'}],sourceAttempts:[{outcome:'verified',evidence_id:id}]};
 return {context,decision,c,bundle:{cases:[c]}};
}
test('context comes from the retained assignment and input judgments are untouched',()=>{
 const {context,decision,c}=fixture(),before=structuredClone(decision);
 const review=assembleReview(decision,context,c.requiredCriteria);
 assert.deepEqual(decision,before);for(const [k,v]of Object.entries(context))assert.equal(review[k],v);
 assert.equal(review.verdict,decision.verdict);assert.equal(review.reason,decision.reason);assert.deepEqual(review.checks,decision.checks);
});
test('all supported outcomes are validated without selecting an outcome',()=>{
 for(const verdict of ['ACCEPT','REJECT','REVISE','INCONCLUSIVE']){
  const {decision,c}=fixture();decision.verdict=verdict;
  if(verdict==='REJECT'||verdict==='REVISE')decision.checks[0].status='FAIL';
  if(verdict==='INCONCLUSIVE')Object.assign(decision.checks[0],{status:'UNVERIFIED',evidenceIds:[],quote:null});
  assert.equal(normalizeDecision(decision,c.requiredCriteria).verdict,verdict);
 }
});
test('bad context, service-field injection and unsafe text fail before signing',()=>{
 for(const patch of [{attempt:0},{attempt:10},{attempt:'1'},{dispatchToken:'synthetic'},{briefHash:'bad'},{submissionHash:'0x'+'ab'.repeat(32)}]){
  const {context,decision,c}=fixture();assert.throws(()=>assembleReview(decision,{...context,...patch},c.requiredCriteria),/context/);
 }
 for(const patch of [{attempt:1},{dispatchToken:token},{reason:''},{reason:'x'.repeat(2001)},{reason:'bad\u0000reason'}]){
  const {decision,c}=fixture();assert.throws(()=>normalizeDecision({...decision,...patch},c.requiredCriteria));
 }
});
test('every criterion appears exactly once, with no invented or missing checks',()=>{
 for(const mutate of [d=>d.checks=[],d=>d.checks.push({...d.checks[0]}),d=>d.checks[0].criterion='Other',d=>d.checks[0].reason='']){
  const {decision,c}=fixture();mutate(decision);assert.throws(()=>normalizeDecision(decision,c.requiredCriteria));
 }
 const {decision}=fixture();assert.throws(()=>normalizeDecision(decision,['Check synthetic evidence','Second']));
});
test('unsupported checks, invented ID forms, duplicate IDs and evidence-free PASS fail',()=>{
 for(const patch of [{status:'UNKNOWN'},{evidenceIds:['fake']},{evidenceIds:[id,id.toUpperCase()]},{evidenceIds:[]},{quote:null},{quote:'x'.repeat(1001)},{extra:'not allowed'}]){
  const {decision,c}=fixture();Object.assign(decision.checks[0],patch);assert.throws(()=>normalizeDecision(decision,c.requiredCriteria));
 }
});
test('inconsistent verdicts fail without automatic repair',()=>{
 for(const verdict of ['REJECT','REVISE','INCONCLUSIVE']){
  const {decision,c}=fixture();decision.verdict=verdict;assert.throws(()=>normalizeDecision(decision,c.requiredCriteria),/Inconsistent/);
 }
 for(const status of ['FAIL','UNVERIFIED']){
  const {decision,c}=fixture();decision.checks[0].status=status;
  if(status==='UNVERIFIED')Object.assign(decision.checks[0],{evidenceIds:[],quote:null});
  assert.throws(()=>normalizeDecision(decision,c.requiredCriteria),/Inconsistent/);
 }
});
test('case decisions assemble the complete legacy wire format from trusted case context',()=>{
 const {decision,c,bundle}=fixture();const result=assembleQualificationAnswers(bundle,[{caseId:'one',decision}]);
 assert.deepEqual(result,[{caseId:'one',review:assembleReview(decision,c,c.requiredCriteria)}]);
 assert.deepEqual(assembleQualificationAnswers(bundle,result),result);
});
test('legacy context substitution, missing/extra/duplicate cases cannot be silently repaired',()=>{
 const {decision,c,bundle}=fixture(),review=assembleReview(decision,c,c.requiredCriteria);
 for(const patch of [{attempt:1},{dispatchToken:'33333333-3333-4333-8333-333333333333'},{briefHash:'ee'.repeat(32)}])assert.throws(()=>assembleQualificationAnswers(bundle,[{caseId:'one',review:{...review,...patch}}]),/context differs/);
 for(const input of [[],[{caseId:'other',decision}],[{caseId:'one',decision,attempt:1}],[{caseId:'one',decision},{caseId:'one',decision}]])assert.throws(()=>assembleQualificationAnswers(bundle,input));
 const two={cases:[c,{...structuredClone(c),caseId:'two'}]};assert.throws(()=>assembleQualificationAnswers(two,[{caseId:'one',decision},{caseId:'one',decision}]),/duplicate cases/);
});
test('foreign evidence, altered quote and unavailable source cannot pass local binding checks',()=>{
 for(const mutate of [f=>f.decision.checks[0].quote='Invented quote',f=>f.c.sourceAttempts[0].outcome='unavailable',f=>f.c.evidence=[],f=>f.decision.checks[0].evidenceIds=['33333333-3333-4333-8333-333333333333']]){
  const f=fixture();mutate(f);assert.throws(()=>assembleQualificationAnswers(f.bundle,[{caseId:'one',decision:f.decision}]));
 }
});
test('unavailable and no-fetch sources allow honest unknowns, never fabricate a witness',()=>{
 const {decision,c,bundle}=fixture();decision.verdict='INCONCLUSIVE';Object.assign(decision.checks[0],{status:'UNVERIFIED',evidenceIds:[],quote:null});
 c.evidence=[];c.sourceAttempts=[{outcome:'not_fetched_policy_blocked',evidence_id:null}];
 assert.equal(assembleQualificationAnswers(bundle,[{caseId:'one',decision}])[0].review.verdict,'INCONCLUSIVE');
 c.sourceAttempts=[];assert.throws(()=>assembleQualificationAnswers(bundle,[{caseId:'one',decision}]),/source attempts/);
});
