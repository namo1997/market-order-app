import pool from '../config/database.js';
import { resolveActorScope } from '../models/receiving-documents-helpers.js';
import { ensureIssueTables } from '../models/receiving-issues-schema.js';
import { ensureQueueTables } from '../models/receiving-queue-schema.js';
import * as store from '../models/receiving-issues-store.js';
import { ERROR_STATUS_BY_CODE } from '../services/receiving-ocr.service.js';
export const safeIssueError = (error,res) => {
  const code=error.type==='entity.too.large'?'IMAGE_TOO_LARGE':error.type==='entity.parse.failed'?'VALIDATION_FAILED':
    error.code==='ER_NO_SUCH_TABLE'?'RECEIVING_NOT_READY':error.code==='ER_DUP_ENTRY'?'NOT_DRAFT':error.code;
  const status=ERROR_STATUS_BY_CODE[code] || 500;
  return res.status(status).json({success:false,code:status===500?'INTERNAL_ERROR':code,
    message:status===500?'ไม่สามารถดำเนินการได้ กรุณาลองใหม่':status===413?'หลักฐานใหญ่เกินกำหนด':
      error.code==='ER_DUP_ENTRY'?'คำขอซ้ำ กรุณาโหลดเรื่องเดิม':status===503?'ระบบติดตามปัญหายังไม่พร้อม':
      error.type==='entity.parse.failed'?'รูปแบบ JSON ไม่ถูกต้อง':error.message});
};
export const endpoint = action => async(req,res) => {
  res.set('Cache-Control','private, no-store');
  try {
    const scope=await resolveActorScope(pool,req.user);
    const user={...req.user,branch_id:scope.branchId,department_id:scope.departmentId};
    await ensureIssueTables(pool);
    const result=await action(req,user,res);
    if(result!==undefined) return res.status(result.created?201:200).json({success:true,data:result});
  } catch(error) { return safeIssueError(error,res); }
};
export const sourceDocument=endpoint((req,user)=>store.issueSourceDocument(pool,user,req.params.documentId));
export const assignees=endpoint((req,user)=>store.listIssueAssignees(pool,user));
export const list=endpoint((req,user)=>store.listIssues(pool,user,req.query));
export const detail=endpoint((req,user)=>store.detailIssue(pool,user,req.params.id));
export const create=endpoint((req,user)=>store.createIssue(pool,user,req.body||{}));
export const update=endpoint(async(req,user)=>{await ensureQueueTables(pool);return store.updateIssue(pool,user,req.params.id,req.body||{});});
export const attach=endpoint((req,user)=>store.attachEvidence(pool,user,req.params.id,req.body||{}));
export const binary=endpoint(async(req,user,res)=>{
  const result=await store.evidenceBinary(pool,user,req.params.id,req.params.evidenceId,req.query.kind);
  res.set('Content-Type',result.mime);res.set('X-Content-Type-Options','nosniff');res.send(result.buffer);
});
