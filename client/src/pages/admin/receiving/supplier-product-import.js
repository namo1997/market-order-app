export const IMPORT_COLUMNS = ['ชื่อสินค้า', 'หน่วย', 'ราคา', 'ชื่อตามบิล', 'รหัสในบิล', 'กลุ่ม'];
const keys = ['name', 'unit', 'price', 'bill_text', 'item_code', 'group'];
// CSV and Excel TSV, including quoted commas, escaped quotes and embedded newlines.
export function parseProductSheet(source) {
  if (typeof source !== 'string' || source.length > 100000) throw new Error('ข้อมูลยาวเกินกำหนด (100,000 ตัวอักษร)');
  const value = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const delimiter = value.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell.trim()); cell = ''; closed = false; };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === '"' && value[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === delimiter) pushCell();
    else if (c === '\n') { pushCell(); if (row.some(Boolean)) rows.push(row); row = []; }
    else if (c === '"' && !cell && !closed) quoted = true;
    else if (closed || c === '"') throw new Error('รูปแบบเครื่องหมายคำพูดใน CSV ไม่ถูกต้อง');
    else cell += c;
  }
  if (quoted) throw new Error('CSV มีเครื่องหมายคำพูดที่ยังไม่ปิด');
  pushCell(); if (row.some(Boolean)) rows.push(row);
  const header = rows.shift();
  if (!header || header.length !== 6 || header.some((c, i) => c !== IMPORT_COLUMNS[i])) throw new Error(`หัวคอลัมน์ต้องเป็น: ${IMPORT_COLUMNS.join(', ')}`);
  if (!rows.length || rows.length > 100) throw new Error('นำเข้าได้ครั้งละ 1–100 รายการ');
  return rows.map((cells, index) => {
    if (cells.length !== 6) throw new Error(`แถว ${index + 2} ต้องมี 6 คอลัมน์`);
    return Object.fromEntries(keys.map((key, i) => [key, cells[i]]));
  });
}
export const emptyProductDraft = { name: '', unit: '', price: '', bill_text: '', item_code: '', group: '' };
