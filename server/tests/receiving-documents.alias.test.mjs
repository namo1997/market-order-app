import test from 'node:test';
import assert from 'node:assert/strict';
import { makePngDataUrl, createReceivingHarness } from './helpers/receiving-fake-db.mjs';

test("Alias learning requires distinct users or admin and records decisions", async (t) => {
  const h = await createReceivingHarness();
  const user1 = { id: 12, name: 'User1', role: 'user', branch_id: 1, department_id: 10 };
  const user2 = { id: 13, name: 'User2', role: 'user', branch_id: 1, department_id: 10 };
  const user3 = { id: 14, name: 'User3', role: 'user', branch_id: 2, department_id: 20 };
  const admin = { id: 1, name: 'Admin', role: 'admin', branch_id: 1, department_id: 10 };

  const createAndConfirmLine = async (actor, uuid, { productGroupId = 3, supplierName = '', billText = 'หมูสามชั้นคัดพิเศษ', unitText = 'กก.', productId = 7 }) => {
    const created = await h.invoke('createDocument', {
      user: actor,
      body: {
        client_uuid: uuid,
        delivery_date: h.today,
        kind: 'bill',
        product_group_id: productGroupId,
        supplier_name_text: supplierName
      }
    });
    const id = String(created.body.data.id);
    await h.invoke('updateDocument', {
      user: actor,
      params: { id },
      body: {
        lines: [
          {
            line_no: 1,
            bill_text: billText,
            unit_text: unitText,
            product_id: productId,
            quantity_received: '1',
            unit_price: '150.00'
          }
        ]
      }
    });
    await h.invoke('addSignature', {
      user: actor,
      params: { id },
      body: { role: 'receiver', image_data_url: makePngDataUrl() }
    });
    const res = await h.invoke('confirmDocument', { user: actor, params: { id } });
    assert.equal(res.statusCode, 200);
  };
  await t.test("No supplier key creates no alias", async () => {
    // 1) เมื่อ supplier_key === 'none' (ไม่มี product_group_id, supplier_master_id, supplier_name_text) ต้องไม่เรียนรู้ alias เลย
    await createAndConfirmLine(user1, 'no-supplier-doc', {
      productGroupId: null,
      supplierName: '',
      billText: 'สินค้าไม่ระบุร้าน',
      productId: 7
    });
    assert.equal(h.state.aliases.length, 0);
  });
  await t.test("First confirmation creates one alias with confirm_count 1 and a created event", async () => {
    // 2) ยืนยันครั้งแรกสำหรับ pg:3 -> สร้าง alias ด้วย confirm_count = 1 (ค่าจริงของ SQL!) และบันทึก event 'created'
    await createAndConfirmLine(user1, 'alias-init-1', { productId: 7 });
    assert.equal(h.state.aliases.length, 1);
    assert.equal(h.state.aliases[0].product_id, 7);
    assert.equal(h.state.aliases[0].confirm_count, 1);
    assert.equal(h.state.aliasEvents.at(-1).decision, 'created');
  });
  await t.test("One user voting three times cannot hijack an existing alias", async () => {
    // 3) แม้ confirm_count === 1 ผู้ใช้ทั่วไป (user2) เปลี่ยนเป็น product_id = 8 เพียงคนเดียว ต้องไม่ทับ product_id 7!
    // และ אם user2 คนเดิมยืนยันซ้ำ 3 ครั้งติดกัน ก็ต้องไม่เปลี่ยน product_id 7!
    await createAndConfirmLine(user2, 'alias-u2-try1', { productId: 8 });
    await createAndConfirmLine(user2, 'alias-u2-try2', { productId: 8 });
    await createAndConfirmLine(user2, 'alias-u2-try3', { productId: 8 });

    assert.equal(h.state.aliases[0].product_id, 7, 'Single user confirming 3 times must NOT hijack alias');
    assert.equal(h.state.aliases[0].candidate_product_id, 8);
    assert.equal(h.state.aliases[0].candidate_confirm_count, 1, 'Distinct user count for candidate is still 1');
  });
  await t.test("Three distinct users promote a candidate and record candidate_promoted", async () => {
    // 4) เมื่อมีผู้ใช้ต่างกันครบ 3 คน (user2 + user1 + user3) ยืนยันเป็น product_id 8 -> เลื่อนชั้นเป็น product_id 8 สำเร็จ!
    await createAndConfirmLine(user1, 'alias-u1-vote8', { productId: 8 });
    assert.equal(h.state.aliases[0].product_id, 7);
    assert.equal(h.state.aliases[0].candidate_confirm_count, 2);

    await createAndConfirmLine(user3, 'alias-u3-vote8', { productId: 8 });
    assert.equal(h.state.aliases[0].product_id, 8, '3 distinct users must promote candidate_product_id');
    assert.equal(h.state.aliases[0].confirm_count, 3);
    assert.equal(h.state.aliases[0].candidate_product_id, null);
    assert.equal(h.state.aliasEvents.at(-1).decision, 'candidate_promoted');
  });
  await t.test("Admin overrides the alias immediately and records admin_override", async () => {
    // 5) Admin สามารถเปลี่ยน product_id ได้ทันทีในครั้งเดียว ('admin_override')
    await createAndConfirmLine(admin, 'alias-admin-override', { productId: 11 });
    assert.equal(h.state.aliases[0].product_id, 11);
    assert.equal(h.state.aliases[0].confirm_count, 1);
    assert.equal(h.state.aliasEvents.at(-1).decision, 'admin_override');
  });
});
