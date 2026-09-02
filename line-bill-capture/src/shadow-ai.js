import {
  getDecisionEvent,
  updateShadowPrediction
} from './db.js';
import { traceAiRun } from './ai-trace.js';

const API_KEY = String(process.env.SHADOW_AI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
const DISABLED = String(process.env.SHADOW_AI_DISABLED || '').trim() === '1';
const BASE_URL = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const MODEL = String(process.env.SHADOW_AI_MODEL || 'gpt-5.4-mini').trim();
const EFFORT = String(process.env.SHADOW_AI_REASONING_EFFORT || 'low').trim();
const TIMEOUT_MS = Math.max(5000, Number(process.env.SHADOW_AI_TIMEOUT_MS || 45000));

const outputText = (payload) => {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return (payload?.output || []).flatMap((entry) => entry?.content || []).map((entry) => entry?.text || '').join('\n');
};

const parseJson = (value) => {
  const text = String(value || '').trim();
  try { return JSON.parse(text); } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('Shadow AI response is not JSON');
  }
};

export const shadowAiConfig = () => ({ enabled: Boolean(API_KEY) && !DISABLED, model: MODEL, writes_business_data: false });

export const runShadowDecision = async ({ decisionId, runId } = {}) => {
  const decision = await getDecisionEvent(decisionId);
  if (!decision) return;
  const startedAt = new Date().toISOString();
  if (!API_KEY || DISABLED) {
    await updateShadowPrediction({
      decisionId,
      values: { status: 'skipped', model: MODEL, startedAt, completedAt: startedAt, errorMessage: DISABLED ? 'Shadow AI is disabled in this runtime' : 'SHADOW_AI_API_KEY is not configured' }
    });
    return;
  }
  await updateShadowPrediction({ decisionId, values: { status: 'running', model: MODEL, startedAt } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        instructions: `You are a real-time shadow reviewer for a Thai bill and transfer matching workflow.
Analyze this decision independently, document by document. Use only the frozen pre-decision snapshot,
including each document's category, amount, sender, timestamp, AI OCR summary, and nearby LINE messages.
Predict the safest next action but never execute it.
If the proposed action is supported, copy the snapshot's exact action_key into predicted_action.
Otherwise use "hold_for_review"; if evidence is missing use "insufficient_evidence".
Flag sending LINE, closing a day, deleting evidence, replacing a confirmed match, and changing an amount as high risk.
Write rationale in concise Thai. State the concrete evidence for this specific document or pair, including
item IDs and amounts when available. Never return a generic reason such as only "ตรวจแล้ว" or "ข้อมูลถูกต้อง".`,
        reasoning: { effort: EFFORT },
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(decision.input_snapshot || {}) }] }],
        max_output_tokens: 1800,
        text: {
          format: {
            type: 'json_schema',
            name: 'shadow_decision_prediction',
            strict: true,
            schema: {
              type: 'object', additionalProperties: false,
              required: ['predicted_action', 'confidence', 'rationale', 'risk_flags'],
              properties: {
                predicted_action: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                rationale: { type: 'string' },
                risk_flags: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`);
    const result = parseJson(outputText(payload));
    const completedAt = new Date().toISOString();
    await updateShadowPrediction({
      decisionId,
      values: {
        status: 'completed', model: MODEL, predictedAction: result.predicted_action,
        confidence: Number(result.confidence || 0), rationale: result.rationale,
        riskFlags: result.risk_flags || [], usagePayload: payload.usage || {}, completedAt
      }
    });
    traceAiRun({ event: 'shadow-decision', run_id: runId, decision_id: decisionId, model: MODEL, result });
  } catch (error) {
    const completedAt = new Date().toISOString();
    await updateShadowPrediction({
      decisionId,
      values: { status: 'failed', model: MODEL, errorMessage: String(error?.message || error).slice(0, 2000), completedAt }
    });
    traceAiRun({ event: 'shadow-decision', run_id: runId, decision_id: decisionId, model: MODEL, error: error?.message || error });
  } finally {
    clearTimeout(timer);
  }
};
