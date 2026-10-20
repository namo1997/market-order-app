import test from 'node:test';
import assert from 'node:assert/strict';
import { openHarness, ACTORS } from './receiving-mysql-harness.mjs';
test('round P real MySQL: multi-group/internal priority matches legacy; carryover SQL, read-only preflight, notes and accounting void', async () => {
  const h = await openHarness();
  try {
    await h.setup();
    await h.raw.query('DELETE FROM product_group_withdraw_sources');
    await h.raw.query('DELETE FROM product_group_scopes');
    await h.raw.query('DELETE FROM withdraw_branch_source_mappings');
    await h.reset();
    await h.raw.query("INSERT INTO departments(id,branch_id,name) VALUES (30,1,'IT store')");
    await h.raw.query("INSERT INTO product_groups(id,name,code,is_internal,linked_department_id,skip_receiving_required) VALUES (2,'IT scoped','P2',false,NULL,false),(3,'IT withdraw','P3',true,30,false),(4,'IT mapped','P4',true,30,false)");
    await h.raw.query('UPDATE product_groups SET skip_receiving_required = false WHERE id = 1');
    await h.raw.query('INSERT INTO withdraw_branch_source_mappings(target_branch_id,source_department_id) VALUES(1,30)');
    await h.raw.query('INSERT INTO product_group_links(product_id,product_group_id,is_primary) VALUES (1,2,true),(1,3,false),(1,4,false)');
    await h.raw.query('INSERT INTO product_group_scopes(product_group_id,branch_id,department_id) VALUES (2,1,1)');
    await h.raw.query('INSERT INTO product_group_withdraw_sources(product_group_id,source_department_id) VALUES (3,30)');
    await h.raw.query("INSERT INTO orders(id,order_number,user_id,order_date,status) VALUES (100,'P-100',1,'2026-10-15','submitted')");
    await h.raw.query('INSERT INTO order_items(id,order_id,product_id,quantity) VALUES (100,100,1,10)');
    const expectGroup = async group => {
      const legacy = await h.app.order.getReceivingItemsByUser({date:'2026-10-15',userId:1});
      const queue = await h.app.model.getExpectedItems({user:ACTORS[1],date:'2026-10-15',autoFollowup:false});
      assert.equal(Number(legacy.find(i=>i.order_item_id===100).supplier_id),group);
      assert.equal(queue.find(g=>g.items.some(i=>i.order_item_id===100)).supplier_key,`pg:${group}`);
    };
    await expectGroup(3);
    await h.raw.query('UPDATE order_items SET source_product_group_id = 2 WHERE id = 100'); await expectGroup(2);
    await h.raw.query('UPDATE order_items SET source_product_group_id = NULL WHERE id = 100');
    await h.raw.query('DELETE FROM product_group_withdraw_sources'); await expectGroup(2);
    await h.raw.query('DELETE FROM product_group_scopes'); await expectGroup(3);
    await h.raw.query('UPDATE product_groups SET is_internal = false WHERE id IN (3,4)'); await expectGroup(1);
    await h.raw.query('UPDATE products SET allow_pending_carryover = true WHERE id = 1');
    await h.raw.query("UPDATE orders SET order_date = DATE_SUB('2026-10-15', INTERVAL 90 DAY) WHERE id = 100");
    let queue = await h.app.model.getExpectedItems({user:ACTORS[1],date:'2026-10-15',autoFollowup:false});
    assert.equal(queue[0].items[0].age_days,90);
    await h.raw.query("UPDATE orders SET order_date = DATE_SUB('2026-10-15', INTERVAL 91 DAY) WHERE id = 100");
    queue = await h.app.model.getExpectedItems({user:ACTORS[1],date:'2026-10-15',autoFollowup:false});assert.equal(queue.length,0);
    const call = async(method,suffix,body,actor=1) => {
      const response=await h.request(method,`/api/receiving-documents${suffix}`,body,actor);
      assert.equal(response.status,method==='POST'&&suffix==='/'?201:200,JSON.stringify(response.body));return response.body.data;
    };
    let doc=await call('POST','/',{client_uuid:'P-real-count',delivery_date:'2026-10-15',kind:'manual_receipt',product_group_id:1});
    const counted={client_uuid:doc.client_uuid,lines:[{product_id:1,unit_text:'kg',counted_quantity:'10144'}]};
    const checked=await call('POST',`/${doc.id}/count`,{...counted,check_only:true});assert.equal(checked.count_warnings.length,1);
    const [[{total}]]=await h.raw.query('SELECT COUNT(*) AS total FROM receiving_document_lines WHERE document_id = ?',[doc.id]);assert.equal(total,0);
    doc=await call('POST',`/${doc.id}/count`,counted);
    doc=await call('PUT',`/${doc.id}`,{lines:[{id:doc.lines[0].id,note:'โทรสั่ง',review_decision:'missing_bill'}]});assert.equal(doc.lines[0].note,'โทรสั่ง');
    await call('POST',`/${doc.id}/signatures`,{role:'receiver',image_data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6f9sAAAAASUVORK5CYII='});
    await call('POST',`/${doc.id}/confirm`,{});
    const [[item]]=await h.raw.query('SELECT receive_notes FROM order_items oi JOIN receiving_document_lines l ON l.order_item_id=oi.id WHERE l.document_id=?',[doc.id]);
    assert.match(item.receive_notes,new RegExp(`รับสินค้าตามเอกสาร #${doc.id}: โทรสั่ง`));
    ACTORS[2].role='accounting';
    await h.raw.query("UPDATE receiving_documents SET confirmed_at = '2026-10-08 03:00:00' WHERE id = ?",[doc.id]);
    await call('POST',`/${doc.id}/void`,{reason:'IT accounting correction'},2);
    const [[balance]]=await h.raw.query('SELECT quantity FROM inventory_balance WHERE product_id=1 AND department_id=1');assert.equal(Number(balance.quantity),0);
    const [[audit]]=await h.raw.query("SELECT COUNT(*) AS total FROM receiving_document_audits WHERE document_id=? AND action='void'",[doc.id]);assert.equal(Number(audit.total),1);
  } finally { ACTORS[2].role='user'; await h.close(); }
});
