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

// schema เดิมใช้ type: ['string', 'null'] แบบ OpenAI; แปลงเป็น anyOf ให้ structured outputs ของ Claude
export const toClaudeSchema = (node) => {
  if (Array.isArray(node)) return node.map(toClaudeSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
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
  let message;
  try {
    message = await getClient(config.anthropicApiKey).beta.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: {
        effort: config.anthropicEffort,
        format: { type: 'json_schema', schema: toClaudeSchema(schema) }
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: prepared.media_type, data: prepared.data } },
          { type: 'text', text: prompt }
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
  const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  let result;
  try {
    result = JSON.parse(text);
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
