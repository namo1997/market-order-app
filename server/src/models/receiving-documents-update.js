import { expandBranchUpdate } from './receiving-branch-policy.js';
import { decisionSnapshot } from './receiving-admin-history.js';
import pool from '../config/database.js';
import { toBangkokDateKey } from '../utils/bangkok-date.js';
import { ensureOrderReceivingColumns } from './order.model.js';
import { ensureReceivingDocumentsTables } from './receiving-documents-schema.js';
import {
  RECEIVING_DOCUMENT_SELECT_COLUMNS,
  assertBlindCountComplete,
  assertDocumentAccess,
  loadDocumentBundleById,
  recalculateAndPersistWarnings,
  recordAuditLog,
  resolveActorScope,
  validateScopedOrderItemsForDocument
} from './receiving-documents-helpers.js';
import {
  MAX_OCR_LINES,
  computeBaseUnitPrice,
  createReceivingError,
  fromSatangInt,
  normalizeBillDate,
  roundQty2,
  toFiniteNumberOrNull,
  toMilliQtyInt,
  toSatangInt,
  validateConfidenceOrNull,
  validateMoneyOrNull,
  validatePositiveIntOrNull,
  validateQuantityOrNull,
  validateUnitMultiplier,
  validateUnitPriceOrNull
} from '../services/receiving-ocr.service.js';

// 6. PUT /:id (แก้ข้อ 7, R2-8, R2-12)
export const updateReceivingDocument = async ({ user, documentId, body = {} } = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();

  const docId = validatePositiveIntOrNull(documentId, 'id');
  if (!docId) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }

  if (Array.isArray(body.lines) && body.lines.length > MAX_OCR_LINES) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      `จำนวนบรรทัดรายการเกินกำหนด (สูงสุด ${MAX_OCR_LINES} รายการ)`
    );
  }

  const scope = await resolveActorScope(pool, user);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [docRows] = await connection.query(
      `SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS} FROM receiving_documents rd WHERE rd.id = ? FOR UPDATE`,
      [docId]
    );
    const doc = docRows?.[0];
    assertDocumentAccess(scope, doc);

    if (doc.status !== 'draft') {
      throw createReceivingError('NOT_DRAFT', 'แก้ไขได้เฉพาะเอกสารที่อยู่ในสถานะร่าง (draft) เท่านั้น');
    }

    assertBlindCountComplete(doc);

    if (doc.receiving_scope === 'branch') {
      const [branchLines] = await connection.query('SELECT * FROM receiving_document_lines WHERE document_id = ? FOR UPDATE', [docId]);
      body = expandBranchUpdate(body, branchLines);
      if (body.supplier_master_id !== undefined || body.product_group_id !== undefined) throw createReceivingError('VALIDATION_FAILED', 'ห้ามเปลี่ยนร้านของใบรับทั้งสาขา');
    }

    const nextKind = body.kind !== undefined ? String(body.kind).trim() : doc.kind;
    if (!['bill', 'manual_receipt'].includes(nextKind)) {
      throw createReceivingError('VALIDATION_FAILED', 'ชนิดเอกสาร (kind) ไม่ถูกต้อง');
    }

    const nextDeliveryDate =
      body.delivery_date !== undefined
        ? normalizeBillDate(body.delivery_date)
        : toBangkokDateKey(doc.delivery_date);
    if (!nextDeliveryDate) {
      throw createReceivingError('VALIDATION_FAILED', 'วันที่รับของ (delivery_date) ไม่ถูกต้อง');
    }

    let nextDocDate = doc.doc_date ? toBangkokDateKey(doc.doc_date) : null;
    if (body.doc_date !== undefined) {
      if (body.doc_date === null || body.doc_date === '') {
        nextDocDate = null;
      } else {
        nextDocDate = normalizeBillDate(body.doc_date);
        if (!nextDocDate) {
          throw createReceivingError('VALIDATION_FAILED', 'วันที่ในบิล (doc_date) ไม่ถูกต้อง');
        }
      }
    }

    const nextSupplierMasterId =
      body.supplier_master_id !== undefined
        ? validatePositiveIntOrNull(body.supplier_master_id, 'supplier_master_id')
        : doc.supplier_master_id;
    const nextProductGroupId =
      body.product_group_id !== undefined
        ? validatePositiveIntOrNull(body.product_group_id, 'product_group_id')
        : doc.product_group_id;

    if (
      body.supplier_name_text !== undefined &&
      String(body.supplier_name_text || '').trim().length > 255
    ) {
      throw createReceivingError(
        'VALIDATION_FAILED',
        'ชื่อซัพพลายเออร์ (supplier_name_text) ยาวเกิน 255 ตัวอักษร'
      );
    }
    const nextSupplierNameText =
      body.supplier_name_text !== undefined
        ? String(body.supplier_name_text || '').trim()
        : String(doc.supplier_name_text || '');

    if (body.doc_ref !== undefined && String(body.doc_ref || '').trim().length > 100) {
      throw createReceivingError('VALIDATION_FAILED', 'เลขที่บิล (doc_ref) ยาวเกิน 100 ตัวอักษร');
    }
    const nextDocRef =
      body.doc_ref !== undefined
        ? body.doc_ref === null || String(body.doc_ref).trim() === ''
          ? null
          : String(body.doc_ref).trim()
        : doc.doc_ref;

    const nextCourierName =
      body.courier_name !== undefined
        ? body.courier_name === null || String(body.courier_name).trim() === ''
          ? null
          : String(body.courier_name).trim().slice(0, 255)
        : doc.courier_name;

    const nextSubtotal =
      body.subtotal !== undefined
        ? validateMoneyOrNull(body.subtotal, 'subtotal')
        : toFiniteNumberOrNull(doc.subtotal);
    const nextDiscount =
      body.discount !== undefined
        ? validateMoneyOrNull(body.discount, 'discount')
        : toFiniteNumberOrNull(doc.discount);
    const nextVat =
      body.vat !== undefined
        ? validateMoneyOrNull(body.vat, 'vat')
        : toFiniteNumberOrNull(doc.vat);
    const nextTotal =
      body.total !== undefined
        ? validateMoneyOrNull(body.total, 'total')
        : toFiniteNumberOrNull(doc.total);

    const headerEdited =
      Boolean(doc.is_header_edited) ||
      body.doc_ref !== undefined ||
      body.doc_date !== undefined ||
      body.subtotal !== undefined ||
      body.discount !== undefined ||
      body.vat !== undefined ||
      body.total !== undefined ||
      body.supplier_name_text !== undefined;

    await connection.query(
      `UPDATE receiving_documents
       SET kind = ?, supplier_master_id = ?, product_group_id = ?, supplier_name_text = ?,
           delivery_date = ?, doc_ref = ?, doc_date = ?, subtotal = ?, discount = ?,
           vat = ?, total = ?, is_header_edited = ?, courier_name = ?
       WHERE id = ?`,
      [
        nextKind,
        nextSupplierMasterId,
        nextProductGroupId,
        nextSupplierNameText,
        nextDeliveryDate,
        nextDocRef,
        nextDocDate,
        nextSubtotal,
        nextDiscount,
        nextVat,
        nextTotal,
        headerEdited,
        nextCourierName,
        docId
      ]
    );

    if (Array.isArray(body.deleted_line_ids) && body.deleted_line_ids.length > 0) {
      const delIds = body.deleted_line_ids
        .map((id) => validatePositiveIntOrNull(id, 'deleted_line_id'))
        .filter(Boolean);
      if (delIds.length > 0) {
        await connection.query(
          `DELETE FROM receiving_document_lines
           WHERE document_id = ? AND id IN (${delIds.map(() => '?').join(', ')})`,
          [docId, ...delIds]
        );
      }
    }

    if (Array.isArray(body.lines)) {
      const [existingLineRows] = await connection.query(
        `SELECT * FROM receiving_document_lines WHERE document_id = ? FOR UPDATE`,
        [docId]
      );
      const existingById = new Map((existingLineRows || []).map((r) => [Number(r.id), r]));

      const normalizedInputLines = body.lines.map((line, idx) => {
        if (!line || typeof line !== 'object') {
          throw createReceivingError('VALIDATION_FAILED', 'ข้อมูลรายการสินค้า (lines) ไม่ถูกต้อง');
        }
        const existing = line.id ? existingById.get(Number(line.id)) : null;
        const productId =
          line.product_id !== undefined
            ? validatePositiveIntOrNull(line.product_id, 'product_id')
            : existing?.product_id ?? null;
        const orderItemId =
          line.order_item_id !== undefined
            ? validatePositiveIntOrNull(line.order_item_id, 'order_item_id')
            : existing?.order_item_id ?? null;
        return { raw: line, existing, idx, product_id: productId, order_item_id: orderItemId };
      });

      // R2-12: ตรวจเพดานจำนวนบรรทัดรวมต่อเอกสาร (ทั้งบรรทัดเดิมที่เหลืออยู่ + บรรทัดที่เพิ่มใหม่)
      const newLinesCount = normalizedInputLines.filter((item) => !item.existing).length;
      if (existingById.size + newLinesCount > MAX_OCR_LINES) {
        throw createReceivingError(
          'VALIDATION_FAILED',
          `จำนวนบรรทัดรวมในเอกสารเกินกำหนด (สูงสุด ${MAX_OCR_LINES} รายการ)`
        );
      }

      // ตรวจ order_item_id รวมทั้งของบรรทัดเดิมที่ไม่ได้ส่งมาใน PUT รอบนี้ เพื่อไม่ให้ผูกซ้ำในเอกสารเดียวกัน
      const touchedExistingIds = new Set(
        normalizedInputLines.filter((item) => item.existing).map((item) => Number(item.existing.id))
      );
      const untouchedExistingLines = (existingLineRows || [])
        .filter((r) => !touchedExistingIds.has(Number(r.id)))
        .map((r) => ({ product_id: r.product_id, order_item_id: r.order_item_id }));

      await validateScopedOrderItemsForDocument(connection, {
        branchId: Number(doc.branch_id),
        departmentId: doc.receiving_scope === 'branch' ? null : Number(doc.department_id),
        lines: [...untouchedExistingLines, ...normalizedInputLines]
      });

      for (const item of normalizedInputLines) {
        const { raw: line, existing, idx, product_id: productId, order_item_id: orderItemId } = item;
        const rawLineNo = line.line_no !== undefined ? Number(line.line_no) : existing?.line_no ?? idx + 1;
        if (!Number.isSafeInteger(rawLineNo) || rawLineNo <= 0 || rawLineNo > MAX_OCR_LINES) {
          throw createReceivingError(
            'VALIDATION_FAILED',
            `เลขลำดับบรรทัด (line_no) ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง ${MAX_OCR_LINES}`
          );
        }
        const lineNo = Math.trunc(rawLineNo);

        const rawBillText =
          line.bill_text !== undefined
            ? String(line.bill_text ?? '').trim()
            : String(existing?.bill_text ?? line.product_name ?? '').trim();
        if (rawBillText.length > 500) {
          throw createReceivingError('VALIDATION_FAILED', 'ข้อความรายการ (bill_text) ยาวเกิน 500 ตัวอักษร');
        }
        const billText = rawBillText;

        let productName =
          line.product_name !== undefined
            ? line.product_name === null
              ? null
              : String(line.product_name).trim().slice(0, 255) || null
            : existing?.product_name ?? null;

        if (productId && !productName) {
          const [pRows] = await connection.query(`SELECT name FROM products WHERE id = ? LIMIT 1`, [
            productId
          ]);
          if (Array.isArray(pRows) && pRows[0]?.name) {
            productName = String(pRows[0].name).slice(0, 255);
          }
        }

        const rawUnitText =
          line.unit_text !== undefined
            ? line.unit_text === null
              ? ''
              : String(line.unit_text).trim()
            : String(existing?.unit_text ?? existing?.unit ?? '').trim();
        if (rawUnitText.length > 100) {
          throw createReceivingError('VALIDATION_FAILED', 'ชื่อหน่วย (unit_text) ยาวเกิน 100 ตัวอักษร');
        }
        const unitText = rawUnitText || null;

        const unitId =
          line.unit_id !== undefined
            ? validatePositiveIntOrNull(line.unit_id, 'unit_id')
            : existing?.unit_id ?? null;

        const qtyBilled =
          line.quantity_billed !== undefined
            ? validateQuantityOrNull(line.quantity_billed, 'quantity_billed', { allowNull: true })
            : roundQty2(existing?.quantity_billed);

        const qtyReceived =
          line.quantity_received !== undefined
            ? validateQuantityOrNull(line.quantity_received, 'quantity_received', { allowNull: false })
            : roundQty2(existing?.quantity_received) ?? 0;

        const unitPrice =
          line.unit_price !== undefined
            ? validateUnitPriceOrNull(line.unit_price, 'unit_price')
            : toFiniteNumberOrNull(existing?.unit_price);

        let amount =
          line.amount !== undefined
            ? validateMoneyOrNull(line.amount, 'amount')
            : toFiniteNumberOrNull(existing?.amount);
        if (amount === null && unitPrice !== null) {
          const baseQty = qtyBilled !== null ? qtyBilled : qtyReceived;
          amount = fromSatangInt(toSatangInt(baseQty * unitPrice));
        }

        // R2-8: validate unit_multiplier และ match.confidence จาก PUT
        const unitMultiplier =
          line.unit_multiplier !== undefined
            ? validateUnitMultiplier(line.unit_multiplier, 'unit_multiplier')
            : validateUnitMultiplier(existing?.unit_multiplier ?? 1, 'unit_multiplier');

        const baseUnitPrice = computeBaseUnitPrice({
          unitPrice,
          amount,
          quantityBilled: qtyBilled,
          quantityReceived: qtyReceived,
          unitMultiplier
        });

        if (line.remember_alias !== undefined && typeof line.remember_alias !== 'boolean') {
          throw createReceivingError('VALIDATION_FAILED', 'remember_alias ต้องเป็น true หรือ false');
        }
        const rememberAlias = line.remember_alias ?? (existing?.remember_alias == null ? false : Boolean(existing.remember_alias));
        const matchSourceCandidate = String(line.match?.source || '').trim();
        const matchSource = ['alias', 'order', 'manual', 'none', 'ai'].includes(matchSourceCandidate)
          ? matchSourceCandidate
          : existing?.match_source || (productId ? 'manual' : 'none');
        const matchConfidence =
          line.match?.confidence !== undefined
            ? validateConfidenceOrNull(line.match.confidence, 'match.confidence')
            : existing?.match_confidence ?? (matchSource === 'manual' ? 1 : null);

        if (existing) {
          const didChange =
            Boolean(existing.is_user_edited) ||
            matchSource !== existing.match_source ||
            rememberAlias !== (existing.remember_alias == null ? false : Boolean(existing.remember_alias)) ||
            billText !== String(existing.bill_text || '') ||
            Number(productId || 0) !== Number(existing.product_id || 0) ||
            Number(orderItemId || 0) !== Number(existing.order_item_id || 0) ||
            toMilliQtyInt(qtyBilled) !== toMilliQtyInt(existing.quantity_billed) ||
            toMilliQtyInt(qtyReceived) !== toMilliQtyInt(existing.quantity_received) ||
            toSatangInt(unitPrice) !== toSatangInt(existing.unit_price) ||
            toSatangInt(amount) !== toSatangInt(existing.amount);

          await connection.query(
            `UPDATE receiving_document_lines
             SET line_no = ?, bill_text = ?, product_id = ?, product_name = ?, order_item_id = ?,
                 unit = ?, unit_text = ?, unit_id = ?, unit_multiplier = ?,
                 quantity_billed = ?, quantity_received = ?, unit_price = ?, base_unit_price = ?,
                 amount = ?, match_source = ?, match_confidence = ?, is_user_edited = ?, remember_alias = ?
             WHERE id = ? AND document_id = ?`,
            [
              lineNo,
              billText,
              productId,
              productName,
              orderItemId,
              unitText,
              unitText,
              unitId,
              unitMultiplier,
              qtyBilled,
              qtyReceived,
              unitPrice,
              baseUnitPrice,
              amount,
              matchSource,
              matchConfidence,
              didChange,
              rememberAlias,
              Number(existing.id),
              docId
            ]
          );
        } else {
          await connection.query(
            `INSERT INTO receiving_document_lines (
               document_id, line_no, bill_text, product_id, product_name,
               order_item_id, unit, unit_text, unit_id, unit_multiplier,
               quantity_billed, quantity_received, unit_price, base_unit_price, amount,
               match_source, match_confidence, is_user_edited, remember_alias
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, ?)`,
            [
              docId,
              lineNo,
              billText,
              productId,
              productName,
              orderItemId,
              unitText,
              unitText,
              unitId,
              unitMultiplier,
              qtyBilled,
              qtyReceived,
              unitPrice,
              baseUnitPrice,
              amount,
              matchSource,
              matchConfidence,
              rememberAlias
            ]
          );
        }
      }
    }

    for (const input of body.lines || []) {
      if (!input.id) {
        const [created] = await connection.query('SELECT * FROM receiving_document_lines WHERE document_id = ? ORDER BY line_no ASC, id ASC', [docId]);
        input.id = created.find(row => Number(row.line_no) === Number(input.line_no) && Number(row.product_id) === Number(input.product_id))?.id;
      }
      if (!input.id) continue;
      if (input.counted_quantity !== undefined || input.counted_at !== undefined || input.counted_by !== undefined) throw createReceivingError('VALIDATION_FAILED', 'ห้ามแก้หลักฐานนับเดิม');
      const decision = input.review_decision ?? null;
      if (decision !== null && !['accept', 'short', 'over', 'wrong_product', 'price_review', 'missing_bill', 'not_received'].includes(decision)) throw createReceivingError('VALIDATION_FAILED', 'การตัดสินใจไม่ถูกต้อง');
      if (decision === 'not_received') {
        const [rows] = await connection.query('SELECT * FROM receiving_document_lines WHERE document_id = ? ORDER BY line_no ASC, id ASC', [docId]);
        const rejected = rows.find(row => Number(row.id) === Number(input.id));
        if (!rejected || Number(rejected.quantity_received) !== 0 || rejected.remember_alias) throw createReceivingError('VALIDATION_FAILED', 'รายการไม่รับต้องมีจำนวนรับ 0 และไม่จำชื่อย่อ');
      }
      const returnStatus = decision === 'not_received' ? input.return_status ?? 'waiting' : null;
      if (returnStatus !== null && !['waiting', 'collected'].includes(returnStatus)) throw createReceivingError('VALIDATION_FAILED', 'สถานะรับคืนไม่ถูกต้อง');
      if (decision !== 'not_received' && input.return_status != null) throw createReceivingError('VALIDATION_FAILED', 'ระบุสถานะรับคืนได้เฉพาะรายการคืนร้าน');
      await connection.query('UPDATE receiving_document_lines SET return_status = ? WHERE id = ? AND document_id = ?', [returnStatus, input.id, docId]);
      await connection.query('UPDATE receiving_document_lines SET review_decision = ? WHERE id = ? AND document_id = ?', [decision, input.id, docId]);
    }
    await connection.query('UPDATE receiving_documents SET receiver_signature = NULL, courier_signature = NULL WHERE id = ?', [docId]);

    const [updatedLines] = await connection.query(
      `SELECT * FROM receiving_document_lines WHERE document_id = ? ORDER BY line_no ASC, id ASC`,
      [docId]
    );

    await recalculateAndPersistWarnings(
      connection,
      {
        ...doc,
        id: docId,
        kind: nextKind,
        supplier_master_id: nextSupplierMasterId,
        product_group_id: nextProductGroupId,
        supplier_name_text: nextSupplierNameText,
        delivery_date: nextDeliveryDate,
        doc_ref: nextDocRef,
        doc_date: nextDocDate,
        subtotal: nextSubtotal,
        discount: nextDiscount,
        vat: nextVat,
        total: nextTotal,
        courier_name: nextCourierName
      },
      updatedLines
    );

    await recordAuditLog(connection, {
      documentId: docId,
      action: 'edit_after_bill_reveal',
      actorUserId: scope.userId,
      actorName: scope.userName,
      details: {
        updated_lines_count: Array.isArray(body.lines) ? body.lines.length : 0,
        decisions: updatedLines.filter(line => (body.lines || []).some(input =>
          Number(input.id) === Number(line.id) && input.review_decision != null)).map(decisionSnapshot),
        deleted_line_ids: body.deleted_line_ids || []
      }
    });

    await connection.commit();
    return loadDocumentBundleById(pool, docId, { includeLines: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
