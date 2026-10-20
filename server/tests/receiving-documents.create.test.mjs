import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness } from './helpers/receiving-fake-db.mjs';

test("Create rejects linked items from cancelled orders with 422", async () => {
  const h = await createReceivingHarness();
  const userBranch1 = { id: 12, name: 'UserBranch1', role: 'user', branch_id: 1, department_id: 10 };

  // R2-12: ผูกใบสั่งที่ถูกยกเลิก (order_item_id: 53 ซึ่งมี order_status = 'cancelled') ต้องได้ 422 VALIDATION_FAILED
  const cancelledOrderPost = await h.invoke('createDocument', {
    user: userBranch1,
    body: {
      client_uuid: 'cancelled-order-doc',
      delivery_date: h.today,
      kind: 'bill',
      product_group_id: 3,
      order_item_ids: [53]
    }
  });
  assert.equal(cancelledOrderPost.statusCode, 422);
  assert.equal(cancelledOrderPost.body.code, 'VALIDATION_FAILED');
});

test("Concurrent client_uuid requests return one document ID and one database row", async () => {
  const h = await createReceivingHarness();
  const userBranch1 = { id: 12, name: 'UserBranch1', role: 'user', branch_id: 1, department_id: 10 };

  // ทดสอบ Idempotency พร้อมกันจริงด้วย Promise.all บน POST / ด้วย client_uuid เดียวกัน
  h.state.delayBeforeDocInsertMs = 15;
  const [concCreate1, concCreate2] = await Promise.all([
    h.invoke('createDocument', {
      user: userBranch1,
      body: {
        client_uuid: 'concurrent-uuid-1',
        delivery_date: h.today,
        kind: 'bill',
        product_group_id: 3,
        order_item_ids: [50]
      }
    }),
    h.invoke('createDocument', {
      user: userBranch1,
      body: {
        client_uuid: 'concurrent-uuid-1',
        delivery_date: h.today,
        kind: 'bill',
        product_group_id: 3,
        order_item_ids: [50]
      }
    })
  ]);
  h.state.delayBeforeDocInsertMs = 0;

  assert.equal(concCreate1.body.data.id, concCreate2.body.data.id, 'Both concurrent requests must return the exact same document ID');
  assert.equal(
    h.state.documents.filter((d) => d.client_uuid === 'concurrent-uuid-1').length,
    1,
    'Only 1 document row must exist in DB'
  );
});
