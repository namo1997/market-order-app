import test from 'node:test';
import assert from 'node:assert/strict';
import { makePngDataUrl, createReceivingHarness, readyDeltaBill, deltaActor, settlementRows } from './helpers/receiving-fake-db.mjs';

test("Internal transfer reversal is atomic", async (t) => {
  const h = await createReceivingHarness();
  const user = { id: 12, name: 'UserA', role: 'user', branch_id: 1, department_id: 10 };
  let internalDocId;
  await t.test("Internal transfer confirms both inventory legs and syncs zero ordered quantity", async () => {
    // 2) ทดสอบข้อ 3 (Internal Transfer) และ R2-7 (คืนค่า quantity และ receive_notes เดิมเมื่อ void) + Rollback ของ void
    // ตั้งให้ order_item 52 (เบิกสโตร์กลาง แผนก 30 -> ครัว แผนก 10) มี quantity เดิม = 0 และ receive_notes เดิม = 'หมายเหตุสโตร์เดิม'
    const oi52 = h.state.orderItems.find((i) => i.id === 52);
    oi52.quantity = 0;
    oi52.receive_notes = 'หมายเหตุสโตร์เดิม';

    const internalDoc = await h.invoke('createDocument', {
      user,
      body: {
        client_uuid: 'internal-transfer-doc',
        delivery_date: h.today,
        kind: 'bill',
        product_group_id: 4,
        order_item_ids: [52]
      }
    });
    internalDocId = String(internalDoc.body.data.id);
    await h.invoke('updateDocument', {
      user,
      params: { id: internalDocId },
      body: {
        lines: [
          {
            id: internalDoc.body.data.lines[0].id,
            line_no: 1,
            bill_text: 'ซอสหอยนางรม (เบิกสโตร์)',
            product_id: 10,
            order_item_id: 52,
            quantity_received: '3',
            unit_price: '60.00'
          }
        ]
      }
    });
    await h.invoke('addSignature', {
      user,
      params: { id: internalDocId },
      body: { role: 'receiver', image_data_url: makePngDataUrl() }
    });
    const confirmInternal = await h.invoke('confirmDocument', {
      user,
      params: { id: internalDocId }
    });
    assert.equal(confirmInternal.statusCode, 200);

    // สต็อกสโตร์กลาง (10:30) ต้องถูกตัดจ่าย -3 (จาก 20 เหลือ 17) และครัว (10:10) รับเข้า +3 (จาก 2 เป็น 5)
    assert.equal(h.state.inventoryBalances.get('10:30').quantity, 17);
    assert.equal(h.state.inventoryBalances.get('10:10').quantity, 5);
    assert.ok(h.state.inventoryTransactions.some((t) => t.transaction_type === 'transfer_out' && t.department_id === 30));
    assert.ok(h.state.inventoryTransactions.some((t) => t.transaction_type === 'transfer_in' && t.department_id === 10));
    // เมื่อ quantity เดิมเป็น 0 ระบบรับของจะ sync quantity = 3 และเปลี่ยน receive_notes
    assert.equal(h.state.orderItems.find((i) => i.id === 52).quantity, 3);
    assert.equal(h.state.orderItems.find((i) => i.id === 52).received_quantity, 3);
    assert.match(h.state.orderItems.find((i) => i.id === 52).receive_notes, /รับสินค้าตามเอกสาร/);
  });
  await t.test("Mid-void failure rolls back order and both transfer inventories", async () => {
    // ทดสอบ Rollback ของ void: หากเกิด Error กลางคันระหว่าง void ต้องไม่มีอะไรเปลี่ยน!
    h.state.failOnVoidStep = true;
    const failedVoid = await h.invoke('voidDocument', {
      user,
      params: { id: internalDocId },
      body: { reason: 'ทดสอบ rollback ตอน void' }
    });
    assert.equal(failedVoid.statusCode, 500, JSON.stringify(failedVoid.body));
    assert.equal(h.state.documents.find((d) => d.id === Number(internalDocId)).status, 'confirmed');
    assert.equal(h.state.inventoryBalances.get('10:30').quantity, 17);
    assert.equal(h.state.inventoryBalances.get('10:10').quantity, 5);
    assert.equal(h.state.orderItems.find((i) => i.id === 52).received_quantity, 3);
    h.state.failOnVoidStep = false;
  });
  await t.test("Successful void restores both transfer balances, original quantity and notes", async () => {
    // กด void สำเร็จ -> สต็อกโอนกลับ (10:30 กลับเป็น 20, 10:10 กลับเป็น 2) และคืนค่า quantity = 0 กับ receive_notes = 'หมายเหตุสโตร์เดิม' (R2-7)
    const okVoid = await h.invoke('voidDocument', {
      user,
      params: { id: internalDocId },
      body: { reason: 'ยกเลิกใบเบิกสโตร์' }
    });
    assert.equal(okVoid.statusCode, 200);
    assert.equal(h.state.inventoryBalances.get('10:30').quantity, 20);
    assert.equal(h.state.inventoryBalances.get('10:10').quantity, 2);
    const restoredOi52 = h.state.orderItems.find((i) => i.id === 52);
    assert.equal(restoredOi52.received_quantity, null);
    assert.equal(restoredOi52.quantity, 0);
    assert.equal(restoredOi52.receive_notes, 'หมายเหตุสโตร์เดิม');
  });
});

for (const order of [[0, 1], [1, 0]]) {
  test(`delta void 2.25 + 3.50, order ${order.join(',')}, exact inventory, successor metadata and manual edits`, async () => {
    const h = await createReceivingHarness();
    const initial = structuredClone(h.state.orderItems.find(i => i.id === 50));
    const ids = [await readyDeltaBill(h, deltaActor, 'delta-1', '2.25'),
      await readyDeltaBill(h, deltaActor, 'delta-2', '3.50', '12.00')];
    assert.equal(h.state.orderItems.find(i => i.id === 50).received_quantity, 5.75);
    const firstVoid = await h.invoke('voidDocument', { user: deltaActor, params: { id: ids[order[0]] }, body: { reason: 'delta' } });
    assert.equal(firstVoid.statusCode, 200);
    const remaining = order[0] === 0 ? 3.5 : 2.25;
    const current = h.state.orderItems.find(i => i.id === 50);
    assert.equal(current.received_quantity, remaining);
    assert.equal(current.actual_price, null); // policy 11b: confirm leaves actual_price untouched
    assert.equal(current.receive_notes, `รับสินค้าตามเอกสาร #${ids[order[1]]}`);
    assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5 + remaining);
    // Independent edits are preserved on the final reversal, while quantities still subtract exactly.
    current.actual_price = 19.123456;
    current.receive_notes = 'manual newer note';
    current.quantity = 23;
    assert.equal((await h.invoke('voidDocument', { user: deltaActor, params: { id: ids[order[1]] }, body: { reason: 'delta final' } })).statusCode, 200);
    const final = h.state.orderItems.find(i => i.id === 50);
    assert.equal(Number(final.received_quantity), 0);
    assert.equal(final.actual_price, 19.123456);
    assert.equal(final.receive_notes, 'manual newer note');
    assert.equal(final.quantity, 23);
    assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
    assert.equal(initial.quantity, 10);
  });
}

for (const failure of ['received-underflow', 'cancelled']) {
  test(`delta void rejects ${failure} atomically`, async () => {
    const h = await createReceivingHarness();
    const item = 50;
    const id = await readyDeltaBill(h, deltaActor, `delta-${failure}`, '2.25', '10.00', item);
    const current = h.state.orderItems.find(i => i.id === item);
    if (failure === 'received-underflow') current.received_quantity = 2;
    if (failure === 'cancelled') current.order_status = 'cancelled';
    const before = structuredClone(h.state);
    const result = await h.invoke('voidDocument', { user: deltaActor, params: { id }, body: { reason: 'underflow probe' } });
    assert.equal(result.statusCode, 409, JSON.stringify(result.body));
    assert.equal(result.body.code, 'NOT_DRAFT');
    assert.deepEqual(h.state, before);
  });
}

for (const mode of ['linked', 'unlinked', 'transfer-target', 'transfer-source']) {
  test(`R2 void permits negative inventory ${mode}, persists warning/audit, rolls back late failure and refuses repeat`, async () => {
    const h = await createReceivingHarness();
    const item = mode === 'unlinked' ? null : mode.startsWith('transfer') ? 52 : 50;
    const id = await readyDeltaBill(h, deltaActor, `negative-${mode}`, '2.25', '10.00', item);
    const key = mode === 'transfer-source' ? '10:30' : mode === 'transfer-target' ? '10:10' : '7:10';
    h.state.inventoryBalances.get(key).quantity = mode === 'transfer-source' ? -3 : 2;
    const originalTransactions = h.state.inventoryTransactions.length;
    const before = settlementRows(h.state);
    h.state.failOnVoidAudit = true;
    const failed = await h.invoke('voidDocument', { user: deltaActor, params: { id }, body: { reason: 'late failure' } });
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.body.code, 'INTERNAL_ERROR');
    assert.deepEqual(settlementRows(h.state), before, 'warnings/status/order/ledger/aliases/audit must all roll back');
    h.state.failOnVoidAudit = false;
    const result = await h.invoke('voidDocument', { user: deltaActor, params: { id }, body: { reason: 'allow negative' } });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.status, 'void');
    assert.equal(h.state.inventoryBalances.get(key).quantity, mode === 'transfer-source' ? -0.75 : -0.25);
    const warnings = result.body.data.warnings.filter(w => w.code === 'INVENTORY_NEGATIVE_AFTER_VOID');
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].line_no, null);
    const previousDoc = before.documents.find(d => d.id === Number(id));
    assert.deepEqual(result.body.data.warnings.slice(0, -1), JSON.parse(previousDoc.warnings_json || '[]'));
    assert.deepEqual(result.body.data.ocr.warnings, JSON.parse(previousDoc.ocr_warnings_json || '[]'));
    const audit = h.state.audits.find(a => a.action === 'void' && a.document_id === Number(id));
    assert.deepEqual(audit.details.warnings, ['INVENTORY_NEGATIVE_AFTER_VOID']);
    const reversal = h.state.inventoryTransactions.slice(originalTransactions);
    assert.equal(reversal.length, mode.startsWith('transfer') ? 2 : 1);
    const negativeTx = reversal.find(tx => `${tx.product_id}:${tx.department_id}` === key);
    assert.equal(negativeTx.quantity, mode === 'transfer-source' ? 2.25 : -2.25);
    assert.equal(negativeTx.balance_before, mode === 'transfer-source' ? -3 : 2);
    assert.equal(negativeTx.balance_after, mode === 'transfer-source' ? -0.75 : -0.25);
    if (item) assert.equal(Number(h.state.orderItems.find(i => i.id === item).received_quantity), 0);
    const reread = await h.invoke('getDocumentById', { user: deltaActor, params: { id } });
    assert.deepEqual(reread.body.data.warnings, result.body.data.warnings);
    const listed = await h.invoke('listDocuments', { user: deltaActor });
    assert.deepEqual(listed.body.data.find(d => d.id === Number(id)).warnings, result.body.data.warnings);
    const voided = settlementRows(h.state);
    const repeated = await h.invoke('voidDocument', { user: deltaActor, params: { id }, body: { reason: 'repeat' } });
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.body.code, 'NOT_DRAFT');
    assert.deepEqual(settlementRows(h.state), voided);
  });
}

test('R2 void without a negative affected balance emits no inventory warning', async () => {
  const h = await createReceivingHarness();
  const id = await readyDeltaBill(h, deltaActor, 'non-negative-void', '0.30', '10.00');
  h.state.inventoryBalances.get('7:10').quantity = 0.3;
  const result = await h.invoke('voidDocument', { user: deltaActor, params: { id }, body: { reason: 'zero balance' } });
  assert.equal(result.statusCode, 200);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 0);
  assert.ok(!result.body.data.warnings.some(w => w.code === 'INVENTORY_NEGATIVE_AFTER_VOID'));
  assert.deepEqual(h.state.audits.find(a => a.action === 'void').details.warnings, []);
});
