import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { storage } from './ssd-storage.mjs';
import { case3972Lines } from './invoice-case-fixture.mjs';
assert.equal(process.env.SOLAO_LOCAL_SIMULATION,'1');storage.assertSSD();
const reportPath=storage.assertSSDPath(process.argv[2]);
const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
assert.equal(report.ai_worker,false);assert.equal(report.mock_line,true);assert.ok(report.base_url.startsWith('http://127.0.0.1:'));
const dbPath=storage.assertSSDPath(report.working_db);assert.notEqual(dbPath,report.source_snapshot);
const db=new DatabaseSync(dbPath);
db.exec('BEGIN IMMEDIATE');
try {
  for(const id of [3970,3972]) {
    const row=db.prepare('SELECT doc_ref,ai_result_json FROM capture_items WHERE id=?').get(id);assert.equal(row.doc_ref,'041841244193');
    const analysis=JSON.parse(row.ai_result_json);analysis.line_items=id===3972?case3972Lines:[];analysis.line_items_complete=true;
    analysis.line_items_truncated=false;analysis.line_items_invalid_count=0;
    if(id===3970){analysis.bill_subtotal_value=3450.50;analysis.discount_value=18;}
    db.prepare('UPDATE capture_items SET ai_result_json=? WHERE id=?').run(JSON.stringify(analysis),id);
  }
  db.exec('COMMIT');
}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
await fs.writeFile(reportPath,JSON.stringify({...report,simulated_product_ocr:true,simulated_product_item_ids:[3970,3972],simulation_note:'สินค้า 12 แถวถอดจากรูปเพื่อจำลองผล OCR ไม่ได้เรียก AI และไม่มีการแยกยอดลงบัญชี'},null,2),{mode:0o600});
console.log('Seeded simulated product OCR for #3970/#3972 in isolated preview only');
