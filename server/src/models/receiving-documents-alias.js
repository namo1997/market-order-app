export const ALIAS_OVERRIDE_MIN_DISTINCT_USERS = 3;

// R2-2: ย้ายการตัดสินใจเรียนรู้ supplier_product_aliases มาอยู่ใน JS ภายใต้ SELECT ... FOR UPDATE
// ห้ามเรียนรู้เมื่อ supplierKey === 'none', บันทึกประวัติลง supplier_product_alias_events
// และเปลี่ยน product_id ได้เฉพาะ Admin หรือเมื่อมีผู้ใช้ต่างกันอย่างน้อย 3 คนยืนยันตรงกัน
export const learnSupplierProductAliasInJs = async (
  connection,
  {
    docId,
    doc,
    supplierKey,
    cleanBillText,
    normalizedBillText,
    cleanUnitText,
    normalizedUnitText,
    productId,
    unitId,
    learnedMultiplier,
    lastPrice,
    scope
  }
) => {
  if (!supplierKey || supplierKey === 'none') {
    return;
  }

  const actorUserId = scope.userId || Number(doc.receiver_user_id) || null;
  const actorRole = scope.isAdmin ? 'admin' : 'user';
  const branchId = Number(doc.branch_id) || null;
  const departmentId = Number(doc.department_id) || null;

  const [existingRows] = await connection.query(
    `SELECT id, supplier_key, product_id, unit_id, unit_multiplier, last_unit_price,
            confirm_count, candidate_product_id, candidate_confirm_count
     FROM supplier_product_aliases
     WHERE supplier_key = ?
       AND normalized_bill_text = ?
       AND normalized_unit_text = ?
     FOR UPDATE`,
    [supplierKey, normalizedBillText, normalizedUnitText]
  );

  const existing = existingRows?.[0] || null;

  if (!existing) {
    const [insRes] = await connection.query(
      `INSERT INTO supplier_product_aliases (
         supplier_key, supplier_master_id, product_group_id, supplier_name_text,
         bill_text, normalized_bill_text, unit_text, normalized_unit_text,
         product_id, unit_id, unit_multiplier, last_unit_price,
         confirm_count, candidate_product_id, candidate_confirm_count, updated_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 0, ?)`,
      [
        supplierKey,
        doc.supplier_master_id ?? null,
        doc.product_group_id ?? null,
        doc.supplier_name_text || null,
        cleanBillText.slice(0, 255),
        normalizedBillText.slice(0, 255),
        cleanUnitText.slice(0, 100),
        normalizedUnitText.slice(0, 100),
        productId,
        unitId,
        learnedMultiplier,
        lastPrice,
        actorUserId
      ]
    );

    await connection.query(
      `INSERT INTO supplier_product_alias_events (
         alias_id, document_id, supplier_key, normalized_bill_text, normalized_unit_text,
         previous_product_id, proposed_product_id, applied_product_id,
         unit_id, unit_multiplier, unit_price, actor_user_id, actor_role,
         branch_id, department_id, decision
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created')`,
      [
        Number(insRes.insertId),
        docId,
        supplierKey,
        normalizedBillText.slice(0, 255),
        normalizedUnitText.slice(0, 100),
        productId,
        productId,
        unitId,
        learnedMultiplier,
        lastPrice,
        actorUserId,
        actorRole,
        branchId,
        departmentId
      ]
    );
    return;
  }

  const aliasId = Number(existing.id);
  const currentProductId = Number(existing.product_id);

  if (currentProductId === Number(productId)) {
    const nextConfirmCount = Number(existing.confirm_count || 1) + 1;
    const nextUnitId = unitId ?? existing.unit_id ?? null;
    const nextPrice = lastPrice ?? existing.last_unit_price ?? null;

    await connection.query(
      `UPDATE supplier_product_aliases
       SET unit_id = ?,
           unit_multiplier = ?,
           last_unit_price = ?,
           confirm_count = ?,
           candidate_product_id = NULL,
           candidate_confirm_count = 0,
           updated_by_user_id = ?
       WHERE id = ?`,
      [nextUnitId, learnedMultiplier, nextPrice, nextConfirmCount, actorUserId, aliasId]
    );

    await connection.query(
      `INSERT INTO supplier_product_alias_events (
         alias_id, document_id, supplier_key, normalized_bill_text, normalized_unit_text,
         previous_product_id, proposed_product_id, applied_product_id,
         unit_id, unit_multiplier, unit_price, actor_user_id, actor_role,
         branch_id, department_id, decision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed_same')`,
      [
        aliasId,
        docId,
        supplierKey,
        normalizedBillText.slice(0, 255),
        normalizedUnitText.slice(0, 100),
        currentProductId,
        productId,
        productId,
        nextUnitId,
        learnedMultiplier,
        nextPrice,
        actorUserId,
        actorRole,
        branchId,
        departmentId
      ]
    );
    return;
  }

  if (scope.isAdmin) {
    const nextUnitId = unitId ?? existing.unit_id ?? null;
    const nextPrice = lastPrice ?? existing.last_unit_price ?? null;

    await connection.query(
      `UPDATE supplier_product_aliases
       SET product_id = ?,
           unit_id = ?,
           unit_multiplier = ?,
           last_unit_price = ?,
           confirm_count = 1,
           candidate_product_id = NULL,
           candidate_confirm_count = 0,
           updated_by_user_id = ?
       WHERE id = ?`,
      [productId, nextUnitId, learnedMultiplier, nextPrice, actorUserId, aliasId]
    );

    await connection.query(
      `INSERT INTO supplier_product_alias_events (
         alias_id, document_id, supplier_key, normalized_bill_text, normalized_unit_text,
         previous_product_id, proposed_product_id, applied_product_id,
         unit_id, unit_multiplier, unit_price, actor_user_id, actor_role,
         branch_id, department_id, decision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin_override')`,
      [
        aliasId,
        docId,
        supplierKey,
        normalizedBillText.slice(0, 255),
        normalizedUnitText.slice(0, 100),
        currentProductId,
        productId,
        productId,
        nextUnitId,
        learnedMultiplier,
        nextPrice,
        actorUserId,
        actorRole,
        branchId,
        departmentId
      ]
    );
    return;
  }

  const distinctUserIds = new Set();
  if (actorUserId) distinctUserIds.add(Number(actorUserId));

  if (Number(existing.candidate_product_id) === Number(productId)) {
    const [eventRows] = await connection.query(
      `SELECT actor_user_id, branch_id, proposed_product_id
       FROM supplier_product_alias_events
       WHERE alias_id = ?
         AND decision = 'candidate_recorded'
       ORDER BY id ASC`,
      [aliasId]
    );
    for (const ev of eventRows || []) {
      if (Number(ev.proposed_product_id) === Number(productId) && ev.actor_user_id) {
        distinctUserIds.add(Number(ev.actor_user_id));
      }
    }
  }

  const candidateCount = Math.max(1, distinctUserIds.size);

  if (candidateCount >= ALIAS_OVERRIDE_MIN_DISTINCT_USERS) {
    const nextUnitId = unitId ?? existing.unit_id ?? null;
    const nextPrice = lastPrice ?? existing.last_unit_price ?? null;

    await connection.query(
      `UPDATE supplier_product_aliases
       SET product_id = ?,
           unit_id = ?,
           unit_multiplier = ?,
           last_unit_price = ?,
           confirm_count = ?,
           candidate_product_id = NULL,
           candidate_confirm_count = 0,
           updated_by_user_id = ?
       WHERE id = ?`,
      [productId, nextUnitId, learnedMultiplier, nextPrice, candidateCount, actorUserId, aliasId]
    );

    await connection.query(
      `INSERT INTO supplier_product_alias_events (
         alias_id, document_id, supplier_key, normalized_bill_text, normalized_unit_text,
         previous_product_id, proposed_product_id, applied_product_id,
         unit_id, unit_multiplier, unit_price, actor_user_id, actor_role,
         branch_id, department_id, decision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate_promoted')`,
      [
        aliasId,
        docId,
        supplierKey,
        normalizedBillText.slice(0, 255),
        normalizedUnitText.slice(0, 100),
        currentProductId,
        productId,
        productId,
        nextUnitId,
        learnedMultiplier,
        nextPrice,
        actorUserId,
        actorRole,
        branchId,
        departmentId
      ]
    );
  } else {
    await connection.query(
      `UPDATE supplier_product_aliases
       SET candidate_product_id = ?,
           candidate_confirm_count = ?,
           updated_by_user_id = ?
       WHERE id = ?`,
      [productId, candidateCount, actorUserId, aliasId]
    );

    await connection.query(
      `INSERT INTO supplier_product_alias_events (
         alias_id, document_id, supplier_key, normalized_bill_text, normalized_unit_text,
         previous_product_id, proposed_product_id, applied_product_id,
         unit_id, unit_multiplier, unit_price, actor_user_id, actor_role,
         branch_id, department_id, decision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate_recorded')`,
      [
        aliasId,
        docId,
        supplierKey,
        normalizedBillText.slice(0, 255),
        normalizedUnitText.slice(0, 100),
        currentProductId,
        productId,
        currentProductId,
        unitId ?? existing.unit_id ?? null,
        learnedMultiplier,
        lastPrice ?? existing.last_unit_price ?? null,
        actorUserId,
        actorRole,
        branchId,
        departmentId
      ]
    );
  }
};
