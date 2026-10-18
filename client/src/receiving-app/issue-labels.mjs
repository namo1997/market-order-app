export const issueTypes={shortage:'ของขาด',damaged:'ของเสีย',wrong_item:'ของผิด',return:'คืนของ',over:'ของเกิน'};
export const issueStatuses={open:'เปิดเรื่อง',waiting_supplier:'รอซัพพลายเออร์',resolved:'ปิดเรื่องแล้ว',cancelled:'ยกเลิก'};
export const issueResolutions={redelivered:'ส่งตามทีหลัง',new_bill:'ออกบิลใหม่',credit_note:'ลดหนี้ในรอบจ่าย',returned:'รับคืนแล้ว',written_off:'ตัดสูญ'};
export const canManageIssues=user=>['admin','super_admin','accounting','accountant'].includes(user?.role);
export const issueTime=value=>new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
export const localDue=value=>{const date=new Date(new Date(value).getTime()+7*3600000);return date.toISOString().slice(0,16);};
export const issueAge=(value,now=Date.now())=>Math.max(0,Math.floor((now-Date.parse(value))/86400000));

// Automatic bill requests have no confirmed price; zero is storage compatibility.
export const issueAmount = issue => (isBillRequest(issue) || issue.type === 'return') && Number(issue.amount) === 0 ? 'รอราคา' : `${issue.amount} บาท`;
export const issueTypeLabel = issue => isBillRequest(issue) ? 'ขอบิล' : issueTypes[issue.type];

export const isBillRequest = issue => issue.type === 'wrong_item' && (Boolean(issue.request_items) || issue.note?.startsWith('ไม่มีในบิล') || issue.auto_key === `auto-${issue.document_id}-bill-request`);
export const issueQuantity = issue => `${compactNumber(issue.quantity)} ${issue.unit_text || issue.receipt_line?.unit_text || 'หน่วย'}`;
export const compactNumber = value => value == null ? 'ไม่ทราบจำนวน' : String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
export const receiptDecisionLabels = {accept:'รับครบ',short:'รับของและแจ้งร้านว่าขาด',over:'รับของเกินบิล',wrong_product:'ตรวจสินค้าไม่ตรง',price_review:'ให้บัญชีตรวจราคา',missing_bill:'รับของและให้บัญชีขอบิล',not_received:'ไม่รับและคืนร้าน'};
export function receiptExplanation(issue) {
  const line = issue.receipt_line;
  if (!line) return '';
  const quantity = key => `${compactNumber(line[key])}${line[key] == null ? '' : ` ${issue.unit_text || line.unit_text || 'หน่วย'}`}`;
  return `นับได้ ${quantity('counted_quantity')} · รับจริง ${quantity('quantity_received')} · ในบิล ${quantity('quantity_billed')}${line.review_decision ? ` · ${receiptDecisionLabels[line.review_decision] || 'ตรวจรายการแล้ว'}` : ''}`;
}
export const evidenceAction = issue => issue.type === 'return' ? 'บันทึกการคืน (รูป + ลายเซ็นคนมารับ)' : issue.type === 'shortage' || isBillRequest(issue) ? 'ร้านส่งของ/บิลมาแล้ว' : 'แนบหลักฐาน';
export const canAttachIssue = (user,issue) => canManageIssues(user) || (Number(user?.branch_id) === Number(issue.branch_id) && (['return','shortage'].includes(issue.type) || isBillRequest(issue)));
