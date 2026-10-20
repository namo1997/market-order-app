import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { RECEIVING_GROUP_SQL } from '../../src/models/receiving-group-sql.js';
// Execute the shared, portable resolution expression against a real SQL engine.
// This supplements MySQL acceptance; it does not claim MySQL schema validation.
test('shared group SQL resolves explicit, withdraw, scoped, mapped and default groups with multi-group primary/active ties',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  db.exec(`CREATE TABLE order_items(source_product_group_id INTEGER); CREATE TABLE products(id INTEGER,product_group_id INTEGER);
   CREATE TABLE branches(id INTEGER); CREATE TABLE departments(id INTEGER); CREATE TABLE withdraw_branch_source_mappings(source_department_id INTEGER);
   CREATE TABLE product_group_links(product_id INTEGER,product_group_id INTEGER,is_primary INTEGER);
   CREATE TABLE product_groups(id INTEGER,is_active INTEGER,is_internal INTEGER,linked_department_id INTEGER);
   CREATE TABLE product_group_withdraw_sources(product_group_id INTEGER,source_department_id INTEGER);
   CREATE TABLE product_group_scopes(product_group_id INTEGER,branch_id INTEGER,department_id INTEGER);
   INSERT INTO order_items VALUES(NULL); INSERT INTO products VALUES(1,1); INSERT INTO branches VALUES(1); INSERT INTO departments VALUES(10);
   INSERT INTO withdraw_branch_source_mappings VALUES(30);
   INSERT INTO product_groups VALUES(1,1,0,NULL),(2,1,0,NULL),(3,1,1,30),(4,1,1,30),(5,1,1,30),(6,0,0,NULL);
   INSERT INTO product_group_links VALUES(1,2,1),(1,3,0),(1,4,1),(1,5,0),(1,6,1);
   INSERT INTO product_group_withdraw_sources VALUES(3,30),(4,30),(6,30);
   INSERT INTO product_group_scopes VALUES(2,1,10),(6,1,10);`);
  const query=db.prepare(`SELECT ${RECEIVING_GROUP_SQL} AS resolved FROM order_items oi CROSS JOIN products p CROSS JOIN branches b CROSS JOIN departments d CROSS JOIN withdraw_branch_source_mappings wbm`);
  assert.equal(query.get().resolved,4,'active primary withdraw group wins over scope and default');
  db.exec('UPDATE order_items SET source_product_group_id=5');assert.equal(query.get().resolved,5,'explicit source wins');
  db.exec('UPDATE order_items SET source_product_group_id=NULL; DELETE FROM product_group_withdraw_sources');assert.equal(query.get().resolved,2,'department scope wins over internal map');
  db.exec('UPDATE product_group_scopes SET department_id=20');assert.equal(query.get().resolved,3,'internal mapping uses deterministic lowest ID');
  db.exec('UPDATE withdraw_branch_source_mappings SET source_department_id=40');assert.equal(query.get().resolved,1,'foreign source and foreign department cannot match');
 } finally { db.close(); }
});
