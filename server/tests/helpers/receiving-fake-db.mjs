import * as branchOcr from '../../src/models/receiving-branch-ocr.js';
import * as branchPolicy from '../../src/models/receiving-branch-policy.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as queuePolicy from '../../src/models/receiving-queue-policy.js';
import * as bangkokDate from '../../src/utils/bangkok-date.js';
import * as issuePolicy from '../../src/models/receiving-issues-policy.js';
import * as ocrService from '../../src/services/receiving-ocr.service.js';
import * as ocrMatcher from '../../src/services/receiving-ocr-matcher.js';
import { LEGACY_FIXTURE_DDL } from '../integration/legacy-receiving-schema.mjs';

// Resolve old test-relative paths from tests/, even though the harness lives in helpers/.
const testsRoot = new URL('../', import.meta.url);
export const read = (relPath) => readFile(new URL(relPath, testsRoot), 'utf8');

// สร้าง PNG data URL ที่ถูกต้องตาม magic bytes และ IHDR (สำหรับลายเซ็น)
export const makePngDataUrl = (width = 2, height = 3, extraPayloadBytes = 0) => {
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
export const makeJpegDataUrl = (width = 640, height = 480, extraPayloadBytes = 0) => {
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

// Shared SQL fake and VM loader. Kept together as requested for R3-2.
export async function createReceivingHarness({ logCalls = [], beforeModuleEvaluate = () => {}, testDate, queueLeads = [], saveQueueFollowup = async () => ({ created: true }), queryHook = () => {}, serializeTransactions = false, prepareCount = true, afterReceivingConfirm = async () => {} } = {}) {
  ocrService.resetOcrRateLimit();
  const today = testDate || bangkokDate.getBangkokDateKey();
  const state = {
    nextDocId: 1,
    nextLineId: 1,
    nextImageId: 1,
    nextTxId: 1,
    nextAliasId: 1,
    nextAliasEventId: 1,
    nextAuditId: 1,
    failOnConfirmStep: false,
    failOnVoidStep: false,
    failAfterOcrVision: false,
    failOnAliasLookupAfterClaim: false,
    simulateMissingTables: false,
    delayBeforeDocInsertMs: 0,
    documents: [],
    lines: [],
    images: [],
    aliases: [],
    aliasEvents: [],
    audits: [],
    departments: [
      { id: 10, branch_id: 1, name: 'ครัวสันกำแพง' },
      { id: 30, branch_id: 1, name: 'สโตร์กลางสันกำแพง' },
      { id: 20, branch_id: 2, name: 'ครัวคำเที่ยง' }
    ],
    inventoryBalances: new Map([
      ['7:10', { product_id: 7, department_id: 10, quantity: 5 }],
      ['8:10', { product_id: 8, department_id: 10, quantity: 0 }],
      ['10:10', { product_id: 10, department_id: 10, quantity: 2 }],
      ['10:30', { product_id: 10, department_id: 30, quantity: 20 }]
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
        receive_notes: null,
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
        receive_notes: null,
        default_price: 40,
        order_date: today,
        order_status: 'submitted',
        branch_id: 1,
        branch_name: 'สาขาสันกำแพง',
        department_id: 10,
        department_name: 'ครัวสันกำแพง'
      },
      {
        id: 52,
        order_id: 3,
        product_id: 10,
        product_name: 'ซอสหอยนางรม (เบิกสโตร์)',
        unit_id: 2,
        unit_name: 'กก.',
        product_group_id: 4,
        product_group_name: 'สโตร์กลางสันกำแพง',
        is_internal: true,
        is_countable: true,
        allow_pending_carryover: false,
        quantity: 3,
        requested_price: 60,
        actual_price: null,
        received_quantity: null,
        is_received: false,
        received_by_user_id: null,
        received_at: null,
        receive_notes: null,
        default_price: 60,
        order_date: today,
        order_status: 'submitted',
        branch_id: 1,
        branch_name: 'สาขาสันกำแพง',
        department_id: 10,
        department_name: 'ครัวสันกำแพง'
      },
      {
        id: 53,
        order_id: 4,
        product_id: 7,
        product_name: 'หมูสามชั้น',
        unit_id: 2,
        unit_name: 'กก.',
        product_group_id: 3,
        product_group_name: 'ตลาดสดสันกำแพง',
        is_internal: false,
        is_countable: true,
        allow_pending_carryover: false,
        quantity: 5,
        requested_price: 150,
        actual_price: null,
        received_quantity: null,
        is_received: false,
        received_by_user_id: null,
        received_at: null,
        receive_notes: null,
        default_price: 150,
        order_date: today,
        order_status: 'cancelled', // ใบสั่งที่ถูกยกเลิก (R2-12)
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
        receive_notes: null,
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
      { id: 9, name: 'น้ำแข็งบด (ไม่นับสต็อก)', default_price: 20, unit_id: 2, is_countable: 0 },
      { id: 10, name: 'ซอสหอยนางรม (เบิกสโตร์)', default_price: 60, unit_id: 2, is_countable: 1 },
      { id: 11, name: 'หมูสันคอ', default_price: 160, unit_id: 2, is_countable: 1 }
    ],
    units: [{ id: 2, name: 'กก.', abbreviation: 'กก.', is_active: true }]
  };

  let snapshot = null;

  const query = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    await queryHook(q, params, state);

    if (state.simulateMissingTables && q.includes('receiving_documents')) {
      const noTableErr = new Error("Table 'market.receiving_documents' doesn't exist");
      noTableErr.code = 'ER_NO_SUCH_TABLE';
      noTableErr.errno = 1146;
      throw noTableErr;
    }

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
      const pgId = Number(params[0]);
      return [[{ name: pgId === 4 ? 'สโตร์กลางสันกำแพง' : 'ตลาดสดสันกำแพง' }]];
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
    if (q.startsWith('SELECT id, name, unit_id FROM products WHERE id = ?')) {
      const product = state.products.find(row => row.id === Number(params[0])); return [[...(product ? [structuredClone(product)] : [])]];
    }
    if (q.startsWith('SELECT id, name, abbreviation FROM units')) {
      // The pilot shares this legacy schema. A permissive SQL mock used to hide
      // the missing is_active column until MySQL returned ER_BAD_FIELD_ERROR.
      const unitsDdl = LEGACY_FIXTURE_DDL.find(ddl => /CREATE TABLE IF NOT EXISTS units\s*\(/.test(ddl));
      if (q.includes('is_active') && !/\bis_active\s+BOOLEAN\b/i.test(unitsDdl)) {
        const error = new Error('Unknown column is_active in pilot units fixture');
        error.code = 'ER_BAD_FIELD_ERROR';
        throw error;
      }
      return [structuredClone(state.units)];
    }

    // Scoped order_items validation query (ข้อ 1 Critical + R2-12 order_status)
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
            product_group_code: oi.is_internal ? 'ST001' : 'SUP001',
            is_internal_group: oi.is_internal ? 1 : 0,
            is_countable: oi.is_countable ? 1 : 0,
            allow_pending_carryover: oi.allow_pending_carryover ? 1 : 0
          }
        ]
      ];
    }

    // updateOrderItemReceivingWithInventory UPDATE order_items (รองรับทั้งกรณี sync quantity และ receive_notes)
    if (q.startsWith('UPDATE order_items SET received_quantity = ?, is_received = ?, received_at = ?, received_by_user_id = ?')) {
      const orderItemId = Number(params.at(-1));
      const oi = state.orderItems.find((item) => item.id === orderItemId);
      if (oi) {
        oi.received_quantity = params[0];
        oi.is_received = Boolean(params[1]);
        oi.received_at = params[2] ? new Date(params[2]).toISOString() : null;
        oi.received_by_user_id = params[3];
        let idx = 4;
        if (q.includes(', quantity = ?')) {
          oi.quantity = params[idx++];
        }
        if (q.includes('receive_notes = ?')) {
          oi.receive_notes = params[idx++];
        }
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

    // Void restore order_items (R2-7: คืนทั้ง quantity และ receive_notes)
    if (q.startsWith('UPDATE order_items SET quantity = COALESCE(?, quantity), received_quantity = ?')) {
      if (state.failOnVoidStep) {
        const dbErr = new Error('Simulated DB error on void');
        dbErr.code = 'ER_LOCK_DEADLOCK';
        throw dbErr;
      }
      const [
        prev_quantity,
        received_quantity,
        actual_price,
        restore_received_flag,
        is_received,
        received_by_user_id,
        received_at,
        receive_notes,
        orderItemId
      ] = params;
      const oi = state.orderItems.find((item) => item.id === Number(orderItemId));
      if (oi) {
        if (prev_quantity !== null && prev_quantity !== undefined) {
          oi.quantity = prev_quantity;
        }
        oi.received_quantity = received_quantity;
        oi.actual_price = actual_price;
        if (restore_received_flag) oi.is_received = Boolean(is_received);
        oi.received_by_user_id = received_by_user_id;
        oi.received_at = received_at;
        oi.receive_notes = receive_notes;
      }
      return [{ affectedRows: 1 }];
    }

    if (q.includes('FROM order_items WHERE id = ? FOR UPDATE') ||
        q.includes('FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ? FOR UPDATE')) {
      const oi = state.orderItems.find((item) => item.id === Number(params[0]));
      return [oi ? [structuredClone(oi)] : []];
    }

    if (q === 'SELECT supplier_key, lead_days FROM receiving_supplier_leads') return [structuredClone(queueLeads)];

    // Expected order_items query
    if (q.includes('FROM order_items oi') && q.includes('JOIN orders o ON o.id = oi.order_id')) {
      let rows = state.orderItems
        .filter((oi) => ['submitted', 'confirmed', 'completed'].includes(oi.order_status))
        .map((oi) => ({
          ...oi,
          order_item_id: oi.id,
          quantity_ordered: oi.quantity <= 0 && oi.received_quantity > 0 ? oi.received_quantity : oi.quantity
        }));
      let pIdx = 0;
      if (q.includes('o.order_date = ?')) {
        const d = params[pIdx++];
        rows = rows.filter((r) => r.order_date === d);
      }
      if (q.includes('o.order_date BETWEEN ? AND ?')) {
        const start = params[pIdx++], end = params[pIdx++];
        rows = rows.filter(r => r.order_date >= start && r.order_date <= end);
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

    // Duplicate bill check with branch_id and supplier filter (ข้อ 13)
    if (q.startsWith('SELECT id FROM receiving_documents WHERE id <> ? AND branch_id = ? AND status <> \'void\'')) {
      const [excludeId, branchId, docRef, total, supplierParam] = params;
      const dup = state.documents.find((d) => {
        if (
          d.id === Number(excludeId) ||
          d.branch_id !== Number(branchId) ||
          d.status === 'void' ||
          String(d.doc_ref || '').trim() !== String(docRef || '').trim() ||
          Math.abs(Number(d.total || 0) - Number(total)) >= 0.01
        ) {
          return false;
        }
        if (q.includes('AND supplier_master_id = ?')) {
          return Number(d.supplier_master_id) === Number(supplierParam);
        }
        if (q.includes('AND product_group_id = ?')) {
          return Number(d.product_group_id) === Number(supplierParam);
        }
        if (q.includes('LOWER(TRIM(supplier_name_text))')) {
          return (
            String(d.supplier_name_text || '').trim().toLowerCase() ===
            String(supplierParam || '').trim().toLowerCase()
          );
        }
        return false;
      });
      return [dup ? [{ id: dup.id }] : []];
    }

    if (q.includes('FROM receiving_documents WHERE client_uuid = ?')) {
      const found = state.documents.find((d) => d.client_uuid === params[0]);
      return [found ? [structuredClone(found)] : []];
    }

    if (q.startsWith('INSERT INTO receiving_documents (')) {
      if (state.delayBeforeDocInsertMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.delayBeforeDocInsertMs));
      }
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

    if (q.startsWith('UPDATE receiving_document_lines SET counted_quantity = ?')) {
      const [quantity, actor, received, lineId, docId] = params;
      const line = state.lines.find(row => row.id === Number(lineId) && row.document_id === Number(docId));
      if (line) Object.assign(line, { counted_quantity: quantity, counted_at: new Date().toISOString(), counted_by: actor, quantity_received: received, remember_alias: false });
      return [{ affectedRows: line ? 1 : 0 }];
    }
    if (q.startsWith('UPDATE receiving_documents SET counted_complete_at')) {
      const doc = state.documents.find(row => row.id === Number(params[1]));
      Object.assign(doc, { counted_complete_at: new Date().toISOString(), count_client_uuid: params[0] }); return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE receiving_document_lines SET return_status = ?')) {
      const line = state.lines.find(row => row.id === Number(params[1]) && row.document_id === Number(params[2]));
      if (line) line.return_status = params[0]; return [{ affectedRows: line ? 1 : 0 }];
    }
    if (q.startsWith('UPDATE receiving_document_lines SET review_decision = ?')) {
      const line = state.lines.find(row => row.id === Number(params[1]) && row.document_id === Number(params[2]));
      if (line) line.review_decision = params[0]; return [{ affectedRows: line ? 1 : 0 }];
    }
    if (q.startsWith('UPDATE receiving_document_lines SET review_decision = NULL')) {
      state.lines.filter(row => row.document_id === Number(params[0])).forEach(row => row.review_decision = null); return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE receiving_documents SET receiver_signature = NULL')) {
      const doc = state.documents.find(row => row.id === Number(params[0]));
      doc.receiver_signature = null; doc.courier_signature = null; return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE receiving_document_lines SET bill_text = ?')) {
      const [bill_text, quantity_billed, unit_price, amount, match_source, match_confidence, lineId, docId] = params;
      const row = state.lines.find(row => row.id === Number(lineId) && row.document_id === Number(docId));
      if (row) Object.assign(row, { bill_text, quantity_billed, unit_price, base_unit_price: null, amount, match_source, match_confidence, review_decision: null }); return [{ affectedRows: row ? 1 : 0 }];
    }
    if (q === 'UPDATE receiving_documents SET receiving_scope = ? WHERE id = ?') {
      state.documents.find(doc => doc.id === Number(params[1])).receiving_scope = params[0];
      return [{ affectedRows: 1 }];
    }
    if (q === 'SELECT id FROM departments WHERE branch_id = ? ORDER BY id LIMIT 1') return [state.departments.filter(dept => dept.branch_id === Number(params[0])).sort((a,b) => a.id-b.id).slice(0,1)];
    if (q === 'UPDATE receiving_document_lines SET branch_weight = ?, branch_department_id = ?, branch_department_name = ? WHERE id = ?') {
      const line = state.lines.find(line => line.id === Number(params[3]));
      Object.assign(line, { branch_weight: params[0], branch_department_id: params[1], branch_department_name: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE receiving_documents SET warnings_json = ?, ocr_warnings_json = ? WHERE id = ?')) {
      const doc = state.documents.find((d) => d.id === Number(params[2]));
      if (doc) {
        doc.warnings_json = params[0];
        doc.ocr_warnings_json = params[1];
      }
      return [{ affectedRows: 1 }];
    }

    // Atomic OCR claim lock with 2-minute stale pending recovery (ข้อ 2, ข้อ 5, R2-3)
    if (q.startsWith('UPDATE receiving_documents SET ocr_status = \'pending\', ocr_attempt_count =')) {
      const doc = state.documents.find((d) => d.id === Number(params[0]));
      if (!doc || doc.status !== 'draft') {
        return [{ affectedRows: 0 }];
      }
      if (doc.ocr_status === 'pending' && doc.ocr_last_requested_at) {
        const lastMs = new Date(doc.ocr_last_requested_at).getTime();
        if (Date.now() - lastMs < 2 * 60 * 1000) {
          return [{ affectedRows: 0 }];
        }
      }
      doc.ocr_status = 'pending';
      doc.ocr_attempt_count = Number(doc.ocr_attempt_count || 0) + 1;
      doc.ocr_last_requested_at = new Date().toISOString();
      return [{ affectedRows: 1 }];
    }

    if (q.startsWith('UPDATE receiving_documents SET ocr_status = \'failed\'')) {
      const doc = state.documents.find((d) => d.id === Number(params[0]));
      if (doc && doc.status === 'draft') doc.ocr_status = 'failed';
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
        ocr_result_json,
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
          ocr_images_hash,
          ocr_result_json
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
      if (state.failOnVoidStep) {
        throw new Error('Simulated DB failure during void status update');
      }
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
      if (q.includes('rd.receiving_scope = ?')) {
        const scope = params[idx++];
        docs = docs.filter(doc => (doc.receiving_scope || 'department') === scope);
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
          prev_order_quantity: null,
          prev_order_received_quantity: null,
          prev_order_actual_price: null,
          prev_order_is_received: null,
          prev_order_received_by_user_id: null,
          prev_order_received_at: null,
          prev_order_receive_notes: null,
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
        match_confidence,
        remember_alias = !q.endsWith('false, false)')
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
        remember_alias: Boolean(remember_alias),
        prev_order_quantity: null,
        prev_order_received_quantity: null,
        prev_order_actual_price: null,
        prev_order_is_received: null,
        prev_order_received_by_user_id: null,
        prev_order_received_at: null,
        prev_order_receive_notes: null,
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
        remember_alias,
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
          remember_alias: Boolean(remember_alias),
          is_user_edited: Boolean(is_user_edited)
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE receiving_document_lines SET prev_order_quantity = ?')) {
      const [
        prev_order_quantity,
        prev_order_received_quantity,
        prev_order_actual_price,
        prev_order_is_received,
        prev_order_received_by_user_id,
        prev_order_received_at,
        prev_order_receive_notes,
        applied_order_received_quantity,
        applied_order_actual_price,
        lineId
      ] = params;
      const line = state.lines.find((l) => l.id === Number(lineId));
      if (line) {
        Object.assign(line, {
          prev_order_quantity,
          prev_order_received_quantity,
          prev_order_actual_price,
          prev_order_is_received,
          prev_order_received_by_user_id,
          prev_order_received_at,
          prev_order_receive_notes,
          applied_order_received_quantity,
          applied_order_actual_price
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE receiving_document_lines SET prev_order_actual_price = CASE')) {
      const [price, prevPrice, autoQty, appliedQty, prevQty, notes, by, at, received, itemId, docId, appliedNote] = params;
      for (const line of state.lines.filter((l) => l.order_item_id === Number(itemId) &&
          l.document_id !== Number(docId) && l.prev_order_receive_notes === appliedNote)) {
        if ((line.prev_order_actual_price == null && price == null) ||
            (line.prev_order_actual_price != null && price != null && Number(line.prev_order_actual_price) === Number(price))) {
          line.prev_order_actual_price = prevPrice;
        }
        if (autoQty && Number(line.prev_order_quantity) === Number(appliedQty)) line.prev_order_quantity = prevQty;
        Object.assign(line, { prev_order_receive_notes: notes, prev_order_received_by_user_id: by,
          prev_order_received_at: at, prev_order_is_received: received });
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT order_item_id FROM receiving_document_lines WHERE document_id = ?')) {
      return [structuredClone(state.lines
        .filter((l) => l.document_id === Number(params[0]) && l.order_item_id != null)
        .sort((a, b) => a.line_no - b.line_no || a.id - b.id)
        .map((l) => ({ order_item_id: l.order_item_id })))];
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

    // R2-2: Aliases & Alias Events queries — พฤติกรรมตรงกับ SQL จริง 100% (ไม่มีตรรกะปลอมใน mock!)
    if (q.includes('FROM supplier_product_aliases spa')) {
      if (state.failOnAliasLookupAfterClaim) {
        throw new Error('Simulated DB failure during alias lookup after OCR claim');
      }
      const supplierKey = params[0];
      const filtered = state.aliases
        .filter((a) => a.supplier_key === supplierKey && (a.confirm_count === undefined || a.confirm_count >= 1))
        .map((a) => {
          const product = state.products.find((p) => Number(p.id) === Number(a.product_id));
          return {
            ...a,
            product_name: product?.name || a.product_name || null,
            product_unit_id: product?.unit_id || null
          };
        });
      filtered.sort((a, b) => {
        const timeDiff = new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
        return timeDiff !== 0 ? timeDiff : (b.id || 0) - (a.id || 0);
      });
      if (q.includes('LIMIT ?') && typeof params[1] === 'number') {
        return [structuredClone(filtered.slice(0, params[1]))];
      }
      return [
        structuredClone(filtered)
      ];
    }
    if (q.startsWith('SELECT id, supplier_key, product_id, unit_id, unit_multiplier, last_unit_price, confirm_count, candidate_product_id, candidate_confirm_count FROM supplier_product_aliases')) {
      const [supplierKey, normBill, normUnit] = params;
      const found = state.aliases.find(
        (a) =>
          a.supplier_key === supplierKey &&
          a.normalized_bill_text === normBill &&
          a.normalized_unit_text === normUnit
      );
      return [found ? [structuredClone(found)] : []];
    }
    if (q.startsWith('INSERT INTO supplier_product_aliases (')) {
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
      const row = {
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
        confirm_count: 1, // ค่าเริ่มต้นตรงกับ SQL VALUES (..., 1, NULL, 0, ?) จริงทุกประการ!
        candidate_product_id: null,
        candidate_confirm_count: 0,
        updated_by_user_id,
        created_at: new Date(),
        updated_at: new Date()
      };
      state.aliases.push(row);
      return [{ insertId: row.id, affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE supplier_product_aliases SET unit_id = ?, unit_multiplier = ?, last_unit_price = ?, confirm_count = ?, candidate_product_id = NULL, candidate_confirm_count = 0, updated_by_user_id = ? WHERE id = ?')) {
      const [unit_id, unit_multiplier, last_unit_price, confirm_count, updated_by_user_id, id] = params;
      const row = state.aliases.find((a) => a.id === Number(id));
      if (row) {
        Object.assign(row, {
          unit_id,
          unit_multiplier: Number(unit_multiplier || 1),
          last_unit_price,
          confirm_count: Number(confirm_count),
          candidate_product_id: null,
          candidate_confirm_count: 0,
          updated_by_user_id
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE supplier_product_aliases SET product_id = ?, unit_id = ?, unit_multiplier = ?, last_unit_price = ?, confirm_count = 1, candidate_product_id = NULL, candidate_confirm_count = 0, updated_by_user_id = ? WHERE id = ?')) {
      const [product_id, unit_id, unit_multiplier, last_unit_price, updated_by_user_id, id] = params;
      const row = state.aliases.find((a) => a.id === Number(id));
      if (row) {
        Object.assign(row, {
          product_id: Number(product_id),
          unit_id,
          unit_multiplier: Number(unit_multiplier || 1),
          last_unit_price,
          confirm_count: 1,
          candidate_product_id: null,
          candidate_confirm_count: 0,
          updated_by_user_id
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE supplier_product_aliases SET product_id = ?, unit_id = ?, unit_multiplier = ?, last_unit_price = ?, confirm_count = ?, candidate_product_id = NULL, candidate_confirm_count = 0, updated_by_user_id = ? WHERE id = ?')) {
      const [product_id, unit_id, unit_multiplier, last_unit_price, confirm_count, updated_by_user_id, id] = params;
      const row = state.aliases.find((a) => a.id === Number(id));
      if (row) {
        Object.assign(row, {
          product_id: Number(product_id),
          unit_id,
          unit_multiplier: Number(unit_multiplier || 1),
          last_unit_price,
          confirm_count: Number(confirm_count),
          candidate_product_id: null,
          candidate_confirm_count: 0,
          updated_by_user_id
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE supplier_product_aliases SET candidate_product_id = ?, candidate_confirm_count = ?, updated_by_user_id = ? WHERE id = ?')) {
      const [candidate_product_id, candidate_confirm_count, updated_by_user_id, id] = params;
      const row = state.aliases.find((a) => a.id === Number(id));
      if (row) {
        Object.assign(row, {
          candidate_product_id: Number(candidate_product_id),
          candidate_confirm_count: Number(candidate_confirm_count),
          updated_by_user_id
        });
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT actor_user_id, branch_id, proposed_product_id FROM supplier_product_alias_events')) {
      const aliasId = Number(params[0]);
      return [
        structuredClone(
          state.aliasEvents.filter(
            (ev) => ev.alias_id === aliasId && ev.decision === 'candidate_recorded'
          )
        )
      ];
    }
    if (q.startsWith('INSERT INTO supplier_product_alias_events (')) {
      const decisionMatch = q.match(/'(created|confirmed_same|admin_override|candidate_recorded|candidate_promoted)'\)$/);
      const decision = decisionMatch ? decisionMatch[1] : 'created';
      const isCreated = decision === 'created';
      const ev = isCreated
        ? {
            id: state.nextAliasEventId++,
            alias_id: Number(params[0]),
            document_id: Number(params[1]),
            supplier_key: params[2],
            normalized_bill_text: params[3],
            normalized_unit_text: params[4],
            previous_product_id: null,
            proposed_product_id: Number(params[5]),
            applied_product_id: Number(params[6]),
            unit_id: params[7],
            unit_multiplier: Number(params[8]),
            unit_price: params[9],
            actor_user_id: params[10] ? Number(params[10]) : null,
            actor_role: params[11],
            branch_id: params[12] ? Number(params[12]) : null,
            department_id: params[13] ? Number(params[13]) : null,
            decision
          }
        : {
            id: state.nextAliasEventId++,
            alias_id: Number(params[0]),
            document_id: Number(params[1]),
            supplier_key: params[2],
            normalized_bill_text: params[3],
            normalized_unit_text: params[4],
            previous_product_id: params[5] ? Number(params[5]) : null,
            proposed_product_id: Number(params[6]),
            applied_product_id: Number(params[7]),
            unit_id: params[8],
            unit_multiplier: Number(params[9]),
            unit_price: params[10],
            actor_user_id: params[11] ? Number(params[11]) : null,
            actor_role: params[12],
            branch_id: params[13] ? Number(params[13]) : null,
            department_id: params[14] ? Number(params[14]) : null,
            decision
          };
      state.aliasEvents.push(ev);
      return [{ insertId: ev.id, affectedRows: 1 }];
    }



    // Inventory balance & transactions (รองรับทั้งรับปกติและโอนคลังภายใน transfer_out / transfer_in)
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
      if (state.failOnOcrAudit && params[1] === 'ocr') throw new Error('Simulated late OCR audit failure');
      if (state.failOnConfirmAudit && params[1] === 'confirm') throw new Error('Simulated late confirm audit failure');
      if (state.failOnVoidAudit && params[1] === 'void') throw new Error('Simulated late void audit failure');
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
        aliasEvents: state.aliasEvents,
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
        state.aliasEvents = snapshot.aliasEvents;
        state.audits = snapshot.audits;
        state.orderItems = snapshot.orderItems;
        state.inventoryTransactions = snapshot.inventoryTransactions;
        state.inventoryBalances = new Map(snapshot.inventoryBalances);
      }
    },
    release() {}
  };

  // Optional transactional adapter models lock serialization for race regressions.
  // It does not replace the separate MySQL integration acceptance gate.
  let transactionTail = Promise.resolve();
  const getConnection = async () => {
    if (!serializeTransactions) return connection;
    let unlock;
    return { ...connection,
      async beginTransaction() {
        const previous = transactionTail;
        transactionTail = new Promise(resolve => { unlock = resolve; });
        await previous;
        await connection.beginTransaction();
      },
      async commit() { await connection.commit(); unlock(); },
      async rollback() { await connection.rollback(); unlock?.(); },
    };
  };

  const context = vm.createContext({
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logCalls.push([level, ...args])])),
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
    SyntaxError,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    setTimeout,
    clearTimeout,
    process: { env: {} }
  });

  // Node 23 can collect a linked SyntheticModule wrapper before evaluation and
  // crash in SyntheticModuleEvaluationStepsCallback. Retain every wrapper until
  // the entire graph has evaluated (including dependencies created by link()).
  const syntheticModules = [];
  const synthetic = (exportsObj) => {
    const module = new vm.SyntheticModule(
      Object.keys(exportsObj),
      function () {
        for (const [k, v] of Object.entries(exportsObj)) {
          this.setExport(k, v);
        }
      },
      { context }
    );
    syntheticModules.push(module);
    return module;
  };

  // โหลด order.model.js จริง เพื่อให้ confirm/void เรียก updateOrderItemReceivingWithInventory ของจริงรวมถึงโอนคลังภายใน!
  const orderInputMod = await import('../../src/utils/order-input.js');
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
  const exceptionsMod = new vm.SourceTextModule(await read('../src/models/receiving-documents-exceptions.js'), { context });
  const settlementMod = new vm.SourceTextModule(
    await read('../src/models/receiving-documents-settlement.js'),
    { context }
  );
  const signaturesMod = new vm.SourceTextModule(
    await read('../src/models/receiving-documents-signatures.js'),
    { context }
  );
  const aliasMod = new vm.SourceTextModule(
    await read('../src/models/receiving-documents-alias.js'),
    { context }
  );
  const updateMod = new vm.SourceTextModule(
    await read('../src/models/receiving-documents-update.js'),
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
      if (specifier.endsWith('/receiving-issues-policy.js')) return synthetic(issuePolicy);
      if (specifier.endsWith('/receiving-issues-followup.js')) return synthetic({ afterReceivingConfirm });
      if (specifier === 'node:crypto') return synthetic({ default: crypto, ...crypto });
      if (specifier.endsWith('/database.js')) {
        return synthetic({ default: { query, getConnection } });
      }
      if (specifier.endsWith('/receiving-branch-ocr.js')) return synthetic(branchOcr);
      if (specifier.endsWith('/receiving-branch-policy.js')) return synthetic(branchPolicy);
      if (specifier.endsWith('/receiving-queue-policy.js')) return synthetic(queuePolicy);
      if (specifier.endsWith('/receiving-queue-schema.js')) return synthetic({ ensureQueueTables: async () => {} });
      if (specifier.endsWith('/receiving-followups-store.js')) return synthetic({ saveFollowup: (_db, args) => saveQueueFollowup(args) });
      if (specifier.endsWith('/bangkok-date.js')) return synthetic(testDate ? { ...bangkokDate, getBangkokDateKey: () => testDate } : bangkokDate);
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
          // ข้อ 3: รองรับการโอนคลังภายในเมื่อ productGroupId === 4 (สโตร์กลางสันกำแพง แผนก 30)
          getMappedSourceDepartmentByProductGroup: async ({ productGroupId }) =>
            Number(productGroupId) === 4
              ? {
                  product_group_id: 4,
                  source_department_id: 30,
                  source_department_name: 'สโตร์กลางสันกำแพง',
                  is_internal: 1
                }
              : null
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
      if (specifier.endsWith('/receiving-documents-exceptions.js')) return exceptionsMod;
      if (specifier.endsWith('/receiving-documents-settlement.js')) return settlementMod;
      if (specifier.endsWith('/receiving-documents-signatures.js')) return signaturesMod;
      if (specifier.endsWith('/receiving-documents-alias.js')) return aliasMod;
      if (specifier.endsWith('/receiving-documents-update.js')) return updateMod;
      if (specifier.endsWith('/receiving-documents.model.js')) return modelMod;
      throw new Error(`Unexpected specifier: ${specifier}`);
    });
  };

  for (const m of [
    orderModelMod,
    helpersMod,
    aliasMod,
    ocrFlowMod,
    updateMod,
    exceptionsMod,
    settlementMod,
    signaturesMod,
    modelMod,
    controllerMod
  ]) {
    if (m.status === 'unlinked') {
      await linkAll(m);
    }
    if (m.status === 'linked') {
      await beforeModuleEvaluate();
      await m.evaluate();
    }
  }
  for (const module of syntheticModules) {
    assert.equal(module.status, 'evaluated', 'Synthetic dependencies must remain alive through evaluation');
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
    if (prepareCount && !['createDocument', 'saveCount', 'getExpected', 'listDocuments', 'getDocumentById', 'voidDocument'].includes(handlerName)) {
      const doc = state.documents.find(row => row.id === Number(params.id));
      if (doc?.status === 'draft' && !doc.counted_complete_at) {
        const rows = state.lines.filter(row => row.document_id === doc.id);
        const inputs = rows.length ? (doc.receiving_scope === 'branch' ? branchPolicy.aggregateBranchLines(rows) : rows).map(row => ({ id: row.id, counted_quantity: row.quantity_received }))
          : (Array.isArray(body.lines) && body.lines.length ? body.lines.filter(line => line && line.product_id).map(line => ({ product_id: line.product_id, counted_quantity: line.quantity_received ?? 0, unit_text: line.unit_text })) : [{ product_id: 7, counted_quantity: 0 }]);
        if (inputs.length) {
          const prepared = await invoke('saveCount', { user, params, body: { client_uuid: doc.client_uuid, lines: inputs } });
          if (prepared.statusCode === 200 && !rows.length && Array.isArray(body.lines)) body = { ...body, lines: body.lines.map((line, i) => line && !line.id ? { ...line, id: prepared.body.data.lines[i]?.id } : line) };
        }
      }
      if (handlerName === 'addSignature' && doc?.counted_complete_at && doc.status === 'draft') {
        const rows = state.lines.filter(line => line.document_id === doc.id);
        const grouped = doc.receiving_scope === 'branch' ? branchPolicy.aggregateBranchLines(rows) : rows;
        const undecided = grouped.filter(line => !line.review_decision);
        if (undecided.length) await invoke('updateDocument', { user, params, body: { lines: undecided.map(line => ({ id: line.id, review_decision: 'accept', remember_alias: true })) } });
      }
    }
    if (prepareCount && handlerName === 'updateDocument' && Array.isArray(body.lines)) body = { ...body, lines: body.lines.map(line => line && typeof line === 'object' ? { ...line, remember_alias: line.remember_alias ?? state.lines.find(row => row.id === Number(line.id))?.remember_alias ?? true, review_decision: line.review_decision ?? 'accept' } : line) };
    await controllerMod.namespace[handlerName](
      { user, params, query: qParams, body },
      res,
      (err) => {
        if (err) throw err;
      }
    );
    if (prepareCount && handlerName === 'createDocument' && statusCode < 300 && jsonBody?.data?.blind && jsonBody.data.lines?.length) {
      const id = String(jsonBody.data.id);
      const physical = state.lines.filter(line => line.document_id === Number(id));
      const grouped = jsonBody.data.scope === 'branch' ? branchPolicy.aggregateBranchLines(physical) : physical;
      const counted = await invoke('saveCount', { user, params: { id }, body: { client_uuid: jsonBody.data.client_uuid,
        lines: grouped.map(line => ({ id: line.id, counted_quantity: line.quantity_received })) } });
      assert.equal(counted.statusCode, 200, 'legacy fixture must pass real blind count before exercising downstream behavior');
      jsonBody.data = counted.body.data;
    }
    return { statusCode, body: jsonBody, binaryBody, headers };
  };

  const invokeErrorMiddleware = (err, req = {}) => {
    let statusCode = 200;
    let jsonBody;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        jsonBody = payload;
        return this;
      }
    };
    controllerMod.namespace.handleReceivingError(err, res, () => {}, req);
    return { statusCode, body: jsonBody };
  };

  return { state, invoke, invokeErrorMiddleware, today, pool: { query, getConnection: async () => connection } };
}

export const readyDeltaBill = async (h, user, uuid, qty, price = '10.00', item = 50) => {
  const created = await h.invoke('createDocument', { user, body: {
    client_uuid: uuid, delivery_date: h.today, kind: 'bill', order_item_ids: item ? [item] : []
  } });
  assert.equal(created.statusCode, 201);
  const id = String(created.body.data.id);
  const changed = await h.invoke('updateDocument', { user, params: { id }, body: { lines: [{
    id: created.body.data.lines[0]?.id, line_no: 1, bill_text: uuid, product_id: item === 52 ? 10 : 7,
    order_item_id: item, quantity_received: qty, unit_price: price
  }] } });
  assert.equal(changed.statusCode, 200);
  assert.equal((await h.invoke('addSignature', { user, params: { id },
    body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  return id;
};
export const deltaActor = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };

export const settlementRows = state => structuredClone({
  documents: state.documents, lines: state.lines, orderItems: state.orderItems,
  balances: state.inventoryBalances, transactions: state.inventoryTransactions,
  aliases: state.aliases, aliasEvents: state.aliasEvents, audits: state.audits
});

// Shared draft setup for the cases that used to share the concurrent-create scenario.
export const createLinkedDraft = (h, user, client_uuid) => h.invoke('createDocument', {
  user,
  body: { client_uuid, delivery_date: h.today, kind: 'bill', product_group_id: 3, order_item_ids: [50] }
});
