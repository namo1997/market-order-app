// รูปแบบข้อความแจ้งเตือนคำสั่งซื้อบน Discord (แบบ C: รายการ + เส้นคั่น)
// ออกแบบให้อ่านบนพื้นดำ: ใช้สี่เหลี่ยมสี (🟩🟨🟥) และมีคำกำกับทุกบรรทัด
// ทุกบรรทัดมีชื่อและจำนวนครบในตัว อ่านบนจอมือถือได้โดยไม่เลื่อนแถว

export const DIVIDER = '━━━━━━━━━━━━━━━';
const UNGROUPED = 'ไม่ระบุกลุ่ม';
const DEFAULT_FIELDS = ['date', 'branch', 'department', 'count', 'items'];

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQty = (value) => {
  const n = toNumber(value);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
};

const unitOf = (item) => String(item?.unit_abbr || item?.unit_name || '').trim();
const qtyText = (item, qty = item?.quantity) => {
  const unit = unitOf(item);
  return `${formatQty(qty)}${unit ? ` ${unit}` : ''}`;
};
const groupOf = (item) =>
  String(item?.supplier_name || item?.product_group_name || '').trim() || UNGROUPED;
const nameOf = (item) => String(item?.product_name || '-').trim();
const noteOf = (item) => String(item?.notes ?? item?.note ?? '').replace(/\s+/g, ' ').trim();
// หมายเหตุที่พนักงานพิมพ์ แสดงใต้รายการ (📝 เป็นกระดาษสีขาว มองเห็นบนพื้นดำ)
const noteLine = (item) => (noteOf(item) ? `　📝 ${noteOf(item)}` : null);
const keyOf = (item) =>
  item?.product_id !== undefined && item?.product_id !== null
    ? `p:${item.product_id}`
    : `n:${nameOf(item)}`;

export const formatOrderDate = (value) => {
  if (!value) return '-';
  const text = String(value);
  // order_date เป็นวันที่ล้วน (YYYY-MM-DD) อย่าแปลงผ่าน timezone ให้วันเลื่อน
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matched && !(value instanceof Date)) {
    return `${matched[3]}/${matched[2]}/${Number(matched[1]) + 543}`;
  }
  const date = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

const byThaiName = (a, b) => a.localeCompare(b, 'th');

// จัดกลุ่มตามกลุ่มสินค้า เรียงชื่อกลุ่มและชื่อสินค้าแบบไทย
const groupEntries = (entries) => {
  const groups = new Map();
  for (const entry of entries) {
    const group = groupOf(entry.item);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return byThaiName(a, b);
    })
    .map(([group, list]) => [group, list.sort((x, y) => byThaiName(nameOf(x.item), nameOf(y.item)))]);
};

const buildHeader = ({ title, order, fields, summary }) => {
  const place = [
    fields.includes('branch') ? order?.branch_name : null,
    fields.includes('department') ? order?.department_name : null
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' / ');
  const lines = [`**${title}${place ? ` · ${place}` : ''}**`];
  const meta = [
    fields.includes('date') ? `วันที่สั่งซื้อ ${formatOrderDate(order?.order_date)}` : null,
    fields.includes('count') ? summary : null
  ].filter(Boolean);
  if (meta.length > 0) lines.push(meta.join(' · '));
  return lines;
};

const resolveFields = (fields) =>
  Array.isArray(fields) && fields.length > 0 ? fields : DEFAULT_FIELDS;

// สั่งซื้อใหม่ หรือ ยกเลิกคำสั่งซื้อ (cancelled = true แสดง 🟥 และขีดฆ่า)
export const formatOrderMessage = ({ title, order, fields, cancelled = false, actorName = '' }) => {
  const safeFields = resolveFields(fields);
  const items = Array.isArray(order?.items) ? order.items : [];
  const summaryParts = [`${items.length} รายการ`];
  if (actorName) summaryParts.push(`${cancelled ? 'ลบโดย' : 'โดย'} ${actorName}`);
  const lines = buildHeader({ title, order, fields: safeFields, summary: summaryParts.join(' · ') });

  if (!safeFields.includes('items') || items.length === 0) return lines.join('\n');

  for (const [group, entries] of groupEntries(items.map((item) => ({ item })))) {
    lines.push(DIVIDER, `**${group}** (${entries.length})`);
    for (const { item } of entries) {
      lines.push(
        cancelled
          ? `🟥 ~~${nameOf(item)} ${qtyText(item)}~~`
          : `• ${nameOf(item)} **${qtyText(item)}**`
      );
      const note = noteLine(item);
      if (note) lines.push(note);
    }
  }
  return lines.join('\n');
};

// เทียบรายการก่อน/หลังแก้ คืนเฉพาะที่เปลี่ยน
export const diffOrderItems = (beforeItems = [], afterItems = []) => {
  const before = new Map();
  for (const item of beforeItems || []) before.set(keyOf(item), item);
  const after = new Map();
  for (const item of afterItems || []) after.set(keyOf(item), item);

  const changes = [];
  const unchanged = [];
  for (const [key, item] of after) {
    const old = before.get(key);
    if (!old) {
      changes.push({ type: 'added', item });
    } else if (Math.abs(toNumber(old.quantity) - toNumber(item.quantity)) > 1e-9) {
      changes.push({ type: 'changed', item, oldQty: old.quantity, oldNote: noteOf(old) });
    } else if (noteOf(old) !== noteOf(item)) {
      changes.push({ type: 'noteChanged', item, oldNote: noteOf(old) });
    } else {
      unchanged.push(item);
    }
  }
  for (const [key, item] of before) {
    if (!after.has(key)) changes.push({ type: 'removed', item });
  }
  return { changes, unchanged };
};

const CHANGE_ORDER = { changed: 0, noteChanged: 1, added: 2, removed: 3 };

export const formatOrderUpdateMessage = ({ title, order, beforeItems, fields }) => {
  const safeFields = resolveFields(fields);
  const afterItems = Array.isArray(order?.items) ? order.items : [];
  const { changes, unchanged } = diffOrderItems(beforeItems, afterItems);
  if (changes.length === 0) return null;

  const lines = buildHeader({
    title,
    order,
    fields: safeFields,
    summary: `แก้ ${changes.length} รายการ`
  });
  if (!safeFields.includes('items')) return lines.join('\n');

  for (const [group, entries] of groupEntries(changes)) {
    lines.push(DIVIDER, `**${group}**`);
    entries
      .sort((a, b) => CHANGE_ORDER[a.type] - CHANGE_ORDER[b.type])
      .forEach((change) => {
        const { item } = change;
        if (change.type === 'changed') {
          lines.push(`🟨 แก้ ${nameOf(item)} ${formatQty(change.oldQty)} → **${qtyText(item)}**`);
          const note = noteLine(item);
          if (note) lines.push(note);
        } else if (change.type === 'noteChanged') {
          lines.push(`🟨 แก้หมายเหตุ ${nameOf(item)} **${qtyText(item)}**`);
          lines.push(noteOf(item) ? `　📝 ${noteOf(item)}` : '　📝 (ลบหมายเหตุ)');
        } else if (change.type === 'added') {
          lines.push(`🟩 เพิ่ม ${nameOf(item)} **${qtyText(item)}**`);
          const note = noteLine(item);
          if (note) lines.push(note);
        } else {
          lines.push(`🟥 ยกเลิก ~~${nameOf(item)} ${qtyText(item)}~~`);
        }
      });
  }

  if (unchanged.length > 0) {
    lines.push(DIVIDER);
    const list = unchanged
      .sort((a, b) => byThaiName(nameOf(a), nameOf(b)))
      .map((item) => `${nameOf(item)} ${qtyText(item)}`);
    lines.push(`ไม่เปลี่ยน: ${list.join(', ')}`);
  }
  return lines.join('\n');
};
