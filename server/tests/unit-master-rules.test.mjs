import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeUnitInput, summarizeUnitUsage, getUnitUsageTotal,
    buildUnitDeleteBlockedMessage, findUnitNameConflict, buildUnitNameConflictMessage
} from '../src/utils/unit-master-rules.js';
import { parseUnitImportCsv, unitNameKey, unitDeleteReason, unitErrorMessage } from '../../client/src/utils/unit-management.js';

test('UNIT-09/10 ตัดช่องว่างหน้าหลังและยุบช่องว่างซ้ำทั้งสองช่อง', () => {
    assert.deepEqual(normalizeUnitInput({ name: '  หน่วย   ทดสอบ\tใหม่  ', abbreviation: ' ก  ก. ' }), {
        value: { name: 'หน่วย ทดสอบ ใหม่', abbreviation: 'ก ก.' }
    });
});

test('UNIT-10 ไม่รับค่าว่างหรือข้อมูลที่ไม่ใช่ข้อความ', () => {
    for (const input of [undefined, null, {}, { name: '  ', abbreviation: 'กก.' },
        { name: 'กิโลกรัม', abbreviation: '\t' }, { name: 123, abbreviation: 'กก.' },
        { name: 'กิโลกรัม', abbreviation: {} }]) {
        assert.equal(typeof normalizeUnitInput(input).error, 'string');
    }
});

test('UNIT-10 ชื่อยาวได้ 50 code point และปฏิเสธ 51', () => {
    assert.ok(normalizeUnitInput({ name: 'ก'.repeat(50), abbreviation: 'ก' }).value);
    assert.match(normalizeUnitInput({ name: 'ก'.repeat(51), abbreviation: 'ก' }).error, /50/);
    // อักขระนอก BMP ต้องนับหนึ่ง code point ต่อหนึ่งตัว
    assert.ok(normalizeUnitInput({ name: '😀'.repeat(50), abbreviation: 'ก' }).value);
});

test('UNIT-10 ตัวย่อ 11 ตัวไม่ผ่าน และภาษาไทยรวมสระวรรณยุกต์ 10 code point ผ่าน', () => {
    const abbreviation = 'กิ่กิ่กิ่ก';
    assert.equal([...abbreviation].length, 10);
    assert.deepEqual(normalizeUnitInput({ name: 'ทดสอบ', abbreviation }).value, { name: 'ทดสอบ', abbreviation });
    assert.match(normalizeUnitInput({ name: 'ทดสอบ', abbreviation: `${abbreviation}ก` }).error, /10/);
    assert.match(normalizeUnitInput({ name: 'ทดสอบ', abbreviation: 'a'.repeat(11) }).error, /10/);
    assert.ok(normalizeUnitInput({ name: 'ทดสอบ', abbreviation: '😀'.repeat(10) }).value);
});

test('UNIT-07 สรุปเฉพาะยอดบวก รวมสินค้าปิดใช้และทุกตารางที่ใช้งาน', () => {
    const counts = {
        products_active: 211, products_inactive: '2', purchase_unit_links: 3,
        stock_templates: 4, menu_recipe_items: 5, production_ingredients: 6, unit_conversions: 7,
        stock_checks: 99
    };
    const items = summarizeUnitUsage(counts);
    assert.equal(items.length, 7);
    assert.deepEqual(items[0], { key: 'products_active', label: 'สินค้า', count: 211 });
    assert.equal(getUnitUsageTotal(counts), 238);
    for (const { label, count } of items) {
        assert.ok(buildUnitDeleteBlockedMessage('กิโลกรัม', counts).includes(`${label} ${count} รายการ`));
    }
    assert.match(buildUnitDeleteBlockedMessage('กิโลกรัม', counts), /กิโลกรัม/);
    assert.equal(getUnitUsageTotal({ products_active: 0, menu_recipe_items: -1, unit_conversions: 'x' }), 0);
});

test('UNIT-07 การใช้งานว่างคืนรายการว่าง ยอดศูนย์ และข้อความ null', () => {
    for (const counts of [undefined, null, {}, { products_active: 0 }]) {
        assert.deepEqual(summarizeUnitUsage(counts), []);
        assert.equal(getUnitUsageTotal(counts), 0);
        assert.equal(buildUnitDeleteBlockedMessage('ถุง', counts), null);
    }
    assert.ok(buildUnitDeleteBlockedMessage('ถุง', { products_inactive: 1 }));
});

test('UNIT-09 ชื่อซ้ำเทียบแบบตัดช่องว่างและไม่สนตัวพิมพ์ รวมหน่วยที่ลบแล้ว', () => {
    const units = [{ id: 1, name: ' KG ', is_active: 1 }, { id: 2, name: ' ถุง ', is_active: 0 }];
    assert.equal(findUnitNameConflict(units, 'kg').id, 1);
    assert.equal(findUnitNameConflict(units, ' ถุง ').id, 2);
    assert.equal(findUnitNameConflict(units, 'ขวด'), null);
    assert.equal(findUnitNameConflict(undefined, 'ขวด'), null);
    assert.equal(findUnitNameConflict(units, 'kg', '1'), null);
    assert.equal(findUnitNameConflict(units, 'ถุง', 1).id, 2);
});

test('UNIT-09 ข้อความชื่อซ้ำของหน่วยที่ลบแล้วแนะนำกู้คืน', () => {
    assert.match(buildUnitNameConflictMessage({ name: 'ถุง', is_active: 0 }), /กู้คืน/);
    assert.match(buildUnitNameConflictMessage({ name: 'ถุง', is_active: '0' }), /กู้คืน/);
    assert.match(buildUnitNameConflictMessage({ name: 'ถุง', is_active: false }), /กู้คืน/);
    assert.match(buildUnitNameConflictMessage({ name: 'ถุง', is_active: 1 }), /ชื่ออื่น/);
    assert.ok(buildUnitNameConflictMessage({ name: 'ถุง', is_active: 1 }).includes('ถุง'));
});

test('UNIT-11 CSV คงเลขบรรทัดจริงเมื่อมี BOM บรรทัดว่าง CRLF และข้อความหลายบรรทัด', () => {
    const rows = parseUnitImportCsv('\uFEFFname,abbreviation\r\n\r\nถุง,ถ.\r\n"หน่วย\nใหม่",น.\nขวด,ข.');
    assert.deepEqual(rows, [
        { line: 3, row: { name: 'ถุง', abbreviation: 'ถ.' } },
        { line: 4, row: { name: 'หน่วย\nใหม่', abbreviation: 'น.' } },
        { line: 6, row: { name: 'ขวด', abbreviation: 'ข.' } }
    ]);
    assert.equal(unitNameKey(rows[1].row.name), 'หน่วย ใหม่');
    assert.equal(unitNameKey(' KG '), unitNameKey('kg'));
});

test('UNIT-11 CSV รองรับเครื่องหมายคำพูดซ้อน ช่องว่าง และตรวจหัวคอลัมน์/คำพูดไม่ครบ', () => {
    assert.deepEqual(parseUnitImportCsv('name,abbreviation\n"หน่วย ""ใหญ่""",ญ.\n,,\nถุง,\n'), [
        { line: 2, row: { name: 'หน่วย "ใหญ่"', abbreviation: 'ญ.' } },
        { line: 4, row: { name: 'ถุง', abbreviation: '' } }
    ]);
    assert.deepEqual(parseUnitImportCsv('name,abbreviation\n'), []);
    assert.throws(() => parseUnitImportCsv('name\nถุง'), /หัวคอลัมน์/);
    assert.throws(() => parseUnitImportCsv('name,abbreviation\n"ถุง,ถ.'), /แถว 2/);
});

test('UNIT-07/11 หน้าเว็บบอกเหตุผลลบและใช้ข้อความไทยจาก server ก่อนข้อความเครือข่าย', () => {
    assert.equal(unitDeleteReason({ usage: {} }), '');
    assert.match(unitDeleteReason({ usage: { products_inactive: 2 } }), /สินค้าปิดใช้ 2/);
    assert.equal(unitErrorMessage({ response: { data: { message: 'หน่วยยังใช้อยู่' } } }, 'ล้มเหลว'), 'หน่วยยังใช้อยู่');
    assert.equal(unitErrorMessage({ isAxiosError: true, message: 'Network Error' }, 'โหลดไม่สำเร็จ'), 'โหลดไม่สำเร็จ');
});
