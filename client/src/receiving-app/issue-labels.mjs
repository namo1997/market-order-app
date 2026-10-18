export const issueTypes={shortage:'ของขาด',damaged:'ของเสีย',wrong_item:'ของผิด',return:'คืนของ',over:'ของเกิน'};
export const issueStatuses={open:'เปิดเรื่อง',waiting_supplier:'รอซัพพลายเออร์',resolved:'ปิดเรื่องแล้ว',cancelled:'ยกเลิก'};
export const issueResolutions={redelivered:'ส่งตามทีหลัง',new_bill:'ออกบิลใหม่',credit_note:'ลดหนี้ในรอบจ่าย',returned:'รับคืนแล้ว',written_off:'ตัดสูญ'};
export const canManageIssues=user=>['admin','super_admin','accounting','accountant'].includes(user?.role);
export const issueTime=value=>new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
export const localDue=value=>{const date=new Date(new Date(value).getTime()+7*3600000);return date.toISOString().slice(0,16);};
export const issueAge=(value,now=Date.now())=>Math.max(0,Math.floor((now-Date.parse(value))/86400000));

// Automatic bill requests have no confirmed price; zero is storage compatibility.
export const issueAmount = issue => issue.type === 'wrong_item' && issue.note?.startsWith('ไม่มีในบิล') && Number(issue.amount) === 0 ? 'รอตรวจราคา' : `${issue.amount} บาท`;
export const issueTypeLabel = issue => issue.type === 'wrong_item' && issue.note?.startsWith('ไม่มีในบิล') ? 'ไม่มีในบิล · ขอบิล' : issueTypes[issue.type];
