import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import * as bangkokDate from '../src/utils/bangkok-date.js';
import * as ocrService from '../src/services/receiving-ocr.service.js';

const read = (relPath) => readFile(new URL(relPath, import.meta.url), 'utf8');

// Helper: สร้าง 1x1 PNG data URL ที่ถูกต้องตาม magic bytes และ IHDR
const makePngDataUrl = (width = 2, height = 3, extraPayloadBytes = 0) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type
  const crc = Buffer.alloc(4);
  const pad = extraPayloadBytes > 0 ? Buffer.alloc(extraPayloadBytes, 0x41) : Buffer.alloc(0);
  const buffer = Buffer.concat([signature, ihdrLength, ihdrType, ihdrData, crc, pad]);
  return `data:image/png;base64,${buffer.toString('base64')}`;
};

// ============================================================================
// 1. ทดสอบ Schema (หัวข้อ 2: ฐานข้อมูล additive)
// ============================================================================
test('receiving-documents-schema defines all additive tables and columns', async () => {
  const executedQueries = [];
  const mockDb = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      executedQueries.push({ sql: normalized, params });
      if (normalized.startsWith('SHOW COLUMNS')) {
        return [[]]; // จำลองว่ายังไม่มีคอลัมน์เสริมเพื่อทดสอบ ALTER TABLE
      }
      return [{ affectedRows: 1 }];
    }
  };

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
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_documents.includes('lbc_capture_id'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_documents.includes('client_uuid'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_document_lines.includes('quantity_billed'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.receiving_document_images.includes('sha256'));
  assert.ok(RECEIVING_DOCUMENT_TABLES_DDL.supplier_product_aliases.includes('unit_multiplier'));

  await ensureReceivingDocumentsTables(mockDb);
  assert.ok(
    executedQueries.some((q) =>
      q.sql.includes('CREATE TABLE IF NOT EXISTS receiving_documents')
    )
  );
  assert.ok(
    executedQueries.some((q) =>
      q.sql.includes('CREATE TABLE IF NOT EXISTS receiving_document_lines')
    )
  );
  assert.ok(
    executedQueries.some((q) =>
      q.sql.includes('CREATE TABLE IF NOT EXISTS receiving_document_images')
    )
  );
  assert.ok(
    executedQueries.some((q) =>
      q.sql.includes('CREATE TABLE IF NOT EXISTS supplier_product_aliases')
    )
  );
  assert.ok(
    executedQueries.some((q) =>
      q.sql.includes('ALTER TABLE order_items ADD COLUMN actual_price')
    )
  );
});

// ============================================================================
// 2. ทดสอบการอ่านบิล, การจับคู่สินค้า/alias และ Warning Codes (หัวข้อ 3)
// ============================================================================
test('OCR vision service parses Thai Buddhist dates, line items, and handles unavailable API', async () => {
  await assert.rejects(
    ocrService.extractBillWithVision({
      images: [{ page_no: 1, image_data_url: makePngDataUrl() }],
      apiKey: ''
    }),
    (err) => err.code === 'OCR_UNAVAILABLE' && err.statusCode === 503
  );

  let capturedRequest = null;
  const mockFetch = async (url, options) => {
    capturedRequest = { url, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          model: 'gpt-4o-mini-2026',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  supplier_name: 'ร้านเจ๊พรหมูสด',
                  doc_ref: 'INV-3970',
                  doc_date: '14/10/2569',
                  subtotal: '1,200.00',
                  discount: '0',
                  vat: '0.00',
                  total: '1,200.00',
                  confidence: 0.94,
                  lines: [
                    {
                      line_no: 1,
                      bill_text: 'สามชั้นสไลด์',
                      quantity_billed: '2',
                      unit_text: 'ลัง',
                      unit_price: '600',
                      confidence: 0.96
                    }
                  ]
                })
              }
            }
          ]
        };
      }
    };
  };

  const result = await ocrService.extractBillWithVision({
    images: [
      { page_no: 2, image_data_url: makePngDataUrl(10, 20) },
      { page_no: 1, image_data_url: makePngDataUrl(5, 8) }
    ],
    apiKey: 'fake-test-key',
    fetchImpl: mockFetch
  });

  assert.equal(capturedRequest.body.messages[1].content.length, 3); // 1 prompt + 2 sorted pages
  assert.equal(result.supplier_name, 'ร้านเจ๊พรหมูสด');
  assert.equal(result.doc_ref, 'INV-3970');
  assert.equal(result.doc_date, '2026-10-14'); // แปลง พ.ศ. 2569 -> 2026
  assert.equal(result.total, 1200);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].amount, 1200); // คำนวณ 2 * 600 อัตโนมัติ
});

test('parseImageDataUrl validates mime, extracts dimensions/sha256, and rejects >3MB with IMAGE_TOO_LARGE', () => {
  const validPng = makePngDataUrl(640, 480);
  const parsed = ocrService.parseImageDataUrl(validPng);
  assert.equal(parsed.mimeType, 'image/png');
  assert.equal(parsed.width, 640);
  assert.equal(parsed.height, 480);
  assert.equal(parsed.sha256.length, 64);

  const oversizedPng = makePngDataUrl(10, 10, 3 * 1024 * 1024 + 500);
  assert.throws(
    () => ocrService.parseImageDataUrl(oversizedPng),
    (err) => err.code === 'IMAGE_TOO_LARGE' && err.statusCode === 413
  );
});

test('matchOcrLinesToCatalog matches alias with unit_multiplier, order items, and leaves unknown lines unmatched', () => {
  const ocrLines = [
    {
      line_no: 1,
      bill_text: 'นมข้นหวาน คาร์เนชั่น',
      quantity_billed: 2,
      unit_text: 'ลัง',
      unit_price: 1200,
      amount: 2400,
      confidence: 0.95
    },
    {
      line_no: 2,
      bill_text: 'หมูสามชั้น',
      quantity_billed: 5,
      unit_text: 'กก.',
      unit_price: 180,
      amount: 900,
      confidence: 0.92
    },
    {
      line_no: 3,
      bill_text: 'สินค้าแปลกใหม่ไม่มีในระบบ',
      quantity_billed: 1,
      unit_text: 'ถุง',
      unit_price: 50,
      amount: 50,
      confidence: 0.6
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
      quantity_ordered: 24
    },
    {
      order_item_id: 502,
      product_id: 202,
      product_name: 'หมูสามชั้นหั่น',
      unit_id: 20,
      unit_name: 'กก.',
      quantity_ordered: 5
    }
  ];

  const matched = ocrService.matchOcrLinesToCatalog({
    ocrLines,
    aliases,
    expectedItems,
    supplierKey: 'pg:3'
  });

  // บรรทัด 1: จับคู่จาก alias พร้อมคูณหน่วย 2 ลัง * 12 = 24 กระป๋อง และผูกใบสั่ง 501
  assert.equal(matched[0].match.source, 'alias');
  assert.equal(matched[0].product_id, 101);
  assert.equal(matched[0].order_item_id, 501);
  assert.equal(matched[0].quantity_billed, 2);
  assert.equal(matched[0].quantity_received, 24);

  // บรรทัด 2: จับคู่จากใบสั่งวันนี้ (order_item_id 502)
  assert.equal(matched[1].match.source, 'order');
  assert.equal(matched[1].product_id, 202);
  assert.equal(matched[1].order_item_id, 502);
  assert.equal(matched[1].quantity_received, 5);

  // บรรทัด 3: ไม่พบสินค้า
  assert.equal(matched[2].match.source, 'none');
  assert.equal(matched[2].product_id, null);
});

test('computeDocumentWarnings detects all 7 warning codes accurately', () => {
  const expectedItemsById = new Map([
    [501, { order_item_id: 501, quantity_ordered: 10 }],
    [502, { order_item_id: 502, quantity_ordered: 5 }]
  ]);
  const latestPricesByProductId = new Map([
    [101, 100], // ราคาใหม่ 130 -> +30% (>15% PRICE_CHANGE)
    [202, 200]
  ]);

  const { warnings, warningCodes } = ocrService.computeDocumentWarnings({
    document: {
      subtotal: 2000,
      discount: 0,
      vat: 0,
      total: 2500, // ต่างจากผลรวมบรรทัด (8*130 + 6*200 + 50 = 2290) เกิน 1 บาท -> SUM_MISMATCH
      ocr_confidence: 0.65 // < 0.75 -> LOW_CONFIDENCE
    },
    lines: [
      {
        line_no: 1,
        product_id: 101,
        order_item_id: 501,
        quantity_billed: 8,
        quantity_received: 8, // น้อยกว่าที่สั่ง 10 -> QTY_SHORT
        unit_price: 130, // > 100 เกิน 15% -> PRICE_CHANGE
        amount: 1040,
        match_confidence: 0.95
      },
      {
        line_no: 2,
        product_id: 202,
        order_item_id: 502,
        quantity_billed: 6,
        quantity_received: 6, // มากกว่าที่สั่ง 5 -> QTY_OVER
        unit_price: 200,
        amount: 1200,
        match_confidence: 0.55 // < 0.75 -> LOW_CONFIDENCE
      },
      {
        line_no: 3,
        product_id: null, // -> UNMATCHED_LINE
        order_item_id: null,
        quantity_billed: 1,
        quantity_received: 1,
        unit_price: 50,
        amount: 50,
        match_confidence: null
      }
    ],
    expectedItemsById,
    latestPricesByProductId,
    isDuplicateBill: true // -> DUPLICATE_BILL
  });

  for (const expectedCode of [
    'SUM_MISMATCH',
    'PRICE_CHANGE',
    'QTY_SHORT',
    'QTY_OVER',
    'UNMATCHED_LINE',
    'DUPLICATE_BILL',
    'LOW_CONFIDENCE'
  ]) {
    assert.ok(
      warningCodes.includes(expectedCode),
      `Expected warning code ${expectedCode} in ${JSON.stringify(warningCodes)}`
    );
  }
  assert.ok(warnings.some((w) => w.code === 'PRICE_CHANGE' && w.line_no === 1));
  assert.ok(warnings.some((w) => w.code === 'QTY_SHORT' && w.line_no === 1));
  assert.ok(warnings.some((w) => w.code === 'QTY_OVER' && w.line_no === 2));
  assert.ok(warnings.some((w) => w.code === 'UNMATCHED_LINE' && w.line_no === 3));
});

// ============================================================================
// 3. ทดสอบครบทั้ง 10 API Endpoints + Confirm/Void Transactions ด้วย Mock DB
// ============================================================================
async function createReceivingHarness() {
  const today = bangkokDate.getBangkokDateKey();
  const state = {
    nextDocId: 1,
    nextLineId: 1,
    nextImageId: 1,
    nextTxId: 1,
    nextAliasId: 1,
    nextAuditId: 1,
    documents: [],
    lines: [],
    images: [],
    aliases: [],
    audits: [],
    inventoryBalances: new Map([['7:10', { product_id: 7, department_id: 10, quantity: 5 }]]),
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
        department_id: 10
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
        department_id: 10
      }
    ],
    products: [
      { id: 7, name: 'หมูสามชั้น', default_price: 150, unit_id: 2 },
      { id: 8, name: 'ผักกาดขาว', default_price: 40, unit_id: 2 }
    ],
    units: [{ id: 2, name: 'กก.', abbreviation: 'กก.', is_active: true }]
  };

  let snapshot = null;

  const query = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('CREATE TABLE') || q.startsWith('ALTER TABLE')) {
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SHOW COLUMNS')) {
      return [[{ Field: 'exists' }]];
    }
    if (q.startsWith('SELECT u.id, u.name, u.department_id, d.branch_id FROM users u')) {
      const uid = Number(params[0]);
      return [[{ id: uid, name: `User-${uid}`, department_id: 10, branch_id: 1 }]];
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
    if (q.startsWith('SELECT id, name, abbreviation FROM units')) {
      return [structuredClone(state.units)];
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

    // Latest reference prices query
    if (q.includes('AS ref_price FROM products p WHERE p.id IN')) {
      const ids = new Set(params.map(Number));
      const rows = state.products
        .filter((p) => ids.has(p.id))
        .map((p) => ({ product_id: p.id, ref_price: p.default_price }));
      return [rows];
    }

    // Duplicate bill check
    if (q.startsWith('SELECT id FROM receiving_documents WHERE id <> ? AND status <> \'void\'')) {
      const [excludeId, docRef, total] = params;
      const dup = state.documents.find(
        (d) =>
          d.id !== Number(excludeId) &&
          d.status !== 'void' &&
          d.doc_ref === docRef &&
          Math.abs(Number(d.total || 0) - Number(total)) < 0.01
      );
      return [dup ? [{ id: dup.id }] : []];
    }

    // Check existing by client_uuid
    if (q.startsWith('SELECT id, branch_id, department_id FROM receiving_documents WHERE client_uuid = ?')) {
      const found = state.documents.find((d) => d.client_uuid === params[0]);
      return [found ? [structuredClone(found)] : []];
    }

    // Insert receiving_documents
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
        ocr_status: 'none',
        ocr_model: null,
        ocr_confidence: null,
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

    // Update warnings_json
    if (q.startsWith('UPDATE receiving_documents SET warnings_json = ?, ocr_warnings_json = ? WHERE id = ?')) {
      const doc = state.documents.find((d) => d.id === Number(params[2]));
      if (doc) {
        doc.warnings_json = params[0];
        doc.ocr_warnings_json = params[1];
      }
      return [{ affectedRows: 1 }];
    }

    // Update ocr_status
    if (q.startsWith('UPDATE receiving_documents SET ocr_status = \'pending\' WHERE id = ?')) {
      const doc = state.documents.find((d) => d.id === Number(params[0]));
      if (doc) doc.ocr_status = 'pending';
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE receiving_documents SET ocr_status = \'failed\' WHERE id = ?')) {
      const doc = state.documents.find((d) => d.id === Number(params[0]));
      if (doc) doc.ocr_status = 'failed';
      return [{ affectedRows: 1 }];
    }

    // Update receiving_documents from OCR
    if (q.startsWith('UPDATE receiving_documents SET supplier_name_text = ?, doc_ref = ?')) {
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
          ocr_confidence
        });
      }
      return [{ affectedRows: 1 }];
    }

    // Update receiving_documents from PUT /:id
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
          courier_name
        });
      }
      return [{ affectedRows: 1 }];
    }

    // Update signatures
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

    // Confirm status update
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

    // Void status update
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

    // Select receiving_documents by id
    if (q.includes('FROM receiving_documents') && q.includes('WHERE rd.id = ?') || q.includes('FROM receiving_documents WHERE id = ?')) {
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

    // List receiving_documents
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

    // Images queries
    if (q.startsWith('SELECT id FROM receiving_document_images WHERE document_id = ? AND page_no = ?')) {
      const [docId, pageNo] = params.map(Number);
      const img = state.images.find((i) => i.document_id === docId && i.page_no === pageNo);
      return [img ? [{ id: img.id }] : []];
    }
    if (q.startsWith('INSERT INTO receiving_document_images')) {
      const [document_id, page_no, mime_type, width, height, size_bytes, sha256, image_data] = params;
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
      return [{ insertId: img.id }];
    }
    if (q.startsWith('UPDATE receiving_document_images')) {
      const [mime_type, width, height, size_bytes, sha256, image_data, id] = params;
      const img = state.images.find((i) => i.id === Number(id));
      if (img) {
        Object.assign(img, { mime_type, width, height, size_bytes, sha256, image_data });
      }
      return [{ affectedRows: 1 }];
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
        quantity_billed,
        quantity_received,
        unit_price,
        amount,
        match_source: isOrderDefault ? 'order' : match_source,
        match_confidence: isOrderDefault ? 1 : match_confidence,
        is_user_edited: isUserEditedTrue,
        prev_order_received_quantity: null,
        prev_order_actual_price: null,
        prev_order_is_received: null,
        prev_order_received_by_user_id: null,
        prev_order_received_at: null
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
        quantity_billed,
        quantity_received,
        unit_price,
        amount,
        match_source,
        match_confidence,
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
          quantity_billed,
          quantity_received,
          unit_price,
          amount,
          match_source,
          match_confidence,
          is_user_edited: true
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
        lineId
      ] = params;
      const line = state.lines.find((l) => l.id === Number(lineId));
      if (line) {
        Object.assign(line, {
          prev_order_received_quantity,
          prev_order_actual_price,
          prev_order_is_received,
          prev_order_received_by_user_id,
          prev_order_received_at
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

    // Aliases queries
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
        updated_by_user_id
      ] = params;
      const existing = state.aliases.find(
        (a) =>
          a.supplier_key === supplier_key &&
          a.normalized_bill_text === normalized_bill_text &&
          a.normalized_unit_text === normalized_unit_text
      );
      if (existing) {
        existing.product_id = Number(product_id);
        existing.unit_id = unit_id ?? existing.unit_id;
        existing.last_unit_price = last_unit_price ?? existing.last_unit_price;
        existing.confirm_count += 1;
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
          confirm_count: 1,
          updated_by_user_id
        });
      }
      return [{ affectedRows: 1 }];
    }

    // Order items lock & update during confirm/void
    if (q.includes('FROM order_items WHERE id = ? FOR UPDATE')) {
      const oi = state.orderItems.find((item) => item.id === Number(params[0]));
      return [oi ? [structuredClone(oi)] : []];
    }
    if (q.startsWith('UPDATE order_items SET received_quantity = ?, actual_price = ?, is_received = true')) {
      const [received_quantity, actual_price, received_by_user_id, orderItemId] = params;
      const oi = state.orderItems.find((item) => item.id === Number(orderItemId));
      if (oi) {
        oi.received_quantity = received_quantity;
        oi.actual_price = actual_price;
        oi.is_received = true;
        oi.received_by_user_id = received_by_user_id;
        oi.received_at = new Date().toISOString();
      }
      return [{ affectedRows: 1 }];
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

    // Inventory balance & transactions
    if (q.startsWith('SELECT quantity FROM inventory_balance WHERE product_id = ? AND department_id = ? FOR UPDATE')) {
      const key = `${Number(params[0])}:${Number(params[1])}`;
      const bal = state.inventoryBalances.get(key);
      return [bal ? [{ quantity: bal.quantity }] : []];
    }
    if (q.startsWith('INSERT INTO inventory_transactions')) {
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

    // Audit log
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
    console,
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

  const modelMod = new vm.SourceTextModule(
    await read('../src/models/receiving-documents.model.js'),
    { context }
  );
  const controllerMod = new vm.SourceTextModule(
    await read('../src/controllers/receiving-documents.controller.js'),
    { context }
  );

  const linkAll = async (mod) => {
    await mod.link((specifier) => {
      if (specifier === 'node:crypto') return synthetic({ default: crypto, ...crypto });
      if (specifier.endsWith('/database.js')) {
        return synthetic({ default: { query, getConnection: async () => connection } });
      }
      if (specifier.endsWith('/bangkok-date.js')) return synthetic(bangkokDate);
      if (specifier.endsWith('/inventory.model.js')) {
        return synthetic({ ensureInventoryTables: async () => {} });
      }
      if (specifier.endsWith('/order.model.js')) {
        return synthetic({ ensureOrderReceivingColumns: async () => {} });
      }
      if (specifier.endsWith('/receiving-documents-schema.js')) {
        return synthetic({ ensureReceivingDocumentsTables: async () => {} });
      }
      if (specifier.endsWith('/receiving-ocr.service.js')) {
        return synthetic(ocrService);
      }
      if (specifier.endsWith('/receiving-documents.model.js')) {
        return modelMod;
      }
      throw new Error(`Unexpected specifier: ${specifier}`);
    });
  };

  await linkAll(modelMod);
  await modelMod.evaluate();
  await linkAll(controllerMod);
  await controllerMod.evaluate();

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

  return { state, invoke, today };
}

test('full receiving-documents flow: expected -> create (idempotent) -> image -> OCR (preserves manual edits) -> signature -> confirm -> void', async () => {
  const h = await createReceivingHarness();
  const branchUser = { id: 12, name: 'หัวหน้ากะสันกำแพง', role: 'user', branch_id: 1, department_id: 10 };
  const otherDeptUser = { id: 99, name: 'พนักงานแผนกอื่น', role: 'user', branch_id: 1, department_id: 22 };
  const adminUser = { id: 1, name: 'Admin', role: 'admin' };

  // 1. GET /expected
  const expectedRes = await h.invoke('getExpected', {
    user: branchUser,
    query: { date: h.today }
  });
  assert.equal(expectedRes.statusCode, 200);
  assert.equal(expectedRes.body.success, true);
  assert.equal(expectedRes.body.data.length, 1);
  assert.equal(expectedRes.body.data[0].supplier_key, 'pg:3');
  assert.equal(expectedRes.body.data[0].items.length, 2);
  assert.equal(expectedRes.body.data[0].items[0].quantity_ordered, '10');
  assert.equal(expectedRes.body.data[0].items[0].received_quantity, null);

  // 2. POST / (Create draft + idempotent check with same client_uuid)
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
  assert.equal(createRes1.body.success, true);
  const docId = createRes1.body.data.id;
  assert.equal(createRes1.body.data.lines.length, 2);
  assert.equal(createRes1.body.data.lines[0].unit_price, '150.00');
  assert.equal(createRes1.body.data.lines[0].quantity_received, '10');

  // ส่ง client_uuid ซ้ำ ต้องได้เอกสารเดิม (HTTP 200) ไม่สร้างซ้ำ
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

  // ผู้ใช้คนละแผนกต้องโดน 403 FORBIDDEN
  const forbiddenGet = await h.invoke('getDocumentById', {
    user: otherDeptUser,
    params: { id: String(docId) }
  });
  assert.equal(forbiddenGet.statusCode, 403);
  assert.equal(forbiddenGet.body.code, 'FORBIDDEN');

  // 3. POST /:id/images + 10. GET /:id/images/:imageId
  const pngUrl = makePngDataUrl(800, 1200);
  const imgRes = await h.invoke('uploadImage', {
    user: branchUser,
    params: { id: String(docId) },
    body: { page_no: 1, image_data_url: pngUrl }
  });
  assert.equal(imgRes.statusCode, 201);
  assert.equal(typeof imgRes.body.data.image_id, 'number');

  const binRes = await h.invoke('getImageBinary', {
    user: branchUser,
    params: { id: String(docId), imageId: String(imgRes.body.data.image_id) }
  });
  assert.equal(binRes.statusCode, 200);
  assert.equal(binRes.headers['content-type'], 'image/png');
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

  // 4. POST /:id/ocr — ต้องเติม header + บรรทัดจาก OCR แต่ไม่ทับบรรทัดที่ 1 ที่ผู้ใช้แก้เองแล้ว
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
    assert.equal(ocrRes.body.data.ocr.status, 'done');
    // บรรทัดที่ 1 ต้องยังคงเป็นค่าที่ผู้ใช้แก้เอง ('9.5') ไม่ถูกทับเป็น 8
    const line1AfterOcr = ocrRes.body.data.lines.find((l) => l.line_no === 1);
    assert.equal(line1AfterOcr.quantity_received, '9.5');
    assert.equal(line1AfterOcr.bill_text, 'หมูสามชั้น (แก้เอง)');
    // บรรทัดที่ 2 มาจาก OCR และจับคู่กับ order_item_id 51
    const line2AfterOcr = ocrRes.body.data.lines.find((l) => l.line_no === 2);
    assert.equal(line2AfterOcr.product_id, 8);
    assert.equal(line2AfterOcr.order_item_id, 51);
    assert.equal(line2AfterOcr.quantity_received, '4');
  } finally {
    ocrService.setCustomOcrProvider(null);
  }

  // 5. GET /?date=&status= (รายการต้องไม่มี lines)
  const listRes = await h.invoke('listDocuments', {
    user: branchUser,
    query: { date: h.today, status: 'draft' }
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.data.length, 1);
  assert.equal(listRes.body.data[0].lines, undefined);

  // 8. POST /:id/confirm ก่อนเซ็นรับ ต้องได้ 422 SIGNATURE_REQUIRED
  const confirmWithoutSig = await h.invoke('confirmDocument', {
    user: branchUser,
    params: { id: String(docId) }
  });
  assert.equal(confirmWithoutSig.statusCode, 422);
  assert.equal(confirmWithoutSig.body.code, 'SIGNATURE_REQUIRED');

  // 7. POST /:id/signatures — เซ็นรับทั้ง receiver และ courier
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
  assert.equal(sigRes.body.data.receiver_name, 'หัวหน้ากะสมชาย');

  // 8. POST /:id/confirm สำเร็จใน transaction เดียว
  const confirmRes = await h.invoke('confirmDocument', {
    user: branchUser,
    params: { id: String(docId) }
  });
  assert.equal(confirmRes.statusCode, 200);
  assert.equal(confirmRes.body.data.status, 'confirmed');
  assert.ok(confirmRes.body.data.confirmed_at);

  // ตรวจสอบว่า order_items อัปเดตแล้ว
  const oi50 = h.state.orderItems.find((i) => i.id === 50);
  assert.equal(oi50.received_quantity, 9.5);
  assert.equal(oi50.actual_price, 155);
  assert.equal(oi50.is_received, true);

  // ตรวจสอบว่า inventory_transactions เพิ่มรายการ type 'receive' และอัปเดตยอดคงเหลือ (5 + 9.5 = 14.5)
  assert.equal(h.state.inventoryTransactions.length, 2);
  assert.equal(h.state.inventoryTransactions[0].transaction_type, 'receive');
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 14.5);

  // ตรวจสอบว่าเรียนรู้ supplier_product_aliases แล้ว
  assert.ok(h.state.aliases.some((a) => a.product_id === 7));
  assert.ok(h.state.aliases.some((a) => a.product_id === 8));

  // แก้ไขเอกสารที่ confirmed แล้วต้องได้ 409 NOT_DRAFT
  const putAfterConfirm = await h.invoke('updateDocument', {
    user: branchUser,
    params: { id: String(docId) },
    body: { doc_ref: 'CHANGED' }
  });
  assert.equal(putAfterConfirm.statusCode, 409);
  assert.equal(putAfterConfirm.body.code, 'NOT_DRAFT');

  // 9. POST /:id/void — ย้อนค่า order_items และสต็อกกลับสู่ค่าเดิม
  const voidRes = await h.invoke('voidDocument', {
    user: adminUser,
    params: { id: String(docId) },
    body: { reason: 'ลงบิลผิดใบ' }
  });
  assert.equal(voidRes.statusCode, 200);
  assert.equal(voidRes.body.data.status, 'void');

  const oi50AfterVoid = h.state.orderItems.find((i) => i.id === 50);
  assert.equal(oi50AfterVoid.received_quantity, null);
  assert.equal(oi50AfterVoid.actual_price, null);
  assert.equal(oi50AfterVoid.is_received, false);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
  assert.equal(h.state.inventoryTransactions.length, 4); // 2 receive + 2 reverse adjustment
});
