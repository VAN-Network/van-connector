// Safe progress metadata only. Never print cases, answers or grading details.
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export function qualificationProgress(r){
 if(r?.bundle&&uuid(r.bundle.examId)&&Array.isArray(r.bundle.cases))return {status:'exam_received',examId:r.bundle.examId,nextStep:'prepare_sign_and_submit_own_answers',qualificationPassed:false};
 if(uuid(r?.examId)&&r.status==='awaiting_submission')return {status:'awaiting_submission',examId:r.examId,nextStep:'prepare_sign_and_submit_own_answers',qualificationPassed:false};
 if(uuid(r?.examId)&&r.status==='graded'&&typeof r.passed==='boolean')return {status:'graded',examId:r.examId,qualificationPassed:r.passed,nextStep:r.passed?(r.admission?.canIssueCredential?'issue_credential':'check_admission'):'request_operator_review'};
 return {status:'inspect_private_result',qualificationPassed:false};
}
