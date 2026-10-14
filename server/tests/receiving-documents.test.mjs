import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import * as bangkokDate from '../src/utils/bangkok-date.js';
import * as ocrService from '../src/services/receiving-ocr.service.js';
import * as ocrMatcher from '../src/services/receiving-ocr-matcher.js';

const read = (relPath) => readFile(new URL(relPath, import.meta.url), 'utf8');

// สร้าง PNG data URL ที่ถูกต้องตาม magic bytes และ IHDR (สำหรับลายเซ็น)
const makePngDataUrl = (width = 2, height = 3, extraPayloadBytes = 0) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const crc = Buffer.alloc(4);
  const pad = extraPayloadBytes > 0 ? Buffer.alloc(extraPayloadBytes, 0x41) : Buffer.alloc(0);
  const buffer = Buffer.concat([signature, ihdrLength, ihdrType, ihdrData, crc, pad]);
  return `data:image/png;base64,${buffer.toString('base64')}`;
};

// สร้าง JPEG data URL ที่ถูกต้องตาม magic bytes และ SOF0 (สำหรับรูปบิล)
const makeJpegDataUrl = (width = 640, height = 480, extraPayloadBytes = 0) => {
  const soi = Buffer.from([0xff, 0xd8]);
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff;
  sof0[1] = 0xc0;
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8;
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3;
  const pad = extraPayloadBytes > 0 ? Buffer.alloc(extraPayloadBytes, 0x42) : Buffer.alloc(0);
  const eoi = Buffer.from([0xff, 0xd9]);
  const buffer = Buffer.concat([soi, sof0, pad, eoi]);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
};

// ============================================================================
// 1. ทดสอบ Schema (หัวข้อ 2 + แก้ process is not defined + ข้อ 12 DECIMAL(12,6))
// ============================================================================
test('receiving-documents-schema works without global process and upgrades unit_price to DECIMAL(12,6)', async () => {
  const executedQueries = [];
  const mockDb = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      executedQueries.push({ sql: normalized, params });
      if (normalized.startsWith('SHOW COLUMNS')) {
        if (params[0] === 'unit_price') {
          return [[{ Field: 'unit_price', Type: 'decimal(12,2)' }]];
        }
        return [[]];
      }
      return [{ affectedRows: 1 }];
    }
  };

  // ไม่มี process ใน context เพื่อพิสูจน์ว่าไม่เกิด ReferenceError: process is not defined
  const context = vm.createContext({ console });
  const schemaModule = new vm.SourceTextModule(
    await read('../src/models/receiving-documents-schema.js'),
    { context }
  );
  await schemaModule.link((specifier) => {
    if (specifier.endsWith('/database.js')) {
      return new vm.SyntheticModule(['default'], function () {
        this.setExport('default', mockDb);
      }, { context });
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  });
  await schemaModule.evaluate();

  const { RECEIVING_DOCUMENT_TABLES_DDL, ensureReceivingDocumentsTables } = schemaModule.namespace;
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_documents.includes('ocr_images_hash'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_document_lines.includes('unit_price DECIMAL(12,6)'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_document_images.includes('sha256'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.supplier_product_aliases.includes('candidate_product_id'));

  await ensureReceivingDocumentsTables(mockDb);
  assert.ok(
    executedQueries.some((q) =>
      q.sql.includes('ALTER TABLE receiving_document_lines MODIFY COLUMN unit_price DECIMAL(12,6) NULL')
    )
  );
});

// ============================================================================
// 2. ทดสอบ OCR Vision, Timeout, JSON เสีย, เลขติดลบ/ยาวเกิน (ข้อ 7, 16) และคำนวณสตางค์
// ============================================================================
test('OCR vision service handles Buddhist dates (4 & 2 digits), commas, timeout, bad JSON, and schema clamping', async () => {
  // Satang integer math: 0.1 + 0.2 === 0.30
  assert.equal(ocrService.formatMoney(0.1 + 0.2), '0.30');
  assert.equal(ocrService.normalizeBillDate('14/10/2569'), '2026-10-14');
  assert.equal(ocrService.normalizeBillDate('14/10/69'), '2026-10-14');

  // กรณีไม่มีคีย์ -> 503 OCR_UNAVAILABLE
  await assert.rejects(
    ocrService.extractBillWithVision({
      images: [{ page_no: 1, image_data_url: makeJpegDataUrl() }],
      apiKey: ''
    }),
    (err) => err.code === 'OCR_UNAVAILABLE' && err.statusCode === 503
  );

  // กรณี JSON เสีย -> 503 OCR_UNAVAILABLE
  await assert.rejects(
    ocrService.extractBillWithVision({
      images: [{ page_no: 1, image_data_url: makeJpegDataUrl() }],
      apiKey: 'fake-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{broken json' } }] })
      })
    }),
    (err) => err.code === 'OCR_UNAVAILABLE' && err.statusCode === 503
  );

  // กรณี Timeout ขณะอ่าน body (ข้อ 16: clearTimeout หลัง response.json())
  await assert.rejects(
    ocrService.extractBillWithVision({
      images: [{ page_no: 1, image_data_url: makeJpegDataUrl() }],
      apiKey: 'fake-key',
      timeoutMs: 60,
      fetchImpl: async (_url, opts) => ({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => reject(new Error('Aborted')));
          })
      })
    }),
    (err) => err.code === 'OCR_UNAVAILABLE' && err.statusCode === 503
  );

  // กรณีผล OCR มีค่าติดลบ, ค่ามหาศาล, ข้อความยาวเกินคอลัมน์ (ข้อ 7)
  const clamped = ocrService.normalizeOcrPayload({
    supplier_name: 'ก'.repeat(400),
    doc_ref: 'INV-'.padEnd(150, '9'),
    doc_date: '14/10/2569',
    subtotal: '-500',
    total: '999999999999.99',
    confidence: 0.95,
    lines: [
      {
        line_no: 1,
        bill_text: 'ข'.repeat(700),
        quantity_billed: -5,
        unit_text: 'ค'.repeat(150),
        unit_price: '1,250.50',
        amount: '2,501.00',
        confidence: 0.95
      }
    ]
  });

  assert.equal(clamped.supplier_name.length, 255);
  assert.equal(clamped.doc_ref.length, 100);
  assert.equal(clamped.subtotal, null); // ติดลบถูกตัดเป็น null
  assert.equal(clamped.total, null); // เกินเพดานถูกตัดเป็น null
  assert.equal(clamped.has_schema_warnings, true);
  assert.ok(clamped.confidence <= 0.5); // ลด confidence เพื่อบังคับให้เตือน LOW_CONFIDENCE
  assert.equal(clamped.lines[0].bill_text.length, 500);
  assert.equal(clamped.lines[0].unit_text.length, 100);
  assert.equal(clamped.lines[0].quantity_billed, null); // ติดลบไม่ถูกคำนวณกลับจาก amount/unit_price
  assert.ok(clamped.lines[0].confidence <= 0.4);
});

// ============================================================================
// 3. ทดสอบชนิดรูปภาพตามสัญญา API (ข้อ 17: รูปบิล jpeg/webp, ลายเซ็น png)
// ============================================================================
test('parseImageDataUrl enforces jpeg/webp for bill images, png for signatures, and 3MB limit', () => {
  const validJpeg = makeJpegDataUrl(800, 600);
  const parsedJpeg = ocrService.parseImageDataUrl(validJpeg); // default allowedMimes = ['image/jpeg', 'image/webp']
  assert.equal(parsedJpeg.mimeType, 'image/jpeg');
  assert.equal(parsedJpeg.width, 800);
  assert.equal(parsedJpeg.height, 600);

  // ส่ง PNG เข้า endpoint รูปบิลต้องถูกปฏิเสธด้วย 422 VALIDATION_FAILED (ข้อ 17)
  const validPng = makePngDataUrl(300, 120);
  assert.throws(
    () => ocrService.parseImageDataUrl(validPng),
    (err) => err.code === 'VALIDATION_FAILED' && err.statusCode === 422
  );

  // ลายเซ็นรับเฉพาะ PNG
  const parsedSig = ocrService.parseImageDataUrl(validPng, { allowedMimes: ['image/png'] });
  assert.equal(parsedSig.mimeType, 'image/png');

  // เกิน 3 MB ต้องได้ 413 IMAGE_TOO_LARGE
  const oversizedJpeg = makeJpegDataUrl(10, 10, 3 * 1024 * 1024 + 500);
  assert.throws(
    () => ocrService.parseImageDataUrl(oversizedJpeg),
    (err) => err.code === 'IMAGE_TOO_LARGE' && err.statusCode === 413
  );
});

// ============================================================================
// 4. ทดสอบการจับคู่สินค้า, ราคาต่อหน่วยฐาน (H3), ห้ามผูก order_item ซ้ำ (ข้อ 4) และคำสั้นไม่จับคู่ผิด
// ============================================================================
test('matchOcrLinesToCatalog computes base_unit_price for unit_multiplier, avoids duplicate order_item_id, and blocks short prefix false matches', () => {
  // คำสั้น "หมู" กับ "หมูบด" และ "น้ำ" กับ "น้ำแข็ง" ต้องไม่ผ่านเกณฑ์จับคู่
  assert.ok(ocrService.computeTextSimilarity('หมู', 'หมูบด') < 0.7);
  assert.ok(ocrService.computeTextSimilarity('น้ำ', 'น้ำแข็ง') < 0.7);

  const ocrLines = [
    {
      line_no: 1,
      bill_text: 'นมข้นหวาน คาร์เนชั่น',
      quantity_billed: 1,
      unit_text: 'ลัง',
      unit_price: 600,
      amount: 600,
      confidence: 0.95
    },
    {
      line_no: 2,
      bill_text: 'นมข้นหวาน คาร์เนชั่น',
      quantity_billed: 1,
      unit_text: 'ลัง',
      unit_price: 600,
      amount: 600,
      confidence: 0.95
    },
    {
      line_no: 3,
      bill_text: 'น้ำ',
      quantity_billed: 2,
      unit_text: 'ถุง',
      unit_price: 20,
      amount: 40,
      confidence: 0.9
    }
  ];

  const aliases = [
    {
      supplier_key: 'pg:3',
      bill_text: 'นมข้นหวาน คาร์เนชั่น',
      normalized_bill_text: ocrService.normalizeMatchText('นมข้นหวาน คาร์เนชั่น'),
      unit_text: 'ลัง',
      normalized_unit_text: ocrService.normalizeMatchText('ลัง'),
      product_id: 101,
      product_name: 'นมข้นหวาน (กระป๋อง)',
      unit_id: 10,
      unit_multiplier: 12
    }
  ];

  const expectedItems = [
    {
      order_item_id: 501,
      product_id: 101,
      product_name: 'นมข้นหวาน (กระป๋อง)',
      unit_id: 10,
      unit_name: 'กระป๋อง',
      quantity_ordered: 12
    },
    {
      order_item_id: 502,
      product_id: 202,
      product_name: 'น้ำแข็งหลอด',
      unit_id: 20,
      unit_name: 'ถุง',
      quantity_ordered: 2
    }
  ];

  const matched = ocrService.matchOcrLinesToCatalog({
    ocrLines,
    aliases,
    expectedItems,
    supplierKey: 'pg:3'
  });

  // บรรทัด 1: 1 ลัง * 12 = 12 กระป๋อง, unit_price ในบิล = 600 แต่ base_unit_price = 600/12 = 50
  assert.equal(matched[0].product_id, 101);
  assert.equal(matched[0].order_item_id, 501);
  assert.equal(matched[0].quantity_received, 12);
  assert.equal(matched[0].unit_price, 600);
  assert.equal(matched[0].base_unit_price, 50);

  // บรรทัด 2: สินค้าเดียวกันซ้ำในบิล ต้องไม่ผูก order_item_id 501 ซ้ำ (ข้อ 4)
  assert.equal(matched[1].product_id, 101);
  assert.equal(matched[1].order_item_id, null);

  // บรรทัด 3: "น้ำ" ต้องไม่จับคู่ผิดเป็น "น้ำแข็งหลอด"
  assert.equal(matched[2].product_id, null);
  assert.equal(matched[2].match.source, 'none');
});

test('computeDocumentWarnings uses base_unit_price for PRICE_CHANGE and detects all 7 warning codes', () => {
  // กรณี 1 ลัง (12 ชิ้น) ราคา 600 บาท -> base_unit_price = 50 บาท เท่ากับราคาล่าสุด 50 บาท -> ต้องไม่เตือน PRICE_CHANGE
  const noPriceWarning = ocrService.computeDocumentWarnings({
    document: { subtotal: 600, total: 600, ocr_confidence: 0.95 },
    lines: [
      {
        line_no: 1,
        product_id: 101,
        order_item_id: 501,
        unit_multiplier: 12,
        quantity_billed: 1,
        quantity_received: 12,
        unit_price: 600,
        base_unit_price: 50,
        amount: 600,
        match_confidence: 0.95
      }
    ],
    expectedItemsById: new Map([[501, { order_item_id: 501, quantity_ordered: 12 }]]),
    latestPricesByProductId: new Map([[101, 50]]),
    isDuplicateBill: false
  });
  assert.equal(noPriceWarning.warningCodes.includes('PRICE_CHANGE'), false);

  // กรณีครบทั้ง 7 รหัสเตือน
  const allWarnings = ocrService.computeDocumentWarnings({
    document: { subtotal: 2000, total: 2500, ocr_confidence: 0.65 },
    lines: [
      {
        line_no: 1,
        product_id: 101,
        order_item_id: 501,
        quantity_billed: 8,
        quantity_received: 8,
        unit_price: 130,
        base_unit_price: 130,
        amount: 1040,
        match_confidence: 0.95
      },
      {
        line_no: 2,
        product_id: 202,
        order_item_id: 502,
        quantity_billed: 6,
        quantity_received: 6,
        unit_price: 200,
        base_unit_price: 200,
        amount: 1200,
        match_confidence: 0.55
      },
      {
        line_no: 3,
        product_id: null,
        order_item_id: null,
        quantity_billed: 1,
        quantity_received: 1,
        unit_price: 50,
        amount: 50,
        match_confidence: null
      }
    ],
    expectedItemsById: new Map([
      [501, { order_item_id: 501, quantity_ordered: 10 }],
      [502, { order_item_id: 502, quantity_ordered: 5 }]
    ]),
    latestPricesByProductId: new Map([
      [101, 100],
      [202, 200]
    ]),
    isDuplicateBill: true
  });

  for (const code of [
    'SUM_MISMATCH',
    'PRICE_CHANGE',
    'QTY_SHORT',
    'QTY_OVER',
    'UNMATCHED_LINE',
    'DUPLICATE_BILL',
    'LOW_CONFIDENCE'
  ]) {
    assert.ok(allWarnings.warningCodes.includes(code), `Missing warning code: ${code}`);
  }
});

// ============================================================================
// Mock Harness สำหรับทดสอบ Model, Controller, Routes, Order/Inventory Integration
// ============================================================================
async function createReceivingHarness() {
  ocrService.resetOcrRateLimit();
  const today = bangkokDate.getBangkokDateKey();
  const state = {
    nextDocId: 1,
    nextLineId: 1,
    nextImageId: 1,
    nextTxId: 1,
    nextAliasId: 1,
    nextAuditId: 1,
    failOnConfirmStep: false,
    failAfterOcrVision: false,
    simulateConcurrentDuplicateUuid: false,
    documents: [],
    lines: [],
    images: [],
    aliases: [],
    audits: [],
    departments: [
      { id: 10, branch_id: 1, name: 'ครัวสันกำแพง' },
      { id: 20, branch_id: 2, name: 'ครัวคำเที่ยง' }
    ],
    inventoryBalances: new Map([
      ['7:10', { product_id: 7, department_id: 10, quantity: 5 }],
      ['8:10', { product_id: 8, department_id: 10, quantity: 0 }]
    ]),
    inventoryTransactions: [],
    orderItems: [
      {
        id: 50,
        order_id: 1,
        product_id: 7,
        product_name: 'หมูสามชั้น',
        unit_id: 2,
        unit_name: 'กก.',
        product_group_id: 3,
        product_group_name: 'ตลาดสดสันกำแพง',
        is_internal: false,
        is_countable: true,
        allow_pending_carryover: false,
        quantity: 10,
        requested_price: 150,
        actual_price: null,
        received_quantity: null,
        is_received: false,
        received_by_user_id: null,
        received_at: null,
        default_price: 150,
        order_date: today,
        order_status: 'submitted',
        branch_id: 1,
        branch_name: 'สาขาสันกำแพง',
        department_id: 10,
        department_name: 'ครัวสันกำแพง'
      },
      {
        id: 51,
        order_id: 1,
        product_id: 8,
        product_name: 'ผักกาดขาว',
        unit_id: 2,
        unit_name: 'กก.',
        product_group_id: 3,
        product_group_name: 'ตลาดสดสันกำแพง',
        is_internal: false,
        is_countable: true,
        allow_pending_carryover: false,
        quantity: 4,
        requested_price: 40,
        actual_price: null,
        received_quantity: null,
        is_received: false,
        received_by_user_id: null,
        received_at: null,
        default_price: 40,
        order_date: today,
        order_status: 'submitted',
        branch_id: 1,
        branch_name: 'สาขาสันกำแพง',
        department_id: 10,
        department_name: 'ครัวสันกำแพง'
      },
      {
        id: 99,
        order_id: 2,
        product_id: 7,
        product_name: 'หมูสามชั้น',
        unit_id: 2,
        unit_name: 'กก.',
        product_group_id: 3,
        product_group_name: 'ตลาดสดสันกำแพง',
        is_internal: false,
        is_countable: true,
        allow_pending_carryover: false,
        quantity: 6,
        requested_price: 150,
        actual_price: null,
        received_quantity: null,
        is_received: false,
        received_by_user_id: null,
        received_at: null,
        default_price: 150,
        order_date: today,
        order_status: 'submitted',
        branch_id: 2, // สาขาอื่น!
        branch_name: 'สาขาคำเที่ยง',
        department_id: 20,
        department_name: 'ครัวคำเที่ยง'
      }
    ],
    products: [
      { id: 7, name: 'หมูสามชั้น', default_price: 150, unit_id: 2, is_countable: 1 },
      { id: 8, name: 'ผักกาดขาว', default_price: 40, unit_id: 2, is_countable: 1 },
      { id: 9, name: 'น้ำแข็งบด (ไม่นับสต็อก)', default_price: 20, unit_id: 2, is_countable: 0 }
    ],
    units: [{ id: 2, name: 'กก.', abbreviation: 'กก.', is_active: true }]
  };

  let snapshot = null;

  const query = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('CREATE TABLE') || q.startsWith('ALTER TABLE')) return [{ affectedRows: 1 }];
    if (q.startsWith('SHOW COLUMNS')) return [[{ Field: 'exists', Type: 'decimal(12,6)' }]];
    if (q.startsWith('SELECT u.id, u.name, u.department_id, d.branch_id FROM users u')) {
      const uid = Number(params[0]);
      return [[{ id: uid, name: `User-${uid}`, department_id: 10, branch_id: 1 }]];
    }
    if (q.startsWith('SELECT id, branch_id FROM departments WHERE id = ?')) {
      const dept = state.departments.find((d) => d.id === Number(params[0]));
      return [dept ? [dept] : []];
    }
    if (q.startsWith('SELECT name FROM product_groups WHERE id = ?')) {
      return [[{ name: 'ตลาดสดสันกำแพง' }]];
    }
    if (q.startsWith('SELECT name FROM supplier_masters WHERE id = ?')) {
      return [[{ name: 'บจก. ซัพพลายเออร์หลัก' }]];
    }
    if (q.startsWith('SELECT name FROM products WHERE id = ?')) {
      const p = state.products.find((item) => item.id === Number(params[0]));
      return [p ? [{ name: p.name }] : []];
    }
    if (q.startsWith('SELECT COALESCE(is_countable, true) AS is_countable FROM products WHERE id = ?')) {
      const p = state.products.find((item) => item.id === Number(params[0]));
      return [p ? [{ is_countable: p.is_countable }] : [{ is_countable: 1 }]];
    }
    if (q.startsWith('SELECT id, name, abbreviation FROM units')) {
      return [structuredClone(state.units)];
    }

    // Scoped order_items validation query (ข้อ 1 Critical)
    if (
      q.startsWith('SELECT oi.id, oi.product_id, oi.quantity, oi.received_quantity') &&
      q.includes('JOIN departments d ON u.department_id = d.id WHERE oi.id IN')
    ) {
      const ids = new Set(params.map(Number));
      const rows = state.orderItems.filter((oi) => ids.has(oi.id));
      return [structuredClone(rows)];
    }

    // updateOrderItemReceivingWithInventory SELECT ... FOR UPDATE (จาก order.model.js จริง)
    if (q.startsWith('SELECT oi.id AS order_item_id, oi.product_id, oi.quantity')) {
      const oi = state.orderItems.find((item) => item.id === Number(params[0]));
      if (!oi) return [[]];
      return [
        [
          {
            order_item_id: oi.id,
            product_id: oi.product_id,
            quantity: oi.quantity,
            received_quantity: oi.received_quantity,
            order_number: `ORD-${oi.order_id}`,
            department_id: oi.department_id,
            department_name: oi.department_name,
            branch_name: oi.branch_name,
            product_name: oi.product_name,
            primary_product_group_id: oi.product_group_id,
            product_group_id: oi.product_group_id,
            product_group_name: oi.product_group_name,
            product_group_code: 'SUP001',
            is_internal_group: oi.is_internal ? 1 : 0,
            is_countable: oi.is_countable ? 1 : 0,
            allow_pending_carryover: oi.allow_pending_carryover ? 1 : 0
          }
        ]
      ];
    }

    // updateOrderItemReceivingWithInventory UPDATE order_items (จาก order.model.js จริง)
    if (q.startsWith('UPDATE order_items SET received_quantity = ?, is_received = ?, received_at = ?, received_by_user_id = ?')) {
      const orderItemId = Number(params.at(-1));
      const oi = state.orderItems.find((item) => item.id === orderItemId);
      if (oi) {
        oi.received_quantity = params[0];
        oi.is_received = Boolean(params[1]);
        oi.received_at = params[2] ? new Date(params[2]).toISOString() : null;
        oi.received_by_user_id = params[3];
      }
      return [{ affectedRows: 1 }];
    }

    // Update actual_price on order_items
    if (q.startsWith('UPDATE order_items SET actual_price = ? WHERE id = ?')) {
      if (state.failOnConfirmStep) {
        const dbErr = new Error('Simulated DB error on confirm');
        dbErr.code = 'ER_LOCK_DEADLOCK';
        throw dbErr;
      }
      const [actualPrice, orderItemId] = params;
      const oi = state.orderItems.find((item) => item.id === Number(orderItemId));
      if (oi) oi.actual_price = actualPrice;
      return [{ affectedRows: 1 }];
    }

    // Expected order_items query
    if (q.includes('FROM order_items oi') && q.includes('JOIN orders o ON o.id = oi.order_id')) {
      let rows = state.orderItems.map((oi) => ({
        ...oi,
        order_item_id: oi.id,
        quantity_ordered: oi.quantity
      }));
      let pIdx = 0;
      if (q.includes('o.order_date = ?')) {
        const d = params[pIdx++];
        rows = rows.filter((r) => r.order_date === d);
      }
      if (q.includes('b.id = ?')) {
        const bId = Number(params[pIdx++]);
        rows = rows.filter((r) => r.branch_id === bId);
      }
      if (q.includes('d.id = ?')) {
        const dId = Number(params[pIdx++]);
        rows = rows.filter((r) => r.department_id === dId);
      }
      if (q.includes('oi.id IN (')) {
        const ids = new Set(params.slice(pIdx).map(Number));
        rows = rows.filter((r) => ids.has(r.id));
      }
      return [structuredClone(rows)];
    }

    if (q.includes('AS ref_price FROM products p WHERE p.id IN')) {
      const ids = new Set(params.map(Number));
      const rows = state.products
        .filter((p) => ids.has(p.id))
        .map((p) => ({ product_id: p.id, ref_price: p.default_price }));
      return [rows];
    }

    // Duplicate bill check with branch_id (ข้อ 13)
    if (q.startsWith('SELECT id FROM receiving_documents WHERE id <> ? AND branch_id = ? AND status <> \'void\'')) {
      const [excludeId, branchId, docRef, total] = params;
      const dup = state.documents.find(
        (d) =>
          d.id !== Number(excludeId) &&
          d.branch_id === Number(branchId) &&
          d.status !== 'void' &&
          d.doc_ref === docRef &&
          Math.abs(Number(d.total || 0) - Number(total)) < 0.01
      );
      return [dup ? [{ id: dup.id }] : []];
    }

    if (q.startsWith('SELECT id, branch_id, department_id FROM receiving_documents WHERE client_uuid = ?')) {
      if (state.simulateConcurrentDuplicateUuid) {
        state.simulateConcurrentDuplicateUuid = false;
        return [[]];
      }
      const found = state.documents.find((d) => d.client_uuid === params[0]);
      return [found ? [structuredClone(found)] : []];
    }

    if (q.startsWith('INSERT INTO receiving_documents (')) {
      const [
        client_uuid,
        kind,
        branch_id,
        department_id,
        supplier_master_id,
        product_group_id,
        supplier_name_text,
        delivery_date,
        receiver_user_id,
        receiver_name
      ] = params;
      if (state.documents.some((d) => d.client_uuid === client_uuid)) {
        const dupErr = new Error('Duplicate entry for key uq_receiving_documents_client_uuid');
        dupErr.code = 'ER_DUP_ENTRY';
        throw dupErr;
      }
      const now = new Date().toISOString();
      const doc = {
        id: state.nextDocId++,
        client_uuid,
        status: 'draft',
        kind,
        branch_id: Number(branch_id),
        department_id: Number(department_id),
        supplier_master_id,
        product_group_id,
        supplier_name_text,
        delivery_date,
        doc_ref: null,
        doc_date: null,
        subtotal: null,
        discount: null,
        vat: null,
        total: null,
        is_header_edited: false,
        ocr_status: 'none',
        ocr_model: null,
        ocr_confidence: null,
        ocr_images_hash: null,
        ocr_attempt_count: 0,
        ocr_last_requested_at: null,
        ocr_warnings_json: '[]',
        warnings_json: '[]',
        receiver_user_id: Number(receiver_user_id),
        receiver_name,
        receiver_signature: null,
        receiver_signature_mime: null,
        courier_name: null,
        courier_signature: null,
        courier_signature_mime: null,
        confirmed_at: null,
        confirmed_by_user_id: null,
        voided_at: null,
        voided_by_user_id: null,
        void_reason: null,
        created_at: now,
        updated_at: now
      };
      state.documents.push(doc);
      return [{ insertId: doc.id }];
    }

    if (q.startsWith('UPDATE receiving_documents SET warnings_json = ?, ocr_warnings_json = ? WHERE id = ?')) {
      const doc = state.documents.find((d) => d.id === Number(params[2]));
      if (doc) {
        doc.warnings_json = params[0];
        doc.ocr_warnings_json = params[1];
      }
      return [{ affectedRows: 1 }];
    }

    // Atomic OCR claim lock (ข้อ 2 & ข้อ 5)
    if (q.startsWith('UPDATE receiving_documents SET ocr_status = \'pending\', ocr_attempt_count =')) {
      const doc = state.documents.find((d) => d.id === Number(params[0]));
      if (!doc || doc.status !== 'draft' || doc.ocr_status === 'pending') {
        return [{ affectedRows: 0 }];
      }
      doc.ocr_status = 'pending';
      doc.ocr_attempt_count = Number(doc.ocr_attempt_count || 0) + 1;
      doc.ocr_last_requested_at = new Date().toISOString();
      return [{ affectedRows: 1 }];
    }

    if (q.startsWith('UPDATE receiving_documents SET ocr_status = \'failed\'')) {
      const doc = state.documents.find((d) => d.id === Number(params[0]));
      if (doc) doc.ocr_status = 'failed';
      return [{ affectedRows: 1 }];
    }

    if (q.startsWith('UPDATE receiving_documents SET supplier_name_text = ?, doc_ref = ?')) {
      if (state.failAfterOcrVision) {
        throw new Error('Simulated DB failure after OCR vision');
      }
      const [
        supplier_name_text,
        doc_ref,
        doc_date,
        subtotal,
        discount,
        vat,
        total,
        ocr_model,
        ocr_confidence,
        ocr_images_hash,
        docId
      ] = params;
      const doc = state.documents.find((d) => d.id === Number(docId));
      if (doc) {
        Object.assign(doc, {
          supplier_name_text,
          doc_ref,
          doc_date,
          subtotal,
          discount,
          vat,
          total,
          ocr_status: 'done',
          ocr_model,
          ocr_confidence,
          ocr_images_hash
        });
      }
      return [{ affectedRows: 1 }];
    }

    if (q.startsWith('UPDATE receiving_documents SET kind = ?, supplier_master_id = ?')) {
      const [
        kind,
        supplier_master_id,
        product_group_id,
        supplier_name_text,
        delivery_date,
        doc_ref,
        doc_date,
        subtotal,
        discount,
        vat,
        total,
        is_header_edited,
        courier_name,
        docId
      ] = params;
      const doc = state.documents.find((d) => d.id === Number(docId));
      if (doc) {
        Object.assign(doc, {
          kind,
          supplier_master_id,
          product_group_id,
          supplier_name_text,
          delivery_date,
          doc_ref,
          doc_date,
          subtotal,
          discount,
          vat,
          total,
          is_header_edited: Boolean(is_header_edited),
          courier_name
        });
      }
      return [{ affectedRows: 1 }];
    }

    if (q.startsWith('UPDATE receiving_documents SET receiver_signature = ?')) {
      const [buf, mime, name, docId] = params;
      const doc = state.documents.find((d) => d.id === Number(docId));
      if (doc) {
        doc.receiver_signature = buf;
        doc.receiver_signature_mime = mime;
        if (name) doc.receiver_name = name;
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE receiving_documents SET courier_signature = ?')) {
      const [buf, mime, name, docId] = params;
      const doc = state.documents.find((d) => d.id === Number(docId));
      if (doc) {
        doc.courier_signature = buf;
        doc.courier_signature_mime = mime;
        if (name) doc.courier_name = name;
      }
      return [{ affectedRows: 1 }];
    }

    if (q.startsWith('UPDATE receiving_documents SET status = \'confirmed\'')) {
      const [userId, docId] = params;
      const doc = state.documents.find((d) => d.id === Number(docId));
      if (doc) {
        doc.status = 'confirmed';
        doc.confirmed_at = new Date().toISOString();
        doc.confirmed_by_user_id = userId;
      }
      return [{ affectedRows: 1 }];
    }

    if (q.startsWith('UPDATE receiving_documents SET status = \'void\'')) {
      const [userId, reason, docId] = params;
      const doc = state.documents.find((d) => d.id === Number(docId));
      if (doc) {
        doc.status = 'void';
        doc.voided_at = new Date().toISOString();
        doc.voided_by_user_id = userId;
        doc.void_reason = reason;
      }
      return [{ affectedRows: 1 }];
    }

    if (
      (q.includes('FROM receiving_documents') && q.includes('WHERE rd.id = ?')) ||
      q.includes('FROM receiving_documents WHERE id = ?')
    ) {
      const docId = Number(params[0]);
      const doc = state.documents.find((d) => d.id === docId);
      if (!doc) return [[]];
      return [
        [
          {
            ...structuredClone(doc),
            has_receiver_signature: Boolean(doc.receiver_signature && doc.receiver_signature.length > 0),
            has_courier_signature: Boolean(doc.courier_signature && doc.courier_signature.length > 0)
          }
        ]
      ];
    }

    if (q.includes('FROM receiving_documents rd WHERE 1=1')) {
      let docs = state.documents.map((doc) => ({
        ...structuredClone(doc),
        has_receiver_signature: Boolean(doc.receiver_signature && doc.receiver_signature.length > 0),
        has_courier_signature: Boolean(doc.courier_signature && doc.courier_signature.length > 0)
      }));
      let idx = 0;
      if (q.includes('rd.branch_id = ?')) {
        const bId = Number(params[idx++]);
        docs = docs.filter((d) => d.branch_id === bId);
      }
      if (q.includes('rd.department_id = ?')) {
        const dId = Number(params[idx++]);
        docs = docs.filter((d) => d.department_id === dId);
      }
      if (q.includes('rd.delivery_date = ?')) {
        const dt = params[idx++];
        docs = docs.filter((d) => d.delivery_date === dt);
      }
      if (q.includes('rd.status = ?')) {
        const st = params[idx++];
        docs = docs.filter((d) => d.status === st);
      }
      return [docs];
    }

    // Images upsert with ON DUPLICATE KEY UPDATE (ข้อ 11)
    if (q.startsWith('INSERT INTO receiving_document_images')) {
      const [document_id, page_no, mime_type, width, height, size_bytes, sha256, image_data] = params;
      const existing = state.images.find(
        (i) => i.document_id === Number(document_id) && i.page_no === Number(page_no)
      );
      if (existing) {
        Object.assign(existing, { mime_type, width, height, size_bytes, sha256, image_data });
        return [{ insertId: existing.id, affectedRows: 2 }];
      }
      const img = {
        id: state.nextImageId++,
        document_id: Number(document_id),
        page_no: Number(page_no),
        mime_type,
        width,
        height,
        size_bytes,
        sha256,
        image_data,
        created_at: new Date().toISOString()
      };
      state.images.push(img);
      return [{ insertId: img.id, affectedRows: 1 }];
    }
    if (q.includes('FROM receiving_document_images WHERE id = ? AND document_id = ?')) {
      const [imgId, docId] = params.map(Number);
      const img = state.images.find((i) => i.id === imgId && i.document_id === docId);
      return [img ? [img] : []];
    }
    if (q.includes('FROM receiving_document_images WHERE document_id IN')) {
      const docIds = new Set(params.map(Number));
      return [state.images.filter((i) => docIds.has(i.document_id))];
    }
    if (q.includes('FROM receiving_document_images WHERE document_id = ?')) {
      const docId = Number(params[0]);
      return [
        state.images
          .filter((i) => i.document_id === docId)
          .sort((a, b) => a.page_no - b.page_no)
      ];
    }

    // Lines queries
    if (q.startsWith('INSERT INTO receiving_document_lines')) {
      const isOrderDefault = q.includes("'order', 1.0000, false");
      const isUserEditedTrue = q.endsWith('true)');
      if (isOrderDefault) {
        const [
          document_id,
          line_no,
          bill_text,
          product_id,
          product_name,
          order_item_id,
          unit,
          unit_text,
          unit_id,
          quantity_billed,
          quantity_received,
          unit_price,
          base_unit_price,
          amount
        ] = params;
        const line = {
          id: state.nextLineId++,
          document_id: Number(document_id),
          line_no: Number(line_no),
          bill_text,
          product_id: product_id !== null ? Number(product_id) : null,
          product_name,
          order_item_id: order_item_id !== null ? Number(order_item_id) : null,
          unit,
          unit_text,
          unit_id: unit_id !== null ? Number(unit_id) : null,
          unit_multiplier: 1,
          quantity_billed,
          quantity_received,
          unit_price,
          base_unit_price,
          amount,
          match_source: 'order',
          match_confidence: 1,
          is_user_edited: false,
          prev_order_received_quantity: null,
          prev_order_actual_price: null,
          prev_order_is_received: null,
          prev_order_received_by_user_id: null,
          prev_order_received_at: null,
          applied_order_received_quantity: null,
          applied_order_actual_price: null
        };
        state.lines.push(line);
        return [{ insertId: line.id }];
      }

      const [
        document_id,
        line_no,
        bill_text,
        product_id,
        product_name,
        order_item_id,
        unit,
        unit_text,
        unit_id,
        unit_multiplier,
        quantity_billed,
        quantity_received,
        unit_price,
        base_unit_price,
        amount,
        match_source,
        match_confidence
      ] = params;
      const line = {
        id: state.nextLineId++,
        document_id: Number(document_id),
        line_no: Number(line_no),
        bill_text,
        product_id: product_id !== null ? Number(product_id) : null,
        product_name,
        order_item_id: order_item_id !== null ? Number(order_item_id) : null,
        unit,
        unit_text,
        unit_id: unit_id !== null ? Number(unit_id) : null,
        unit_multiplier: Number(unit_multiplier || 1),
        quantity_billed,
        quantity_received,
        unit_price,
        base_unit_price,
        amount,
        match_source,
        match_confidence,
        is_user_edited: isUserEditedTrue,
        prev_order_received_quantity: null,
        prev_order_actual_price: null,
        prev_order_is_received: null,
        prev_order_received_by_user_id: null,
        prev_order_received_at: null,
        applied_order_received_quantity: null,
        applied_order_actual_price: null
      };
      state.lines.push(line);
      return [{ insertId: line.id }];
    }

    if (q.startsWith('DELETE FROM receiving_document_lines WHERE document_id = ? AND COALESCE(is_user_edited, false) = false')) {
      const docId = Number(params[0]);
      state.lines = state.lines.filter(
        (l) => l.document_id !== docId || Boolean(l.is_user_edited)
      );
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('DELETE FROM receiving_document_lines WHERE document_id = ? AND id IN')) {
      const docId = Number(params[0]);
      const delIds = new Set(params.slice(1).map(Number));
      state.lines = state.lines.filter(
        (l) => !(l.document_id === docId && delIds.has(l.id))
      );
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE receiving_document_lines SET line_no = ?')) {
      const [
        line_no,
        bill_text,
        product_id,
        product_name,
        order_item_id,
        unit,
        unit_text,
        unit_id,
        unit_multiplier,
        quantity_billed,
        quantity_received,
        unit_price,
        base_unit_price,
        amount,
        match_source,
        match_confidence,
        is_user_edited,
        lineId,
        docId
      ] = params;
      const line = state.lines.find(
        (l) => l.id === Number(lineId) && l.document_id === Number(docId)
      );
      if (line) {
        Object.assign(line, {
          line_no: Number(line_no),
          bill_text,
          product_id: product_id !== null ? Number(product_id) : null,
          product_name,
          order_item_id: order_item_id !== null ? Number(order_item_id) : null,
          unit,
          unit_text,
          unit_id: unit_id !== null ? Number(unit_id) : null,
          unit_multiplier: Number(unit_multiplier || 1),
          quantity_billed,
          quantity_received,
          unit_price,
          base_unit_price,
          amount,
          match_source,
          match_confidence,
          is_user_edited: Boolean(is_user_edited)
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE receiving_document_lines SET prev_order_received_quantity = ?')) {
      const [
        prev_order_received_quantity,
        prev_order_actual_price,
        prev_order_is_received,
        prev_order_received_by_user_id,
        prev_order_received_at,
        applied_order_received_quantity,
        applied_order_actual_price,
        lineId
      ] = params;
      const line = state.lines.find((l) => l.id === Number(lineId));
      if (line) {
        Object.assign(line, {
          prev_order_received_quantity,
          prev_order_actual_price,
          prev_order_is_received,
          prev_order_received_by_user_id,
          prev_order_received_at,
          applied_order_received_quantity,
          applied_order_actual_price
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (q.includes('FROM receiving_document_lines WHERE document_id = ?')) {
      const docId = Number(params[0]);
      return [
        structuredClone(
          state.lines
            .filter((l) => l.document_id === docId)
            .sort((a, b) => a.line_no - b.line_no || a.id - b.id)
        )
      ];
    }

    // Aliases queries (ข้อ 8: ป้องกันการเขียนทับ product_id ข้ามสาขาโดยพลการ)
    if (q.includes('FROM supplier_product_aliases spa')) {
      return [structuredClone(state.aliases)];
    }
    if (q.startsWith('INSERT INTO supplier_product_aliases')) {
      const [
        supplier_key,
        supplier_master_id,
        product_group_id,
        supplier_name_text,
        bill_text,
        normalized_bill_text,
        unit_text,
        normalized_unit_text,
        product_id,
        unit_id,
        unit_multiplier,
        last_unit_price,
        updated_by_user_id,
        adminFlag
      ] = params;
      const isAdmin = Number(adminFlag) === 1;
      const existing = state.aliases.find(
        (a) =>
          a.supplier_key === supplier_key &&
          a.normalized_bill_text === normalized_bill_text &&
          a.normalized_unit_text === normalized_unit_text
      );
      if (existing) {
        const nextPid = Number(product_id);
        if (existing.product_id === nextPid) {
          existing.confirm_count += 1;
          existing.last_unit_price = last_unit_price ?? existing.last_unit_price;
          existing.unit_multiplier = Number(unit_multiplier || existing.unit_multiplier || 1);
          existing.candidate_product_id = null;
          existing.candidate_confirm_count = 0;
        } else if (isAdmin || existing.confirm_count <= 1) {
          existing.product_id = nextPid;
          existing.confirm_count = 1;
          existing.unit_multiplier = Number(unit_multiplier || 1);
          existing.last_unit_price = last_unit_price ?? existing.last_unit_price;
          existing.candidate_product_id = null;
          existing.candidate_confirm_count = 0;
        } else if (
          existing.candidate_product_id === nextPid &&
          existing.candidate_confirm_count + 1 >= 3
        ) {
          existing.product_id = nextPid;
          existing.confirm_count = 3;
          existing.candidate_product_id = null;
          existing.candidate_confirm_count = 0;
        } else if (existing.candidate_product_id === nextPid) {
          existing.candidate_confirm_count += 1;
        } else {
          existing.candidate_product_id = nextPid;
          existing.candidate_confirm_count = 1;
        }
        existing.updated_by_user_id = updated_by_user_id;
      } else {
        state.aliases.push({
          id: state.nextAliasId++,
          supplier_key,
          supplier_master_id,
          product_group_id,
          supplier_name_text,
          bill_text,
          normalized_bill_text,
          unit_text,
          normalized_unit_text,
          product_id: Number(product_id),
          unit_id,
          unit_multiplier: Number(unit_multiplier || 1),
          last_unit_price,
          confirm_count: 2, // สมมติว่ามีหลักฐานในระบบแล้วเมื่อสร้าง
          candidate_product_id: null,
          candidate_confirm_count: 0,
          updated_by_user_id
        });
      }
      return [{ affectedRows: 1 }];
    }

    if (q.includes('FROM order_items WHERE id = ? FOR UPDATE')) {
      const oi = state.orderItems.find((item) => item.id === Number(params[0]));
      return [oi ? [structuredClone(oi)] : []];
    }
    if (q.startsWith('UPDATE order_items SET received_quantity = ?, actual_price = ?, is_received = ?, received_by_user_id = ?, received_at = ? WHERE id = ?')) {
      const [
        received_quantity,
        actual_price,
        is_received,
        received_by_user_id,
        received_at,
        orderItemId
      ] = params;
      const oi = state.orderItems.find((item) => item.id === Number(orderItemId));
      if (oi) {
        oi.received_quantity = received_quantity;
        oi.actual_price = actual_price;
        oi.is_received = Boolean(is_received);
        oi.received_by_user_id = received_by_user_id;
        oi.received_at = received_at;
      }
      return [{ affectedRows: 1 }];
    }

    // Inventory balance & transactions (รองรับทั้ง lockBalanceRow และ createInventoryTransactionForReceiving)
    if (q.startsWith('INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id) VALUES (?, ?, 0, NULL)')) {
      const key = `${Number(params[0])}:${Number(params[1])}`;
      if (!state.inventoryBalances.has(key)) {
        state.inventoryBalances.set(key, {
          product_id: Number(params[0]),
          department_id: Number(params[1]),
          quantity: 0,
          last_transaction_id: null
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT quantity FROM inventory_balance WHERE product_id = ? AND department_id = ? FOR UPDATE')) {
      const key = `${Number(params[0])}:${Number(params[1])}`;
      const bal = state.inventoryBalances.get(key);
      return [bal ? [{ quantity: bal.quantity }] : []];
    }
    if (q.startsWith('INSERT INTO inventory_transactions')) {
      if (q.includes("'order_receiving'")) {
        const [
          product_id,
          department_id,
          transaction_type,
          quantity,
          balance_before,
          balance_after,
          reference_id,
          notes,
          created_by
        ] = params;
        const tx = {
          id: state.nextTxId++,
          product_id: Number(product_id),
          department_id: Number(department_id),
          transaction_type,
          quantity: Number(quantity),
          balance_before: Number(balance_before),
          balance_after: Number(balance_after),
          reference_type: 'order_receiving',
          reference_id,
          notes,
          created_by
        };
        state.inventoryTransactions.push(tx);
        return [{ insertId: tx.id }];
      }
      const isReceive = q.includes("'receive'");
      const [
        product_id,
        department_id,
        quantity,
        balance_before,
        balance_after,
        reference_id,
        notes,
        created_by
      ] = params;
      const tx = {
        id: state.nextTxId++,
        product_id: Number(product_id),
        department_id: Number(department_id),
        transaction_type: isReceive ? 'receive' : 'adjustment',
        quantity: Number(quantity),
        balance_before: Number(balance_before),
        balance_after: Number(balance_after),
        reference_type: isReceive ? 'receiving_document' : 'receiving_document_void',
        reference_id,
        notes,
        created_by
      };
      state.inventoryTransactions.push(tx);
      return [{ insertId: tx.id }];
    }
    if (q.startsWith('INSERT INTO inventory_balance')) {
      const [product_id, department_id, quantity, last_transaction_id] = params;
      const key = `${Number(product_id)}:${Number(department_id)}`;
      state.inventoryBalances.set(key, {
        product_id: Number(product_id),
        department_id: Number(department_id),
        quantity: Number(quantity),
        last_transaction_id
      });
      return [{ affectedRows: 1 }];
    }

    if (q.startsWith('INSERT INTO receiving_document_audits')) {
      const [document_id, action, actor_user_id, actor_name, details_json] = params;
      state.audits.push({
        id: state.nextAuditId++,
        document_id: Number(document_id),
        action,
        actor_user_id,
        actor_name,
        details: details_json ? JSON.parse(details_json) : null
      });
      return [{ insertId: state.audits.length }];
    }

    throw new Error(`Unmocked SQL in receiving test harness: ${q}`);
  };

  const connection = {
    query,
    async beginTransaction() {
      snapshot = structuredClone({
        documents: state.documents,
        lines: state.lines,
        images: state.images,
        aliases: state.aliases,
        audits: state.audits,
        orderItems: state.orderItems,
        inventoryTransactions: state.inventoryTransactions,
        inventoryBalances: Array.from(state.inventoryBalances.entries())
      });
    },
    async commit() {
      snapshot = null;
    },
    async rollback() {
      if (snapshot) {
        state.documents = snapshot.documents;
        state.lines = snapshot.lines;
        state.images = snapshot.images;
        state.aliases = snapshot.aliases;
        state.audits = snapshot.audits;
        state.orderItems = snapshot.orderItems;
        state.inventoryTransactions = snapshot.inventoryTransactions;
        state.inventoryBalances = new Map(snapshot.inventoryBalances);
      }
    },
    release() {}
  };

  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Buffer,
    Date,
    Intl,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Error,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    setTimeout,
    clearTimeout,
    process: { env: {} }
  });

  const synthetic = (exportsObj) =>
    new vm.SyntheticModule(
      Object.keys(exportsObj),
      function () {
        for (const [k, v] of Object.entries(exportsObj)) {
          this.setExport(k, v);
        }
      },
      { context }
    );

  // โหลด order.model.js จริง เพื่อให้ confirm/void เรียก updateOrderItemReceivingWithInventory ของจริง!
  const orderInputMod = await import('../src/utils/order-input.js');
  const orderModelMod = new vm.SourceTextModule(
    await read('../src/models/order.model.js'),
    { context }
  );
  const helpersMod = new vm.SourceTextModule(
    await read('../src/models/receiving-documents-helpers.js'),
    { context }
  );
  const ocrFlowMod = new vm.SourceTextModule(
    await read('../src/models/receiving-documents-ocr-flow.js'),
    { context }
  );
  const settlementMod = new vm.SourceTextModule(
    await read('../src/models/receiving-documents-settlement.js'),
    { context }
  );
  const modelMod = new vm.SourceTextModule(
    await read('../src/models/receiving-documents.model.js'),
    { context }
  );
  const controllerMod = new vm.SourceTextModule(
    await read('../src/controllers/receiving-documents.controller.js'),
    { context }
  );

  const lockBalanceRowReal = async (conn, productId, departmentId) => {
    await conn.query(
      `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
       VALUES (?, ?, 0, NULL)
       ON DUPLICATE KEY UPDATE product_id = product_id`,
      [productId, departmentId]
    );
    const [rows] = await conn.query(
      `SELECT quantity FROM inventory_balance
       WHERE product_id = ? AND department_id = ?
       FOR UPDATE`,
      [productId, departmentId]
    );
    return rows.length > 0 ? parseFloat(rows[0].quantity || 0) : 0;
  };

  const linkAll = async (mod) => {
    await mod.link((specifier) => {
      if (specifier === 'node:crypto') return synthetic({ default: crypto, ...crypto });
      if (specifier.endsWith('/database.js')) {
        return synthetic({ default: { query, getConnection: async () => connection } });
      }
      if (specifier.endsWith('/bangkok-date.js')) return synthetic(bangkokDate);
      if (specifier.endsWith('/order-input.js')) return synthetic(orderInputMod);
      if (specifier.endsWith('/inventory.model.js')) {
        return synthetic({
          ensureInventoryTables: async () => {},
          lockBalanceRow: lockBalanceRowReal
        });
      }
      if (specifier.endsWith('/supplier.model.js')) {
        return synthetic({
          ensureSupplierColumns: async () => {},
          ensureProductGroupWithdrawSourceTable: async () => {},
          ensureSupplierScopeTable: async () => {},
          getMappedSourceDepartmentByProductGroup: async () => null
        });
      }
      if (specifier.endsWith('/withdraw-source-mapping.model.js')) {
        return synthetic({ ensureWithdrawSourceMappingTable: async () => {} });
      }
      if (specifier.endsWith('/order.model.js')) return orderModelMod;
      if (specifier.endsWith('/receiving-documents-schema.js')) {
        return synthetic({ ensureReceivingDocumentsTables: async () => {} });
      }
      if (specifier.endsWith('/receiving-ocr-matcher.js')) return synthetic(ocrMatcher);
      if (specifier.endsWith('/receiving-ocr.service.js')) return synthetic(ocrService);
      if (specifier.endsWith('/receiving-documents-helpers.js')) return helpersMod;
      if (specifier.endsWith('/receiving-documents-ocr-flow.js')) return ocrFlowMod;
      if (specifier.endsWith('/receiving-documents-settlement.js')) return settlementMod;
      if (specifier.endsWith('/receiving-documents.model.js')) return modelMod;
      throw new Error(`Unexpected specifier: ${specifier}`);
    });
  };

  for (const m of [
    orderModelMod,
    helpersMod,
    ocrFlowMod,
    settlementMod,
    modelMod,
    controllerMod
  ]) {
    await linkAll(m);
    await m.evaluate();
  }

  const invoke = async (handlerName, { user, params = {}, query: qParams = {}, body = {} } = {}) => {
    let statusCode = 200;
    let jsonBody;
    let binaryBody;
    const headers = {};
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      set(k, v) {
        headers[k.toLowerCase()] = v;
        return this;
      },
      json(payload) {
        jsonBody = payload;
        return this;
      },
      send(payload) {
        binaryBody = payload;
        return this;
      }
    };
    await controllerMod.namespace[handlerName](
      { user, params, query: qParams, body },
      res,
      (err) => {
        throw err;
      }
    );
    return { statusCode, body: jsonBody, binaryBody, headers };
  };

  return { state, invoke, controller: controllerMod.namespace, today };
}

// ============================================================================
// 5. ทดสอบ Route 401 ทุก Endpoint และลำดับ middleware (authenticate ก่อน 6mb parser) (ข้อ 9)
// ============================================================================
test('all 10 endpoints require authenticate (401 without token) and authenticate runs before 6mb json parser', async () => {
  const routeSource = await read('../src/routes/receiving-documents.routes.js');
  const authIdx = routeSource.indexOf('router.use(authenticate)');
  const jsonIdx = routeSource.indexOf("router.use(express.json({ limit: '6mb' }))");
  assert.ok(authIdx > 0 && jsonIdx > authIdx, 'authenticate must run before 6mb express.json');

  const authSource = await read('../src/middleware/auth.js');
  const context = vm.createContext({ console });
  const authMod = new vm.SourceTextModule(authSource, { context });
  await authMod.link((specifier) => {
    if (specifier.endsWith('/jwt.js')) {
      return new vm.SyntheticModule(['verifyToken'], function () {
        this.setExport('verifyToken', () => {
          throw new Error('Invalid token');
        });
      }, { context });
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  });
  await authMod.evaluate();

  const endpoints = [
    ['GET', '/expected'],
    ['GET', '/'],
    ['POST', '/'],
    ['GET', '/1'],
    ['PUT', '/1'],
    ['POST', '/1/images'],
    ['GET', '/1/images/1'],
    ['POST', '/1/ocr'],
    ['POST', '/1/signatures'],
    ['POST', '/1/confirm'],
    ['POST', '/1/void']
  ];

  for (const [method, path] of endpoints) {
    for (const headers of [{}, { authorization: 'Bearer invalid-token' }]) {
      let status = 200;
      let payload = null;
      const res = {
        status(c) {
          status = c;
          return this;
        },
        json(b) {
          payload = b;
          return this;
        }
      };
      authMod.namespace.authenticate({ method, path, headers }, res, () => {
        status = 200;
      });
      assert.equal(status, 401, `${method} ${path} must return 401`);
      assert.equal(payload.success, false);
    }
  }
});

// ============================================================================
// 6. ทดสอบ Critical ข้อ 1 & IDOR: ห้ามข้ามสาขาทุก Endpoint และห้ามผูก order_item_id ข้ามสาขาหรือผิดสินค้า
// ============================================================================
test('IDOR & Cross-Branch Order Item Protection (Issue #1 Critical): blocks cross-branch access and cross-branch order_item_id on POST, PUT, and confirm', async () => {
  const h = await createReceivingHarness();
  const branchAUser = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };
  const branchBUser = { id: 88, name: 'UserB', role: 'user', branch_id: 2, department_id: 20 };

  // สาขา A พยายามสร้างเอกสารโดยแนบ order_item_id 99 ของสาขา B -> ต้องถูกบล็อกด้วย 403 FORBIDDEN
  const createWithBranchBOrderItem = await h.invoke('createDocument', {
    user: branchAUser,
    body: {
      client_uuid: 'cross-branch-create-1',
      delivery_date: h.today,
      kind: 'bill',
      order_item_ids: [99]
    }
  });
  assert.equal(createWithBranchBOrderItem.statusCode, 403);
  assert.equal(createWithBranchBOrderItem.body.code, 'FORBIDDEN');

  // สาขา A สร้างเอกสารของตัวเอง (order_item_id 50)
  const created = await h.invoke('createDocument', {
    user: branchAUser,
    body: {
      client_uuid: 'valid-branch-a-doc',
      delivery_date: h.today,
      kind: 'bill',
      order_item_ids: [50]
    }
  });
  assert.equal(created.statusCode, 201);
  const docId = String(created.body.data.id);

  // อัปโหลดรูปบิลของสาขา A
  const imgRes = await h.invoke('uploadImage', {
    user: branchAUser,
    params: { id: docId },
    body: { page_no: 1, image_data_url: makeJpegDataUrl(400, 400) }
  });
  const imageId = String(imgRes.body.data.image_id);

  // ผู้ใช้สาขา B พยายามเข้าถึงเอกสารของสาขา A ทุก endpoint ต้องได้ 403 FORBIDDEN
  for (const [handler, extra] of [
    ['getDocumentById', {}],
    ['updateDocument', { body: { doc_ref: 'HACK' } }],
    ['uploadImage', { body: { page_no: 2, image_data_url: makeJpegDataUrl(100, 100) } }],
    ['getImageBinary', { params: { id: docId, imageId } }],
    ['runOcr', {}],
    ['addSignature', { body: { role: 'receiver', image_data_url: makePngDataUrl(50, 50) } }],
    ['confirmDocument', {}],
    ['voidDocument', { body: { reason: 'hack' } }]
  ]) {
    const res = await h.invoke(handler, {
      user: branchBUser,
      params: extra.params || { id: docId },
      body: extra.body || {}
    });
    assert.equal(res.statusCode, 403, `Expected 403 on ${handler} by branch B user`);
    assert.equal(res.body.code, 'FORBIDDEN');
  }

  // สาขา A พยายาม PUT ยัด order_item_id 99 ของสาขา B -> ต้องได้ 403 FORBIDDEN
  const putCrossBranchOi = await h.invoke('updateDocument', {
    user: branchAUser,
    params: { id: docId },
    body: {
      lines: [
        {
          line_no: 1,
          bill_text: 'หมูสามชั้น',
          product_id: 7,
          order_item_id: 99,
          quantity_received: '5',
          unit_price: '150.00'
        }
      ]
    }
  });
  assert.equal(putCrossBranchOi.statusCode, 403);
  assert.equal(putCrossBranchOi.body.code, 'FORBIDDEN');

  // สาขา A พยายาม PUT ผูก order_item_id 50 (product_id 7) แต่ส่ง product_id 8 -> ต้องได้ 422 VALIDATION_FAILED
  const putMismatchedProduct = await h.invoke('updateDocument', {
    user: branchAUser,
    params: { id: docId },
    body: {
      lines: [
        {
          line_no: 1,
          bill_text: 'ผักกาดขาวปลอมเป็นหมู',
          product_id: 8,
          order_item_id: 50,
          quantity_received: '5',
          unit_price: '40.00'
        }
      ]
    }
  });
  assert.equal(putMismatchedProduct.statusCode, 422);
  assert.equal(putMismatchedProduct.body.code, 'VALIDATION_FAILED');

  // แม้มีบรรทัดใน DB ที่ชี้ไปสาขา B (จำลองกรณีข้อมูลในตารางถูกแก้ไขตรง) ตอนกด confirm ก็ต้องตรวจซ้ำและบล็อกด้วย 403!
  await h.invoke('addSignature', {
    user: branchAUser,
    params: { id: docId },
    body: { role: 'receiver', image_data_url: makePngDataUrl(100, 50) }
  });
  h.state.lines[0].order_item_id = 99;
  const confirmCrossBranch = await h.invoke('confirmDocument', {
    user: branchAUser,
    params: { id: docId }
  });
  assert.equal(confirmCrossBranch.statusCode, 403);
  assert.equal(confirmCrossBranch.body.code, 'FORBIDDEN');
  assert.equal(h.state.orderItems.find((i) => i.id === 99).received_quantity, null);
});

// ============================================================================
// 7. ทดสอบ High ข้อ 2 & ข้อ 5: OCR Lock, Race กับ Confirm, SHA-256 Dedupe และ DB Rollback
// ============================================================================
test('OCR deduplicates identical images via sha256, blocks concurrent OCR, and aborts if document is confirmed while waiting for AI (Issues #2, #5, #7)', async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  const created = await h.invoke('createDocument', {
    user,
    body: { client_uuid: 'ocr-race-doc', delivery_date: h.today, kind: 'bill', product_group_id: 3 }
  });
  const docId = String(created.body.data.id);

  await h.invoke('uploadImage', {
    user,
    params: { id: docId },
    body: { page_no: 1, image_data_url: makeJpegDataUrl(500, 700) }
  });

  let aiCallCount = 0;
  ocrService.setCustomOcrProvider(async () => {
    aiCallCount += 1;
    return {
      supplier_name: 'ตลาดสดสันกำแพง',
      doc_ref: 'INV-DEDUPE-1',
      doc_date: h.today,
      total: 400,
      confidence: 0.95,
      lines: [{ line_no: 1, bill_text: 'ผักกาดขาว', quantity_billed: 4, unit_text: 'กก.', unit_price: 40, amount: 160, confidence: 0.95 }]
    };
  });

  try {
    // รัน OCR ครั้งที่ 1 -> เรียก AI
    const ocr1 = await h.invoke('runOcr', { user, params: { id: docId } });
    assert.equal(ocr1.statusCode, 200);
    assert.equal(aiCallCount, 1);

    // รัน OCR ครั้งที่ 2 โดยรูปเดิมเป๊ะ (sha256 เดิม) -> ต้องไม่เรียก AI ซ้ำ (ข้อ 5)
    const ocr2 = await h.invoke('runOcr', { user, params: { id: docId } });
    assert.equal(ocr2.statusCode, 200);
    assert.equal(aiCallCount, 1, 'Must not call AI again when page sha256 hashes are unchanged');

    // อัปโหลดรูปใหม่เพื่อให้ hash เปลี่ยน แล้วจำลองว่ามีคนกด confirm ระหว่างที่ AI กำลังอ่านบิล (ข้อ 2)
    await h.invoke('uploadImage', {
      user,
      params: { id: docId },
      body: { page_no: 1, image_data_url: makeJpegDataUrl(600, 800, 32) }
    });

    ocrService.setCustomOcrProvider(async () => {
      aiCallCount += 1;
      // ระหว่างรอ AI มีการ confirm เอกสารไปแล้ว
      const docInDb = h.state.documents.find((d) => d.id === Number(docId));
      docInDb.status = 'confirmed';
      return {
        supplier_name: 'ไม่ควรเขียนทับ',
        doc_ref: 'OVERWRITE-ATTEMPT',
        total: 9999,
        confidence: 0.95,
        lines: [{ line_no: 1, bill_text: 'หมูสามชั้น', quantity_billed: 99, unit_price: 100, amount: 9900 }]
      };
    });

    const ocrDuringConfirm = await h.invoke('runOcr', { user, params: { id: docId } });
    assert.equal(ocrDuringConfirm.statusCode, 409);
    assert.equal(ocrDuringConfirm.body.code, 'NOT_DRAFT');
    const docAfterRace = h.state.documents.find((d) => d.id === Number(docId));
    assert.equal(docAfterRace.doc_ref, 'INV-DEDUPE-1', 'Confirmed document must not be overwritten by late OCR');

    // ทดสอบกรณี DB ล้มเหลวหลัง AI สำเร็จ -> ocr_status ต้องถูกตั้งเป็น failed ไม่ค้าง pending (ข้อ 7)
    docAfterRace.status = 'draft';
    docAfterRace.ocr_status = 'none';
    docAfterRace.ocr_images_hash = null;
    h.state.failAfterOcrVision = true;
    ocrService.setCustomOcrProvider(async () => ({
      supplier_name: 'ร้านทดสอบ',
      doc_ref: 'FAIL-DB',
      total: 100,
      confidence: 0.9,
      lines: []
    }));

    const ocrDbFail = await h.invoke('runOcr', { user, params: { id: docId } });
    assert.equal(ocrDbFail.statusCode, 500);
    assert.equal(ocrDbFail.body.code, 'INTERNAL_ERROR');
    // ข้อ 6: ข้อความ 500 ต้องเป็นข้อความกลางภาษาไทย ไม่หลุดข้อความ SQL/internal error
    assert.doesNotMatch(ocrDbFail.body.message, /Simulated DB failure/);
    assert.equal(h.state.documents.find((d) => d.id === Number(docId)).ocr_status, 'failed');
    h.state.failAfterOcrVision = false;
  } finally {
    ocrService.setCustomOcrProvider(null);
  }
});

// ============================================================================
// 8. ทดสอบ High ข้อ 3 & ข้อ 4: คลังคิดเฉพาะส่วนต่าง (Delta) เมื่อเคยรับผ่าน Flow เดิม, ไม่บวกสินค้าไม่นับสต็อก, และ Void ป้องกันทับงานทีหลัง
// ============================================================================
test('confirm computes inventory delta when order_item was already received via legacy flow, skips uncountable products, and void blocks if modified later (Issues #3, #4, #15)', async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

  // สมมติว่า order_item 50 (สั่ง 10 กก.) เคยถูกรับผ่านหน้าเว็บเดิมไปแล้ว 6 กก. และคลังมีอยู่ 11 กก. (5 + 6)
  const oi50 = h.state.orderItems.find((i) => i.id === 50);
  oi50.received_quantity = 6;
  oi50.is_received = true;
  oi50.actual_price = 140;
  h.state.inventoryBalances.set('7:10', { product_id: 7, department_id: 10, quantity: 11 });

  const created = await h.invoke('createDocument', {
    user,
    body: {
      client_uuid: 'delta-test-doc',
      delivery_date: h.today,
      kind: 'bill',
      product_group_id: 3,
      order_item_ids: [50]
    }
  });
  const docId = String(created.body.data.id);
  const lineId = created.body.data.lines[0].id;

  // แก้เป็นรับจริงรวม 10 กก. (ส่วนต่าง delta = 10 - 6 = +4 กก.) + เพิ่มสินค้าไม่นับสต็อก (product_id: 9)
  const putRes = await h.invoke('updateDocument', {
    user,
    params: { id: docId },
    body: {
      lines: [
        {
          id: lineId,
          line_no: 1,
          bill_text: 'หมูสามชั้น',
          product_id: 7,
          order_item_id: 50,
          quantity_received: '10',
          unit_price: '150.25'
        },
        {
          line_no: 2,
          bill_text: 'น้ำแข็งบด',
          product_id: 9,
          order_item_id: null,
          quantity_received: '5',
          unit_price: '20.00'
        }
      ]
    }
  });
  assert.equal(putRes.statusCode, 200);

  await h.invoke('addSignature', {
    user,
    params: { id: docId },
    body: { role: 'receiver', image_data_url: makePngDataUrl(200, 80) }
  });

  // ทดสอบกด confirm พร้อมกัน 2 คำขอ หรือซ้ำ -> สำเร็จครั้งเดียว อีกคำขอได้ 409 NOT_DRAFT
  const confirm1 = await h.invoke('confirmDocument', { user, params: { id: docId } });
  assert.equal(confirm1.statusCode, 200);
  const confirm2 = await h.invoke('confirmDocument', { user, params: { id: docId } });
  assert.equal(confirm2.statusCode, 409);
  assert.equal(confirm2.body.code, 'NOT_DRAFT');

  // สต็อกของสินค้า 7 ต้องบวกเฉพาะส่วนต่าง +4 (จาก 11 เป็น 15 ไม่ใช่ 11 + 10 = 21!)
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 15);
  // สินค้า 9 (is_countable = 0) ต้องไม่ถูกสร้างแถวสต็อก
  assert.equal(h.state.inventoryBalances.has('9:10'), false);

  // ข้อ 4: หากมีคนแก้ไข order_item 50 ผ่านหน้าเว็บหลังจาก confirm ไปแล้ว (เช่น แก้ received_quantity เป็น 12)
  // การกด void ต้องถูกปฏิเสธด้วย 409 NOT_DRAFT เพื่อไม่ให้ทับงานที่เกิดทีหลัง!
  h.state.orderItems.find((i) => i.id === 50).received_quantity = 12;
  const voidConflict = await h.invoke('voidDocument', {
    user,
    params: { id: docId },
    body: { reason: 'ขอยกเลิก' }
  });
  assert.equal(voidConflict.statusCode, 409);
  assert.equal(voidConflict.body.code, 'NOT_DRAFT');

  // คืนค่ากลับมาเป็น 10 (เท่าที่เอกสารนี้ตั้งไว้) แล้วทดสอบข้อ 15:
  // ถ้า confirmed_at เป็นวันก่อนหน้า แม้ delivery_date จะเป็นวันนี้ ผู้ใช้ทั่วไปก็ต้อง void ไม่ได้ (403 FORBIDDEN)
  h.state.orderItems.find((i) => i.id === 50).received_quantity = 10;
  h.state.documents.find((d) => d.id === Number(docId)).confirmed_at = '2026-10-01T10:00:00.000Z';
  const voidPastDay = await h.invoke('voidDocument', {
    user,
    params: { id: docId },
    body: { reason: 'ข้ามวันแล้ว' }
  });
  assert.equal(voidPastDay.statusCode, 403);
  assert.equal(voidPastDay.body.code, 'FORBIDDEN');

  // เมื่อ confirmed_at เป็นวันนี้ เจ้าของเอกสาร void ได้ และสต็อกต้องย้อนกลับจาก 15 เหลือ 11 (ค่าก่อนเอกสารนี้)
  h.state.documents.find((d) => d.id === Number(docId)).confirmed_at = new Date().toISOString();
  const voidOk = await h.invoke('voidDocument', {
    user,
    params: { id: docId },
    body: { reason: 'ยกเลิกภายในวันเดียวกัน' }
  });
  assert.equal(voidOk.statusCode, 200);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 11);
  assert.equal(h.state.orderItems.find((i) => i.id === 50).received_quantity, 6);
  assert.equal(h.state.orderItems.find((i) => i.id === 50).actual_price, 140);

  // กด void ซ้ำต้องได้ 409 NOT_DRAFT ไม่ย้อนสต็อกซ้ำ
  const voidAgain = await h.invoke('voidDocument', {
    user,
    params: { id: docId },
    body: { reason: 'กดซ้ำ' }
  });
  assert.equal(voidAgain.statusCode, 409);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 11);
});

// ============================================================================
// 9. ทดสอบ Rollback ทั้งหมดเมื่อ Confirm ล้มเหลวกลางคัน + ป้องกันการเปลี่ยน Alias ข้ามสาขา (ข้อ 8) + ตรวจ Admin branch/dept (ข้อ 14)
// ============================================================================
test('confirm rolls back all changes on error, protects alias product_id from single non-admin override (Issue #8), and validates admin branch/dept pair (Issue #14)', async () => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };
  const admin = { id: 1, name: 'Admin', role: 'admin' };

  // ข้อ 14: Admin ระบุ branch_id=1 แต่ department_id=20 (ซึ่งอยู่สาขา 2) ต้องได้ 422 VALIDATION_FAILED
  const badAdminPair = await h.invoke('getExpected', {
    user: admin,
    query: { date: h.today, branch_id: '1', department_id: '20' }
  });
  assert.equal(badAdminPair.statusCode, 422);
  assert.equal(badAdminPair.body.code, 'VALIDATION_FAILED');

  // สร้างเอกสารและจำลองความล้มเหลวระหว่าง confirm -> ต้อง rollback ทั้ง order_items และ inventory
  const created = await h.invoke('createDocument', {
    user,
    body: {
      client_uuid: 'rollback-test-doc',
      delivery_date: h.today,
      kind: 'bill',
      product_group_id: 3,
      order_item_ids: [50]
    }
  });
  const docId = String(created.body.data.id);

  await h.invoke('addSignature', {
    user,
    params: { id: docId },
    body: { role: 'receiver', image_data_url: makePngDataUrl(150, 60) }
  });

  h.state.failOnConfirmStep = true;
  const failedConfirm = await h.invoke('confirmDocument', { user, params: { id: docId } });
  assert.equal(failedConfirm.statusCode, 500);
  assert.equal(failedConfirm.body.code, 'INTERNAL_ERROR');
  // ตรวจสอบว่า rollback ครบ: เอกสารยังเป็น draft, สต็อกยังเป็น 5, order_item 50 ยังไม่ถูกรับ
  assert.equal(h.state.documents.find((d) => d.id === Number(docId)).status, 'draft');
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
  assert.equal(h.state.orderItems.find((i) => i.id === 50).received_quantity, null);

  // ปิด flag แล้ว confirm สำเร็จ -> สร้าง alias "หมูสามชั้น" -> product_id 7
  h.state.failOnConfirmStep = false;
  const okConfirm = await h.invoke('confirmDocument', { user, params: { id: docId } });
  assert.equal(okConfirm.statusCode, 200);
  assert.equal(h.state.aliases[0].product_id, 7);

  // ข้อ 8: ผู้ใช้ทั่วไป (ไม่ใช่ admin) สร้างบิลใหม่ที่ข้อความ "หมูสามชั้น" (หน่วย "กก.") แต่จับคู่ผิดเป็น product_id 8 เพียงครั้งเดียว
  // ต้องไม่เปลี่ยน alias.product_id ทันที (เก็บไว้ใน candidate_product_id ก่อน)
  const doc2 = await h.invoke('createDocument', {
    user,
    body: { client_uuid: 'alias-protect-doc', delivery_date: h.today, kind: 'bill', product_group_id: 3 }
  });
  const doc2Id = String(doc2.body.data.id);
  await h.invoke('updateDocument', {
    user,
    params: { id: doc2Id },
    body: {
      lines: [
        {
          line_no: 1,
          bill_text: 'หมูสามชั้น',
          unit_text: 'กก.',
          product_id: 8,
          quantity_received: '2',
          unit_price: '40.00'
        }
      ]
    }
  });
  await h.invoke('addSignature', {
    user,
    params: { id: doc2Id },
    body: { role: 'receiver', image_data_url: makePngDataUrl(150, 60) }
  });
  await h.invoke('confirmDocument', { user, params: { id: doc2Id } });

  // product_id หลักของ alias ต้องยังคงเป็น 7 (ไม่ถูกเขียนทับเป็น 8 จากความผิดพลาดครั้งเดียว)
  assert.equal(h.state.aliases[0].product_id, 7);
  assert.equal(h.state.aliases[0].candidate_product_id, 8);
  assert.equal(h.state.aliases[0].candidate_confirm_count, 1);
});

// ============================================================================
// 10. ทดสอบ Flow ครบวงจร + Idempotent client_uuid (รวมกรณีชนกัน ER_DUP_ENTRY) + ห้ามซ้ำ order_item_id ในเอกสาร
// ============================================================================
test('full receiving-documents flow: expected -> create (concurrent ER_DUP_ENTRY idempotent) -> image (JPEG) -> OCR (preserves manual edits) -> signature (PNG) -> confirm -> void', async () => {
  const h = await createReceivingHarness();
  const branchUser = { id: 12, name: 'หัวหน้ากะสันกำแพง', role: 'user', branch_id: 1, department_id: 10 };
  const adminUser = { id: 1, name: 'Admin', role: 'admin' };

  // 1. GET /expected
  const expectedRes = await h.invoke('getExpected', {
    user: branchUser,
    query: { date: h.today }
  });
  assert.equal(expectedRes.statusCode, 200);
  assert.equal(expectedRes.body.data.length, 1);
  assert.equal(expectedRes.body.data[0].items.length, 2);

  // 2. POST / (Create draft)
  const createRes1 = await h.invoke('createDocument', {
    user: branchUser,
    body: {
      client_uuid: 'offline-uuid-001',
      delivery_date: h.today,
      kind: 'bill',
      product_group_id: 3,
      order_item_ids: [50, 51]
    }
  });
  assert.equal(createRes1.statusCode, 201);
  const docId = createRes1.body.data.id;

  // จำลองกรณีส่ง client_uuid เดิมพร้อมกัน 2 คำขอจนเกิด ER_DUP_ENTRY ตอน INSERT -> ต้องคืนเอกสารเดิม (HTTP 200)
  h.state.simulateConcurrentDuplicateUuid = true;
  const createRes2 = await h.invoke('createDocument', {
    user: branchUser,
    body: {
      client_uuid: 'offline-uuid-001',
      delivery_date: h.today,
      kind: 'bill'
    }
  });
  assert.equal(createRes2.statusCode, 200);
  assert.equal(createRes2.body.data.id, docId);
  assert.equal(h.state.documents.length, 1);

  // ทดสอบส่ง 2 บรรทัดที่ผูก order_item_id เดียวกัน (50) -> ต้องถูกปฏิเสธด้วย 422 VALIDATION_FAILED (ข้อ 4)
  const duplicateOiPut = await h.invoke('updateDocument', {
    user: branchUser,
    params: { id: String(docId) },
    body: {
      lines: [
        { line_no: 1, bill_text: 'หมู 1', product_id: 7, order_item_id: 50, quantity_received: '5' },
        { line_no: 2, bill_text: 'หมู 2', product_id: 7, order_item_id: 50, quantity_received: '5' }
      ]
    }
  });
  assert.equal(duplicateOiPut.statusCode, 422);
  assert.equal(duplicateOiPut.body.code, 'VALIDATION_FAILED');

  // 3. POST /:id/images (JPEG) + 10. GET /:id/images/:imageId
  const jpegUrl = makeJpegDataUrl(800, 1200);
  const imgRes = await h.invoke('uploadImage', {
    user: branchUser,
    params: { id: String(docId) },
    body: { page_no: 1, image_data_url: jpegUrl }
  });
  assert.equal(imgRes.statusCode, 201);

  const binRes = await h.invoke('getImageBinary', {
    user: branchUser,
    params: { id: String(docId), imageId: String(imgRes.body.data.image_id) }
  });
  assert.equal(binRes.statusCode, 200);
  assert.equal(binRes.headers['content-type'], 'image/jpeg');
  assert.ok(Buffer.isBuffer(binRes.binaryBody));

  // 6. PUT /:id — ผู้ใช้แก้บรรทัดที่ 1 เองก่อนสั่ง OCR
  const firstLineId = createRes1.body.data.lines[0].id;
  const putBeforeOcr = await h.invoke('updateDocument', {
    user: branchUser,
    params: { id: String(docId) },
    body: {
      lines: [
        {
          id: firstLineId,
          line_no: 1,
          bill_text: 'หมูสามชั้น (แก้เอง)',
          product_id: 7,
          product_name: 'หมูสามชั้น',
          order_item_id: 50,
          unit_text: 'กก.',
          unit_id: 2,
          quantity_billed: '9',
          quantity_received: '9.5',
          unit_price: '155.00'
        }
      ]
    }
  });
  assert.equal(putBeforeOcr.statusCode, 200);
  assert.equal(putBeforeOcr.body.data.lines[0].quantity_received, '9.5');

  // 4. POST /:id/ocr
  ocrService.setCustomOcrProvider(async () => ({
    supplier_name: 'ตลาดสดสันกำแพง',
    doc_ref: 'B-2026-099',
    doc_date: h.today,
    subtotal: 1632.5,
    discount: 0,
    vat: 0,
    total: 1632.5,
    confidence: 0.93,
    lines: [
      {
        line_no: 1,
        bill_text: 'หมูสามชั้นจากบิล',
        quantity_billed: 8,
        unit_text: 'กก.',
        unit_price: 150,
        amount: 1200,
        confidence: 0.91
      },
      {
        line_no: 2,
        bill_text: 'ผักกาดขาว',
        quantity_billed: 4,
        unit_text: 'กก.',
        unit_price: 40,
        amount: 160,
        confidence: 0.95
      }
    ]
  }));

  try {
    const ocrRes = await h.invoke('runOcr', {
      user: branchUser,
      params: { id: String(docId) }
    });
    assert.equal(ocrRes.statusCode, 200);
    assert.equal(ocrRes.body.data.doc_ref, 'B-2026-099');
    assert.equal(ocrRes.body.data.total, '1632.50');
    const line1AfterOcr = ocrRes.body.data.lines.find((l) => l.line_no === 1);
    assert.equal(line1AfterOcr.quantity_received, '9.5');
    assert.equal(line1AfterOcr.bill_text, 'หมูสามชั้น (แก้เอง)');
  } finally {
    ocrService.setCustomOcrProvider(null);
  }

  // 7. POST /:id/signatures (PNG)
  const sigRes = await h.invoke('addSignature', {
    user: branchUser,
    params: { id: String(docId) },
    body: {
      role: 'receiver',
      image_data_url: makePngDataUrl(300, 120),
      name: 'หัวหน้ากะสมชาย'
    }
  });
  assert.equal(sigRes.statusCode, 200);
  assert.equal(sigRes.body.data.has_receiver_signature, true);

  // 8. POST /:id/confirm
  const confirmRes = await h.invoke('confirmDocument', {
    user: branchUser,
    params: { id: String(docId) }
  });
  assert.equal(confirmRes.statusCode, 200);
  assert.equal(confirmRes.body.data.status, 'confirmed');
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 14.5);

  // 9. POST /:id/void
  const voidRes = await h.invoke('voidDocument', {
    user: adminUser,
    params: { id: String(docId) },
    body: { reason: 'ลงบิลผิดใบ' }
  });
  assert.equal(voidRes.statusCode, 200);
  assert.equal(voidRes.body.data.status, 'void');
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
});
