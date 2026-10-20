// แจ้งเตือนแยกห้อง "ซัพอื่นๆ": ส่งเฉพาะรายการของกลุ่มสินค้าที่ระบุรหัสไว้
// เลือกด้วยรหัสกลุ่ม ไม่ใช่ชื่อ เพื่อให้แก้ชื่อกลุ่มได้โดยแจ้งเตือนไม่หาย
export const DEFAULT_OTHER_SUPPLIER_GROUP_CODES = ['SUP004', 'SUP006', 'SUP007', 'SUP008', 'SUP009'];

export const parseGroupCodes = (raw) => {
  const codes = String(raw ?? '')
    .split(/[\s,]+/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  return codes.length > 0 ? Array.from(new Set(codes)) : [...DEFAULT_OTHER_SUPPLIER_GROUP_CODES];
};

export const isDiscordWebhookUrl = (value) =>
  /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/\S+$/i.test(String(value || '').trim());

export const pickItemsByGroupIds = (items, groupIds) => {
  const ids = new Set(Array.from(groupIds || []).map((id) => Number(id)));
  return (Array.isArray(items) ? items : []).filter((item) => ids.has(Number(item?.supplier_id)));
};
