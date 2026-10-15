import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadApp } from './app.mjs';
import { cleanEnv, ssdDir } from './common.mjs';

const server = fileURLToPath(new URL('../server', import.meta.url));
let queries = 0;
const pool = { query() { queries++; throw new Error('Unexpected DB call'); } };
const { source } = await loadApp(server, pool);

test('pilot loads unchanged receiving modules without dotenv, DB access or outbound calls', () => {
  assert.equal(queries, 0); assert.equal(typeof source.order.ensureOrderReceivingColumns, 'function');
  assert.equal(typeof source.router.handle, 'function');
});
test('custom mock hook enters real OCR normalization without a key/provider network', async () => {
  assert.equal(typeof source.ocr.getCustomOcrProvider(), 'function');
  const result = await source.ocr.extractBillWithVision({ images: [{ page_no: 1 }],
    document: { id: 1, delivery_date: '2026-10-15', supplier_name_text: 'SYNTHETIC ร้าน' },
    expectedItems: [{ product_name: 'SYNTHETIC ผัก 01', unit_name: 'กิโลกรัม', quantity_ordered: '20.00' }] });
  assert.equal(result.model, 'SYNTHETIC-mock'); assert.equal(result.total, 25);
  assert.equal(result.lines[0].quantity_billed, 2.5); assert.equal(queries, 0);
});
test('every real receiving route rejects missing or invalid pilot sessions before DB access', async () => {
  const routes = [['GET', '/expected'], ['GET', '/'], ['POST', '/'], ['GET', '/1'], ['PUT', '/1'],
    ['POST', '/1/images'], ['GET', '/1/images/1'], ['POST', '/1/ocr'],
    ['POST', '/1/signatures'], ['POST', '/1/confirm'], ['POST', '/1/void']];
  for (const [method, url] of routes) for (const headers of [{}, { authorization: 'Bearer invalid-pilot-session' }]) {
    const response = await new Promise((resolve, reject) => {
      const req = { method, url, headers };
      const res = { status(code) { this.code = code; return this; },
        json(body) { resolve({ code: this.code, body }); } };
      source.router.handle(req, res, error => reject(error || new Error('Route missed authentication')));
    });
    assert.equal(response.code, 401); assert.equal(response.body.code, 'UNAUTHORIZED');
  }
  assert.equal(queries, 0);
});
test('pilot environment has an explicit non-secret allowlist and SSD output guard rejects internal paths', async () => {
  const env = cleanEnv('/Volumes/SSD Files/SOLAO/market-order-system/tmp');
  assert.equal(env.NODE_ENV, 'test'); assert.equal(env.TZ, 'UTC');
  assert.equal(Object.keys(env).some(k => /KEY|TOKEN|PASSWORD|NODE_OPTIONS|DB_HOST|DATABASE_URL|PROXY/.test(k)), false);
  await assert.rejects(ssdDir('/private/tmp/pilot-output'), /SSD project/);
});
