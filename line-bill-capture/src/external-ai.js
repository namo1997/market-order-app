// ตัวอ่านรูปภายนอกแบบ subscription (Claude Code / Codex บน iMac ของเจ้าของ)
// เซิร์ฟเวอร์ไม่เรียก AI เอง: ตัวอ่านจองรูปทีละใบ ดาวน์โหลดรูป อ่านด้วย AI ที่ล็อกอินไว้ แล้วส่ง JSON กลับ
// ผลที่ส่งกลับผ่าน normalize + กฎแชท/ผูกข้อความเดียวกับ worker ปกติ แล้วจึงจับคู่บิล–สลิปตามเดิม
import crypto from 'crypto';
import {
  BILL_CAPTURE_ANALYSIS_SCHEMA,
  analyzeItem,
  buildVisionPrompt,
  collectAnalysisContext,
  finishAnalysisBatch,
  getAiConfig,
  getAiWorkerStatus,
  mimeFromItem,
  normalizeAnalysis,
  storeAnalysisFailure,
  storeAnalysisResult
} from './ai-worker.js';
import {
  getAppSetting,
  getItemById,
  listAiLearningExamples,
  listAiQueueItems,
  markAiProcessing,
  releaseAiClaim,
  setAppSetting
} from './db.js';

export const EXTERNAL_PROVIDER = 'external';
const AGENT_NAMES = new Set(['claude', 'codex', 'mock']);
const MAX_ANALYSIS_BYTES = 1_500_000;

export class ExternalRunnerError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// AI ที่แอดมินเลือกให้ตัวอ่านใช้อ่านบิล (ตั้งจากหน้า admin ไม่ต้อง deploy)
// ยังไม่เคยเลือก = ตัวอ่านใช้ AI ตามที่ตั้งไว้ในเครื่อง (--agent)
export const READER_AGENT_SETTING_KEY = 'ai_reader_agent';
export const READER_AGENTS = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' }
];
const READER_AGENT_VALUES = new Set(READER_AGENTS.map((agent) => agent.value));

export const getReaderAgentChoice = async () => {
  const row = await getAppSetting(READER_AGENT_SETTING_KEY);
  const agent = READER_AGENT_VALUES.has(String(row?.value || '')) ? String(row.value) : null;
  return { agent, updated_by: agent ? row.updated_by || null : null, updated_at: agent ? row.updated_at || null : null };
};

export const setReaderAgentChoice = async ({ agent, updatedBy } = {}) => {
  const value = String(agent || '').trim().toLowerCase();
  if (!READER_AGENT_VALUES.has(value)) {
    throw new ExternalRunnerError(400, 'INVALID_READER_AGENT', 'เลือกได้เฉพาะ Claude Code หรือ Codex');
  }
  await setAppSetting({ key: READER_AGENT_SETTING_KEY, value, updatedBy });
  return getReaderAgentChoice();
};

const cleanLabel = (value, fallback) => String(value || '').replace(/[^\w.:@/+-]/g, '').slice(0, 60) || fallback;

// ป้ายรุ่นที่เก็บใน ai_model เช่น "claude-code:sonnet" หรือ "codex:gpt-5.6-terra"
export const externalModelLabel = ({ agent, model } = {}) => {
  const name = AGENT_NAMES.has(String(agent || '').toLowerCase()) ? String(agent).toLowerCase() : 'agent';
  const prefix = name === 'claude' ? 'claude-code' : name;
  return `${prefix}:${cleanLabel(model, 'default')}`;
};

export const verifyRunnerToken = (provided, config = getAiConfig()) => {
  const expected = String(config.externalRunnerToken || '');
  if (!expected) throw new ExternalRunnerError(503, 'EXTERNAL_RUNNER_NOT_ENABLED', 'ยังไม่ได้ตั้ง AI_EXTERNAL_RUNNER_TOKEN');
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(String(provided || ''));
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw new ExternalRunnerError(401, 'INVALID_RUNNER_TOKEN', 'token ไม่ถูกต้อง');
  }
  return true;
};

const requireExternalMode = (config) => {
  if (config.provider !== EXTERNAL_PROVIDER) {
    // กันไม่ให้ตัวอ่านภายนอกแย่งคิวกับ worker ที่ใช้ API อยู่
    throw new ExternalRunnerError(409, 'PROVIDER_NOT_EXTERNAL', `AI_PROVIDER ตอนนี้คือ ${config.provider || 'ปิด'} ไม่ใช่ external`);
  }
};

const staleCutoff = (config) => new Date(Date.now() - config.staleProcessingMs).toISOString();

const buildTask = async (claimed, config) => {
  const context = await collectAnalysisContext(claimed, config);
  const learningExamples = await listAiLearningExamples({ limit: 12 });
  const { nearbyText, conversationContext } = context.analyzerContext;
  const mime = mimeFromItem(claimed);
  return {
    item_id: claimed.id,
    claim: Number(claimed.ai_attempt_count || 0),
    lease_ms: config.staleProcessingMs,
    mime,
    file_extension: mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : mime === 'image/heic' ? '.heic' : '.jpg',
    image_path: `/api/ai-runner/items/${claimed.id}/image?claim=${Number(claimed.ai_attempt_count || 0)}`,
    prompt: buildVisionPrompt(context.contextualItem, nearbyText, learningExamples, conversationContext),
    schema: BILL_CAPTURE_ANALYSIS_SCHEMA
  };
};

// จองรูปถัดไปในคิว (ทีละใบ เพื่อไม่ให้ lease หมดระหว่างอ่าน)
export const claimNextExternalTask = async ({ agent, model } = {}) => {
  const config = getAiConfig();
  requireExternalMode(config);
  // ถ้าแอดมินเลือก AI ไว้ ตัวอ่านที่ใช้ AI อื่นจะไม่ได้รูปไปอ่าน (กันตัวอ่านรุ่นเก่าที่ยังไม่รู้จักค่าที่เลือก)
  const choice = await getReaderAgentChoice();
  if (choice.agent && String(agent || '').toLowerCase() !== choice.agent) return null;
  const staleBeforeIso = staleCutoff(config);
  const candidates = await listAiQueueItems({ limit: 5, maxAttempts: config.maxAttempts, staleBeforeIso });
  for (const candidate of candidates) {
    const claimed = await markAiProcessing({
      id: candidate.id,
      provider: EXTERNAL_PROVIDER,
      model: externalModelLabel({ agent, model }),
      staleBeforeIso
    });
    if (!claimed || claimed.status !== 'downloaded' || claimed.ai_status !== 'processing') continue;
    try {
      return await buildTask(claimed, config);
    } catch (error) {
      await releaseAiClaim({ id: claimed.id, attempt: claimed.ai_attempt_count });
      throw error;
    }
  }
  return null;
};

// รูปต้องยังถูกจองโดยตัวอ่านภายนอกรอบเดียวกัน (claim = ai_attempt_count ตอนจอง)
export const requireActiveClaim = async (itemId, claim) => {
  const item = await getItemById(Number(itemId || 0));
  if (!item) throw new ExternalRunnerError(404, 'ITEM_NOT_FOUND', 'ไม่พบรูปนี้');
  const active = item.ai_status === 'processing'
    && item.ai_provider === EXTERNAL_PROVIDER
    && Number(item.ai_attempt_count || 0) === Number(claim);
  if (!active) throw new ExternalRunnerError(409, 'CLAIM_EXPIRED', 'การจองรูปนี้หมดอายุหรือถูกจองใหม่แล้ว');
  return item;
};

const validateAnalysisPayload = (analysis) => {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    throw new ExternalRunnerError(400, 'INVALID_ANALYSIS', 'analysis ต้องเป็น JSON object');
  }
  if (Buffer.byteLength(JSON.stringify(analysis)) > MAX_ANALYSIS_BYTES) {
    throw new ExternalRunnerError(413, 'ANALYSIS_TOO_LARGE', 'ผลอ่านใหญ่เกินไป');
  }
  if (!analysis.category && !analysis.document_type) {
    throw new ExternalRunnerError(400, 'INVALID_ANALYSIS', 'ผลอ่านไม่มี category');
  }
};

export const submitExternalResult = async ({ itemId, claim, analysis, startedAtMs } = {}) => {
  const config = getAiConfig();
  requireExternalMode(config);
  validateAnalysisPayload(analysis);
  const item = await requireActiveClaim(itemId, claim);
  const startedAt = Number.isFinite(Number(startedAtMs)) && Number(startedAtMs) > 0 ? Number(startedAtMs) : Date.now();
  const context = await collectAnalysisContext(item, config);
  const learningExamples = await listAiLearningExamples({ limit: 12 });
  const finalAnalysis = await analyzeItem({
    item: context.contextualItem,
    config,
    ...context.analyzerContext,
    learningExamples,
    visionAnalyzer: async () => {
      const normalized = normalizeAnalysis(analysis);
      // subscription ไม่คิดเงินต่อ token จึงไม่บันทึก token ลงต้นทุน
      normalized._usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 0 };
      return normalized;
    }
  });
  const updated = await storeAnalysisResult({ claimed: item, config, analysis: finalAnalysis, startedAt, context, learningExamples });
  if (!updated) throw new ExternalRunnerError(404, 'ITEM_NOT_FOUND', 'ไม่พบรูปนี้');
  return {
    item_id: updated.id,
    category: updated.category,
    bill_total_value: updated.bill_total_value ?? null,
    slip_amount_value: updated.slip_amount_value ?? null,
    ai_status: updated.ai_status
  };
};

export const failExternalTask = async ({ itemId, claim, error, transient = true } = {}) => {
  const config = getAiConfig();
  requireExternalMode(config);
  const item = await requireActiveClaim(itemId, claim);
  const message = `External runner: ${String(error || 'unknown error').slice(0, 1000)}`;
  const attempt = Math.max(1, Number(item.ai_attempt_count || 1));
  const failure = transient
    ? { errorKind: 'transient', nextRetryAt: new Date(Date.now() + Math.min(6 * 60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(attempt - 1, 8)))).toISOString() }
    : { errorKind: 'permanent', nextRetryAt: null };
  await storeAnalysisFailure({ claimed: item, config, error: new Error(message), failure });
  return { item_id: item.id, ...failure };
};

// คืนรูปเข้าคิวโดยไม่นับครั้ง เมื่อปัญหาอยู่ที่ตัวอ่าน (โควตาหมด/ยังไม่ล็อกอิน/ปิดเครื่อง)
export const releaseExternalTask = async ({ itemId, claim } = {}) => {
  await requireActiveClaim(itemId, claim);
  const released = await releaseAiClaim({ id: itemId, attempt: claim });
  if (!released) throw new ExternalRunnerError(409, 'CLAIM_EXPIRED', 'การจองรูปนี้หมดอายุหรือถูกจองใหม่แล้ว');
  return { item_id: Number(itemId), released: true };
};

export const finishExternalBatch = async () => {
  const config = getAiConfig();
  requireExternalMode(config);
  const { matches, groupChecks } = await finishAnalysisBatch(config);
  return { matched: matches.length, match_ids: matches.map((match) => match.id), group_checks: groupChecks };
};

export const getExternalRunnerStatus = async () => {
  const status = await getAiWorkerStatus();
  const choice = await getReaderAgentChoice();
  return {
    provider: status.provider,
    external_mode: status.provider === EXTERNAL_PROVIDER,
    preferred_agent: choice.agent,
    queue: status.queue
  };
};
