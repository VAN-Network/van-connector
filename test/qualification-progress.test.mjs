import test from 'node:test';import assert from 'node:assert/strict';import {qualificationProgress,qualificationGuidance}from'../src/qualification-progress.mjs';
const examId='11111111-1111-4111-8111-111111111111';
test('reading a bundle is an intermediate step and never a pass',()=>{const p=qualificationProgress({bundle:{examId,cases:[{answer:'PRIVATE_CASE'}]},answers:'PRIVATE_ANSWERS'});assert.equal(p.status,'exam_received');assert.equal(p.qualificationPassed,false);assert.equal(p.nextStep,'prepare_sign_and_submit_own_answers');assert.doesNotMatch(JSON.stringify(p),/PRIVATE/);});
test('an unsubmitted exam explicitly requires own answers',()=>{assert.deepEqual(qualificationProgress({examId,status:'awaiting_submission',nextStep:'complete_calibration'}),{...qualificationGuidance(),status:'awaiting_submission',examId,nextStep:'prepare_sign_and_submit_own_answers',qualificationPassed:false});});
test('grading and credential permission remain distinct',()=>{assert.equal(qualificationProgress({examId,status:'graded',passed:true,admission:{canIssueCredential:false}}).nextStep,'check_admission');assert.equal(qualificationProgress({examId,status:'graded',passed:true,admission:{canIssueCredential:true}}).nextStep,'issue_credential');assert.equal(qualificationProgress({examId,status:'graded',passed:false}).qualificationPassed,false);});
test('malformed or unrecognized results cannot imply a passed exam',()=>{for(const r of [null,{}, {examId:'foreign',status:'graded',passed:true},{examId,status:'graded',passed:'true'}])assert.equal(qualificationProgress(r).qualificationPassed,false);});

test('successful HTTP submission distinguishes a failed exam from waiting admission',()=>{assert.deepEqual(qualificationProgress({reference:'11'.repeat(32),passed:false,accessGranted:false}),{status:'graded',qualificationPassed:false,nextStep:'qualification_not_passed_no_admission'});assert.equal(qualificationProgress({reference:'11'.repeat(32),passed:true,accessGranted:false}).nextStep,'check_admission');assert.equal(qualificationProgress({reference:'invalid',passed:true,accessGranted:false}).qualificationPassed,false);});

test('exam read surfaces the canonical policy without choosing any answer',()=>{
 const p=qualificationProgress({bundle:{examId,cases:[{expectedAnswer:'PRIVATE_CASE'}]}});
 assert.equal(p.policyGuideUrl,'https://test-api.thevan.app/reviewer-onboarding');
 assert.match(p.beforeAnswering,/canonical qualification policy/);
 assert.doesNotMatch(JSON.stringify(p),/PRIVATE_CASE|expectedAnswer/);
});
