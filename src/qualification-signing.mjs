import {readdir}from'node:fs/promises';
import {createHash}from'node:crypto';
import {canonical}from'./canonical.mjs';
import {validQualificationSubmission}from'./qualification-recovery.mjs';
import {ENVIRONMENT,NETWORK}from'./network.mjs';
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const prefix='THE VAN reviewer qualification only. This signature does not authorize payments or grant access.\n\n';
export function validateQualificationAnswerFormat(answers){
 if(!Array.isArray(answers)||!answers.length)throw Error('Own answers array required');
 for(const a of answers){
  if(!a||Object.keys(a).sort().join(',')!=='caseId,review'||typeof a.caseId!=='string'||!a.review||Object.keys(a.review).sort().join(',')!=='attempt,briefHash,checks,dispatchToken,reason,submissionHash,verdict')throw Error('Each answer must be exactly {caseId,review}; review must contain exactly attempt, dispatchToken, briefHash, submissionHash, verdict, reason, checks. Preserve context from the received case and evaluate its evidence yourself. See docs/external-testnet-acceptance.md');
 }
}

export async function prepareQualificationSigning(store,input,now=Date.now()){
 if(ENVIRONMENT!=='testnet')throw Error('Qualification preparation is testnet-only');
 const own=await store.read('enroll-prove-result.json');
 if(own?.role!=='reviewer')throw Error('Own reviewer enrollment required');
 const answers=Array.isArray(input)?input:input?.answers,requested=Array.isArray(input)?null:input?.examId;
 if(!Array.isArray(answers)||!answers.length||answers.length>50||!Array.isArray(input)&&Object.keys(input??{}).sort().join(',')!=='answers,examId')throw Error('Use an answers array or exactly examId and answers');
 validateQualificationAnswerFormat(answers);
 const names=(await readdir(store.root)).filter(n=>/^qualification-read-history-[a-f0-9-]+\.json$/.test(n));
 if(names.length>1000)throw Error('Qualification history requires reconciliation');
 const candidates=new Map();
 for(const name of names){const h=await store.read(name),r=h?.result,b=r?.bundle;
  if(!b||requested&&b.examId!==requested)continue;
  if(b.wallet!==own.wallet||b.requestId!==own.requestId||b.chainId!==84532||b.audience!==NETWORK.audience||Date.parse(b.expiresAt)<=now||!Number.isFinite(Date.parse(b.expiresAt)))continue;
  if(!/^[a-f0-9]{64}$/.test(r.bundleHash??'')||hash(b)!==r.bundleHash)throw Error('Stored exam bundle hash mismatch');
  candidates.set(b.examId,{bundle:b,bundleHash:r.bundleHash});
 }
 if(candidates.size!==1)throw Error('A unique own unexpired exam read is required; read your exam or specify its examId');
 const {bundle,bundleHash}=[...candidates.values()][0];
 const pending=await store.read('qualification-submit-pending.json');
 if(validQualificationSubmission(pending)&&pending.examId===bundle.examId&&hash(pending.answers)!==hash(answers))throw Error('Reconcile the exact pending signed submission before changing answers');
 const prepared={examId:bundle.examId,answers};
 const request={signingMethod:'personal_sign',message:prefix+canonical({action:'van.reviewer-qualification.v1',chainId:84532,audience:NETWORK.audience,examId:bundle.examId,bundleHash,answersHash:hash(answers)})};
 await store.write('qualification-prepared-answers.json',prepared);await store.write('qualification-answer-signing-request.json',request);
 return {signingRequestFile:store.path('qualification-answer-signing-request.json'),examId:bundle.examId,nextStep:'Sign this exact request with your own wallet, then qualification-proof SIGNATURE.json',paymentAuthorized:false};
}
export async function qualificationProof(store,proof){
 if(ENVIRONMENT!=='testnet')throw Error('Qualification preparation is testnet-only');
 if(!proof||Object.keys(proof).join(',')!=='signature'||typeof proof.signature!=='string'||!/^0x[a-f0-9]{130}$/i.test(proof.signature??''))throw Error('Own wallet signature JSON required');
 const prepared=await store.read('qualification-prepared-answers.json'),request=await store.read('qualification-answer-signing-request.json');
 if(!prepared||!request?.message?.startsWith(prefix))throw Error('Prepare own answers before assembling proof');
 const payload=JSON.parse(request.message.slice(prefix.length));
 if(payload.examId!==prepared.examId||payload.answersHash!==hash(prepared.answers)||payload.action!=='van.reviewer-qualification.v1'||payload.chainId!==84532||payload.audience!==NETWORK.audience)throw Error('Prepared answer context changed');
 await store.write('qualification-submit-ready.json',{...prepared,signature:proof.signature});
 return {submissionFile:store.path('qualification-submit-ready.json'),nextStep:'qualification-submit '+store.path('qualification-submit-ready.json'),paymentAuthorized:false};
}
