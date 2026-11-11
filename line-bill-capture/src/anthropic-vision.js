// เรียก Claude (Anthropic) ให้อ่านรูปบิล/สลิป แล้วตอบเป็น JSON ตาม schema เดียวกับ OpenAI
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
export const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Claude รับรูปได้แค่ 4 ชนิดนี้ และจำกัดขนาดต่อรูป จึงแปลงรูปอื่น/รูปใหญ่เป็น JPEG ก่อนส่ง
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_RAW_IMAGE_BYTES = 3_700_000; // base64 แล้วไม่เกิน ~5 MB
const MAX_IMAGE_EDGE_PX = 4000;

const clients = new Map();
const getClient = (apiKey) => {
  if (!clients.has(apiKey)) clients.set(apiKey, new Anthropic({ apiKey, maxRetries: 1, timeout: 5 * 60 * 1000 }));
  return clients.get(apiKey);
};

// structured outputs ของ Claude ไม่รับข้อจำกัดตัวเลข/ความยาว/จำนวนแถว (ตอบ HTTP 400 ทั้งคำขอ)
// จึงตัดออกจาก schema ที่ส่ง; ผลที่ได้ยังผ่าน normalize/validation เดิมในโค้ด (เช่น normalizeInvoiceLineItemsResult)
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'maxItems'
]);

// schema เดิมใช้ type: ['string', 'null'] แบบ OpenAI; แปลงเป็น anyOf ให้ structured outputs ของ Claude
export const toClaudeSchema = (node) => {
  if (Array.isArray(node)) return node.map(toClaudeSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (key === 'minItems' && !(value === 0 || value === 1)) continue; // Claude รับ minItems แค่ 0 หรือ 1
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, toClaudeSchema(child)]));
    } else {
      out[key] = toClaudeSchema(value);
    }
  }
  if (Array.isArray(out.type)) {
    const { type, ...rest } = out;
    return { anyOf: type.map((t) => (t === 'null' ? { type: 'null' } : { ...rest, type: t })) };
  }
  return out;
};

// Claude จำกัด structured outputs ไว้ที่ 16 ช่องแบบ union (เช่น string|null) ต่อ schema
export const MAX_STRUCTURED_UNIONS = 16;
export const countUnionParams = (node) => {
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + countUnionParams(child), 0);
  if (!node || typeof node !== 'object') return 0;
  let count = Array.isArray(node.anyOf) || Array.isArray(node.type) ? 1 : 0;
  for (const value of Object.values(node)) count += countUnionParams(value);
  return count;
};

// ดึง JSON object จากข้อความ (กันกรณีมี ```json ครอบ หรือมีข้อความหน้า/หลัง)
export const parseJsonObject = (text) => {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch { /* ลองตัดส่วนเกิน */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object');
  return JSON.parse(raw.slice(start, end + 1));
};

const typesOf = (schema) => (Array.isArray(schema?.type) ? schema.type : [schema?.type]);
const emptyFor = (schema) => {
  const types = typesOf(schema);
  if (types.includes('null')) return null;
  if (types.includes('array')) return [];
  if (types.includes('object')) return conformToSchema({}, schema);
  if (types.includes('string')) return '';
  if (types.includes('boolean')) return false;
  return null;
};

// เติม key ที่ขาด/ตัด key เกิน ให้ผลเหมือนที่ strict schema ของ OpenAI รับประกัน (ค่าที่มีอยู่ไม่แตะ)
export const conformToSchema = (value, schema) => {
  if (!schema || typeof schema !== 'object') return value;
  const types = typesOf(schema);
  if (types.includes('object') && schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    for (const [key, child] of Object.entries(schema.properties)) {
      out[key] = value[key] === undefined ? emptyFor(child) : conformToSchema(value[key], child);
    }
    return out;
  }
  if (types.includes('array') && Array.isArray(value)) return value.map((entry) => conformToSchema(entry, schema.items));
  if (value === undefined) return emptyFor(schema);
  return value;
};

export const prepareClaudeImage = async (buffer, mime) => {
  const type = String(mime || '').toLowerCase();
  if (SUPPORTED_IMAGE_TYPES.has(type) && buffer.length <= MAX_RAW_IMAGE_BYTES) {
    return { data: buffer.toString('base64'), media_type: type };
  }
  let quality = 85;
  let edge = MAX_IMAGE_EDGE_PX;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (out.length <= MAX_RAW_IMAGE_BYTES) return { data: out.toString('base64'), media_type: 'image/jpeg' };
    quality = Math.max(60, quality - 10);
    edge = Math.round(edge * 0.8);
  }
  throw new Error('Image is too large for Claude even after resizing');
};

const describeError = (error) => {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'fetch failed (connection error)';
  if (error instanceof Anthropic.APIError) return `HTTP ${error.status}: ${error.error?.error?.message || error.message}`;
  return String(error?.message || error);
};

// ส่งข้อความ + รูป 1 รูป ให้ Claude ตอบเป็น JSON ตาม schema; คืน { result, usage, model }
export const callClaudeVisionJson = async ({ config, prompt, image, mime, schema, maxTokens, label = 'Claude vision request' }) => {
  if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  const prepared = await prepareClaudeImage(image, mime);
  const claudeSchema = toClaudeSchema(schema);
  // schema ใหญ่ (เช่นอ่านบิล มีช่อง null ได้ 40+ ช่อง) เกินเพดาน union ของ structured outputs → ให้ JSON ตาม schema ในข้อความแทน
  const structured = countUnionParams(claudeSchema) <= MAX_STRUCTURED_UNIONS;
  const text = structured
    ? prompt
    : `${prompt}\n\nตอบเป็น JSON object เดียวเท่านั้น ไม่มีข้อความอื่นหรือ markdown ใส่ครบทุก key ตาม JSON Schema นี้ (ค่าที่ไม่รู้ให้ใส่ null):\n${JSON.stringify(schema)}`;
  let message;
  try {
    message = await getClient(config.anthropicApiKey).beta.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: structured
        ? { effort: config.anthropicEffort, format: { type: 'json_schema', schema: claudeSchema } }
        : { effort: config.anthropicEffort },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: prepared.media_type, data: prepared.data } },
          { type: 'text', text }
        ]
      }]
    });
  } catch (error) {
    throw new Error(`${label} failed: ${describeError(error)}`);
  }

  if (message.stop_reason === 'refusal') {
    throw new Error(`${label} refused by Claude (${message.stop_details?.category || 'no category'})`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error(`${label} stopped at max_tokens=${maxTokens}; raise ANTHROPIC_MAX_OUTPUT_TOKENS`);
  }
  const output = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  let result;
  try {
    result = structured ? JSON.parse(output) : conformToSchema(parseJsonObject(output), schema);
  } catch {
    throw new Error(`${label} returned non-JSON output`);
  }

  // Claude นับ input_tokens แยกจาก cache; รวมให้เป็นรูปแบบเดียวกับ OpenAI (cached อยู่ใน input)
  const usage = message.usage || {};
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  const inputTokens = Number(usage.input_tokens || 0) + cacheRead + Number(usage.cache_creation_input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  return {
    result,
    model: message.model || config.model,
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: cacheRead,
      output_tokens: outputTokens,
      reasoning_tokens: 0,
      total_tokens: inputTokens + outputTokens
    }
  };
};
