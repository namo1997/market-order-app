import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    summarizeUnitUsage, getUnitUsageTotal, buildUnitDeleteBlockedMessage
} from '../src/utils/unit-master-rules.js';
import { unitUsageItems, unitDeleteReason } from '../../client/src/utils/unit-management.js';

// โหลด unit-usage.model.js โดยแทน pool ด้วยตัวปลอมที่ทดสอบกำหนดได้ (ไม่แตะ MySQL จริง)
const source = await readFile(new URL('../src/models/unit-usage.model.js', import.meta.url), 'utf8');
const fakePoolModule = 'data:text/javascript,' + encodeURIComponent('export default { query: (...args) => globalThis.__unitUsagePool.query(...args) };');
const patched = source.replace("'../config/database.js'", JSON.stringify(fakePoolModule));
assert.notEqual(patched, source, 'ต้องแทน import ของ pool ได้');
const { loadUnitUsage, emptyUnitUsage } = await import('data:text/javascript;base64,' + Buffer.from(patched).toString('base64'));

const noTable = () => Object.assign(new Error('Table doesn\'t exist'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });

// ตัวปลอมตอบตามชื่อตารางหลัง FROM; ตารางที่ไม่อยู่ใน tables ถือว่ายังไม่ถูกสร้าง
const installPool = (tables, seen = []) => {
    globalThis.__unitUsagePool = {
        async query(sql) {
            const table = /FROM\s+([a-z_]+)/i.exec(sql)?.[1];
            seen.push(table);
            if (!(table in tables)) throw noTable();
            const column = /\bAS\s+([a-z_]+)\s+FROM/i.exec(sql.replace(/\s+/g, ' '))?.[1];
            return [tables[table].map((row) => ({ unit_id: row.unit_id, ...(row.cols || { [column]: row.count }) }))];
        }
    };
    return seen;
};

test('UNIT-07 หน่วยที่ใช้เฉพาะในตารางรับสินค้ามียอดใช้งานและลบไม่ได้', async () => {
    const seen = installPool({
        receiving_document_lines: [{ unit_id: 41, count: 3 }],
        supplier_product_aliases: [{ unit_id: 41, count: 2 }],
        supplier_product_alias_events: [{ unit_id: 42, count: 5 }]
    });
    const usage = await loadUnitUsage();
    for (const table of ['receiving_document_lines', 'supplier_product_aliases', 'supplier_product_alias_events']) {
        assert.ok(seen.includes(table), `ต้องมี query ตาราง ${table}`);
    }
    const lineOnly = usage.get('41');
    assert.equal(lineOnly.receiving_document_lines, 3);
    assert.equal(lineOnly.receiving_aliases, 2);
    assert.equal(lineOnly.products_active, 0);
    assert.equal(getUnitUsageTotal(lineOnly), 5);
    const message = buildUnitDeleteBlockedMessage('กล่อง', lineOnly);
    assert.match(message, /รายการรับสินค้า 3 รายการ/);
    assert.match(message, /ชื่อบิลที่ระบบจำไว้ 2 รายการ/);
    // หน่วยที่มีเพียงประวัติชื่อบิลก็ต้องกันลบ
    assert.ok(buildUnitDeleteBlockedMessage('ถุง', usage.get('42')));
    assert.match(unitDeleteReason({ usage: usage.get('42') }), /ประวัติชื่อบิลที่ระบบจำไว้ 5/);
});

test('UNIT-07 ตารางรับสินค้ายังไม่ถูกสร้าง ตัวกันไม่พังและยังนับตารางอื่นได้', async () => {
    installPool({
        products: [{ unit_id: 7, cols: { products_active: 4, products_inactive: 0 } }]
    });
    const usage = await loadUnitUsage();
    assert.equal(usage.get('7').products_active, 4);
    assert.equal(usage.get('7').receiving_document_lines, 0);
    assert.ok(buildUnitDeleteBlockedMessage('กก.', usage.get('7')));
    installPool({});
    assert.equal((await loadUnitUsage()).size, 0);
});

test('UNIT-07 ตารางรับสินค้าที่ไม่มีคอลัมน์ unit_id หรือผิดพลาดชนิดอื่น: ขาดคอลัมน์ข้าม แต่ข้อผิดพลาดอื่นต้องโยนต่อ', async () => {
    globalThis.__unitUsagePool = {
        async query(sql) {
            if (/receiving_document_lines/.test(sql)) throw Object.assign(new Error('bad field'), { code: 'ER_BAD_FIELD_ERROR', errno: 1054 });
            return [[]];
        }
    };
    assert.equal((await loadUnitUsage()).size, 0);
    globalThis.__unitUsagePool = {
        async query(sql) {
            if (/supplier_product_aliases/.test(sql)) throw Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
            return [[]];
        }
    };
    await assert.rejects(loadUnitUsage(), /lost/);
});

test('UNIT-07 emptyUnitUsage มีคีย์ตารางรับสินค้าและทุกคีย์มีป้ายภาษาไทยทั้ง server/client', () => {
    const empty = emptyUnitUsage();
    const receivingKeys = ['receiving_document_lines', 'receiving_aliases', 'receiving_alias_events'];
    for (const key of receivingKeys) assert.equal(empty[key], 0);
    const counts = Object.fromEntries(Object.keys(empty).map((key) => [key, 1]));
    const serverKeys = summarizeUnitUsage(counts).map((item) => item.key);
    const clientKeys = unitUsageItems({ usage: counts }).map((item) => item.key);
    assert.deepEqual(serverKeys, Object.keys(empty));
    assert.deepEqual(clientKeys, serverKeys);
    assert.deepEqual(unitUsageItems({ usage: counts }).map((item) => item.label), summarizeUnitUsage(counts).map((item) => item.label));
});
