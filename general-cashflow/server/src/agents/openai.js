// ตัวเรียก OpenAI Responses API แบบบางๆ ใช้ร่วมกันได้ทุก agent ของ general-cashflow
//
// ตั้งใจให้บางเพราะ agent แต่ละตัวต่างกันแค่ prompt/tool/schema ไม่ควรมีใครเขียน fetch เอง
//
// สองเรื่องที่มีผลกับค่าใช้จ่ายมากกว่าการเลือกโมเดล และถูกบังคับไว้ตรงนี้:
//
// 1. prompt ส่วนกฎธุรกิจต้องอยู่ "หน้าสุด" และเหมือนกันเป๊ะทุกครั้ง เพื่อให้ prefix เข้า cache
//    (cached input ถูกกว่า fresh input ราว 10 เท่า) ข้อมูลของเคสนั้นค่อยต่อท้าย
//    ฟังก์ชันนี้จึงรับ instructions กับ input แยกกัน ไม่ให้ผู้เรียกเผลอสลับลำดับ
//
// 2. max_output_tokens ต้องเผื่อ reasoning token ด้วย เพราะ OpenAI นับรวมกับ output
//    ตั้งต่ำแล้วจะเจอ JSON ขาดครึ่งโดยหาสาเหตุไม่เจอ ค่า default ตรงนี้จึงสูงกว่า
//    ของ line-bill-capture ที่เป็นงาน vision รอบเดียว

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const VALID_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

/**
 * @param {object} options
 * @param {string} options.prefix          เช่น 'CASHFLOW_BRIEF' จะอ่าน CASHFLOW_BRIEF_API_KEY / _MODEL / ...
 * @param {string} [options.shareKeyWith]  prefix ของ agent ที่ใช้ key ร่วมกัน เช่น การอ่านรูปแคชเชียร์
 *                                         ใช้ key เดียวกับ Agent #1 จึงไม่ต้องออก key แยก
 */
export const resolveAgentConfig = ({
  prefix,
  defaultModel,
  defaultEffort = 'medium',
  defaultMaxOutputTokens = 16000,
  shareKeyWith = ''
}) => {
  const apiKey =
    process.env[`${prefix}_API_KEY`] ||
    (shareKeyWith ? process.env[`${shareKeyWith}_API_KEY`] : '') ||
    process.env.CASHFLOW_OPENAI_API_KEY ||
    '';
  const effort = String(process.env[`${prefix}_REASONING_EFFORT`] || defaultEffort).trim().toLowerCase();
  const maxOutputTokens = Number(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] || defaultMaxOutputTokens);

  return {
    apiKey,
    enabled: Boolean(apiKey),
    model: String(process.env[`${prefix}_MODEL`] || defaultModel).trim(),
    reasoningEffort: VALID_EFFORTS.has(effort) ? effort : defaultEffort,
    maxOutputTokens: Number.isFinite(maxOutputTokens)
      ? Math.max(1000, Math.min(64000, maxOutputTokens))
      : defaultMaxOutputTokens,
    baseUrl: String(process.env.CASHFLOW_OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeoutMs: Number(process.env.CASHFLOW_OPENAI_TIMEOUT_MS || 120000),
    // สรุปตอนเช้ายิงวันละครั้ง ถ้าพลาดรอบนั้นคือไม่มีสรุปทั้งวัน จึงต้องลองใหม่
    maxRetries: Number(process.env.CASHFLOW_OPENAI_MAX_RETRIES || 2),
    retryBaseDelayMs: Number(process.env.CASHFLOW_OPENAI_RETRY_BASE_MS || 1000)
  };
};

const extractResponseText = (json) => {
  if (typeof json?.output_text === 'string' && json.output_text.trim()) return json.output_text;
  const chunks = [];
  for (const output of json?.output || []) {
    for (const content of output?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
};

const extractFunctionCalls = (json) =>
  (json?.output || []).filter((item) => item?.type === 'function_call');

export const parseJsonObject = (text) => {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI response has no text');
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('AI response is not valid JSON');
  }
};

const readUsage = (json) => ({
  input_tokens: Number(json?.usage?.input_tokens || 0),
  cached_input_tokens: Number(json?.usage?.input_tokens_details?.cached_tokens || 0),
  output_tokens: Number(json?.usage?.output_tokens || 0),
  reasoning_tokens: Number(json?.usage?.output_tokens_details?.reasoning_tokens || 0)
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ลองใหม่เฉพาะความผิดพลาดที่หายเองได้ ไม่ลองใหม่กับ key ผิดหรือ request ผิด
// เพราะลองกี่รอบก็ผิดเหมือนเดิม เสียเงินและเสียเวลาเปล่า
//
// รายการนี้มาจากการยิงจริง ไม่ได้เดา: undici โยน `terminated` เปล่าๆ เมื่อ socket
// ถูกตัดกลางการอ่าน response ซึ่งเป็นอาการที่เจอบ่อยที่สุดตอนทดสอบ และข้อความมัน
// ไม่มีคำว่า network หรือ fetch อยู่เลย จึงต้องระบุตรงๆ พร้อมดู cause.code ประกอบ
const RETRYABLE_PATTERN =
  /fetch failed|terminated|network|socket hang up|aborted|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR/i;

const isRetryable = (error) => {
  if (error?.retryableStatus) return true;
  const parts = [error?.message, error?.cause?.code, error?.cause?.message, error?.code]
    .filter(Boolean)
    .join(' ');
  return RETRYABLE_PATTERN.test(parts);
};

const postOnce = async (config, body) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const message = json?.error?.message || text.slice(0, 500) || `HTTP ${response.status}`;
      const error = new Error(`OpenAI request failed: ${message}`);
      // 429 และ 5xx เป็นของชั่วคราว ส่วน 4xx อื่นคือเราส่งผิดเอง
      error.retryableStatus = response.status === 429 || response.status >= 500;
      throw error;
    }
    if (json?.status === 'incomplete') {
      // เกือบทุกครั้งคือชน max_output_tokens เพราะ reasoning กินไปหมด
      throw new Error(`OpenAI response incomplete: ${json?.incomplete_details?.reason || 'unknown'}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
};

const postResponses = async (config, body) => {
  let lastError;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      return await postOnce(config, body);
    } catch (error) {
      lastError = error;
      if (attempt === config.maxRetries || !isRetryable(error)) throw error;
      await sleep(config.retryBaseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
};

/**
 * เรียกโมเดลพร้อม tool loop และบังคับ JSON schema ที่ผลลัพธ์สุดท้าย
 *
 * @param {object}   options
 * @param {object}   options.config        ผลจาก resolveAgentConfig
 * @param {string}   options.instructions  กฎธุรกิจ ต้องคงที่ทุกครั้งเพื่อให้ cache ติด
 * @param {string}   options.input         ข้อมูลของเคสนี้
 * @param {object}   options.schema        JSON schema ของคำตอบสุดท้าย
 * @param {string}   options.schemaName
 * @param {object[]} [options.tools]       นิยาม tool แบบ Responses API
 * @param {Function} [options.onToolCall]  async (name, args) => any
 * @param {number}   [options.maxToolRounds]
 */
export const runStructuredAgent = async ({
  config,
  instructions,
  input,
  schema,
  schemaName,
  tools = [],
  onToolCall,
  maxToolRounds = 8
}) => {
  if (!config.enabled) throw new Error('OpenAI API key is not configured for this agent');

  const conversation = [{ role: 'user', content: [{ type: 'input_text', text: input }] }];
  const usageTotals = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  const toolTrail = [];

  for (let round = 0; round <= maxToolRounds; round += 1) {
    const isLastRound = round === maxToolRounds;
    const body = {
      model: config.model,
      // instructions ถูกส่งเป็นฟิลด์แยกและคงที่ จึงเป็น prefix ที่ cache ได้
      instructions,
      reasoning: { effort: config.reasoningEffort },
      input: conversation,
      max_output_tokens: config.maxOutputTokens,
      text: {
        format: { type: 'json_schema', name: schemaName, schema, strict: true }
      }
    };
    // รอบสุดท้ายตัด tool ออก เพื่อบังคับให้โมเดลสรุปแทนที่จะขอข้อมูลเพิ่มไม่จบ
    if (tools.length > 0 && !isLastRound) body.tools = tools;

    const json = await postResponses(config, body);
    const usage = readUsage(json);
    for (const key of Object.keys(usageTotals)) usageTotals[key] += usage[key];

    const calls = extractFunctionCalls(json);
    if (calls.length === 0 || isLastRound) {
      return {
        result: parseJsonObject(extractResponseText(json)),
        usage: usageTotals,
        toolTrail,
        rounds: round + 1
      };
    }

    for (const call of calls) {
      let output;
      try {
        const args = call.arguments ? JSON.parse(call.arguments) : {};
        output = await onToolCall?.(call.name, args);
        toolTrail.push({ name: call.name, args, ok: true });
      } catch (error) {
        output = { error: String(error?.message || error) };
        toolTrail.push({ name: call.name, ok: false, error: String(error?.message || error) });
      }
      conversation.push(call);
      conversation.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(output ?? null)
      });
    }
  }

  throw new Error('Agent exceeded max tool rounds');
};
