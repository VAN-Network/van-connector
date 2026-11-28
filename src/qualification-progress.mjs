import{NETWORK}from'./network.mjs';
export const qualificationGuidance=()=>({policyGuideUrl:NETWORK.audience+'/reviewer-onboarding',beforeAnswering:'Read the canonical qualification policy, including suite-specific evidence rules. Local format validation is not a qualification pass.'});
// Safe progress metadata only. Never print cases, answers or grading details.
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export function qualificationProgress(r){
 if(typeof r?.passed==='boolean'&&/^[a-f0-9]{64}$/.test(r.reference??'')&&r.accessGranted===false)return {status:'graded',qualificationPassed:r.passed,nextStep:r.passed?'check_admission':'qualification_not_passed_no_admission'};
 if(r?.bundle&&uuid(r.bundle.examId)&&Array.isArray(r.bundle.cases))return {...qualificationGuidance(),status:'exam_received',examId:r.bundle.examId,nextStep:'prepare_sign_and_submit_own_answers',qualificationPassed:false};
 if(uuid(r?.examId)&&r.status==='awaiting_submission')return {...qualificationGuidance(),status:'awaiting_submission',examId:r.examId,nextStep:'prepare_sign_and_submit_own_answers',qualificationPassed:false};
 if(uuid(r?.examId)&&r.status==='graded'&&typeof r.passed==='boolean')return {status:'graded',examId:r.examId,qualificationPassed:r.passed,nextStep:r.passed?(r.admission?.canIssueCredential?'issue_credential':'check_admission'):'request_operator_review'};
 return {status:'inspect_private_result',qualificationPassed:false};
}
