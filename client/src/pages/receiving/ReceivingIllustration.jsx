import welcome from '../../assets/illustrations/welcome.webp';
import emptyToday from '../../assets/illustrations/empty-today.webp';
import captureBill from '../../assets/illustrations/capture-bill.webp';
import readingBill from '../../assets/illustrations/reading-bill.webp';
import reviewLines from '../../assets/illustrations/review-lines.webp';
import sign from '../../assets/illustrations/sign.webp';
import receivedSuccess from '../../assets/illustrations/received-success.webp';
import offline from '../../assets/illustrations/offline.webp';
import error from '../../assets/illustrations/error.webp';
import notABill from '../../assets/illustrations/not-a-bill.webp';
import countEmpty from '../../assets/illustrations/count-empty.webp';

// Alt text follows assets/illustrations/README.md. The existing 480px files
// already cover 2x at 240 CSS px; there are no separate 1x/2x files to srcset.
const illustrations = {
  welcome: [welcome, 'พนักงานร้านอาหารสองวัยต้อนรับพร้อมลังผักและใบส่งของ', 'พร้อมรับของเช้านี้', 'กำลังโหลดรายการรับสินค้า'],
  'empty-today': [emptyToday, 'ลังรับของว่างและใบส่งของในยามเช้า', 'ยังไม่มีของเข้าวันนี้', 'เริ่มจากสร้างใบรับแล้วถ่ายบิลใบแรก'],
  'capture-bill': [captureBill, 'สองมือประคองโทรศัพท์แนวนอนถ่ายใบส่งของบนโต๊ะข้างผักและตะกร้า', 'ถ่ายบิลให้ชัด', 'วางบิลราบ ให้เห็นครบทั้งใบ'],
  'reading-bill': [readingBill, 'กรอบอ่านใบส่งของสามแถวข้างลังผักและตาชั่งตลาด', 'กำลังอ่านบิล', 'รอสักครู่ แล้วตรวจรายการอีกครั้ง'],
  'review-lines': [reviewLines, 'มือชี้ตรวจจำนวนในใบส่งของข้างตะกร้าวัตถุดิบ', 'ตรวจรายการและจำนวน', 'ผลอ่านบิลเป็นข้อเสนอ แก้ไขได้'],
  sign: [sign, 'พนักงานใช้ปากกาเซ็นใบส่งของข้างลังผัก', 'เซ็นรับของ', 'ตรวจชื่อผู้รับก่อนบันทึก'],
  'received-success': [receivedSuccess, 'ลังวัตถุดิบและใบส่งของพร้อมเครื่องหมายถูกสีเขียว', 'รับของเรียบร้อย', 'ระบบยืนยันใบรับแล้ว'],
  offline: [offline, 'เอกสารในมือถือพร้อมป้ายโทรศัพท์มีเครื่องหมายถูก และป้ายไวไฟขีดทับแยกกัน', 'ไม่มีอินเทอร์เน็ต', 'เปิดหน้านี้ไว้ ข้อมูลที่ยังไม่ส่งอาจหายหากปิดหน้า'],
  error: [error, 'ใบส่งของพร้อมเครื่องหมายเตือนและลูกศรลองใหม่', 'ลองใหม่อีกครั้ง', 'ตรวจการเชื่อมต่อ แล้วลองใหม่'],
  'not-a-bill': [notABill, 'สลิปสั้นมีคิวอาร์เล็กเทียบกับใบส่งของยาวสามรายการ พร้อมคำถามอำพันหนึ่งจุด', 'ภาพนี้อาจไม่ใช่บิล', 'ยังอ่านรายการไม่ได้ ถ่ายใบส่งของที่มีรายการสินค้า'],
  // Owner 2026-10-24: the count step with no line yet invites counting; it is not an error (no amber, no red).
  'count-empty': [countEmpty, 'ลังรับของเปิดอยู่ มีถุง กล่อง และผักวางข้าง กับมือถือคลิปบอร์ดเปล่า', 'ยังไม่มีรายการ', ''],
};

// This helper owns no buttons: the existing fixed bar remains the only primary
// action. Illustrations are static in both OS and app reduced-motion modes.
export function ReceivingIllustration({ state, title, description, eager = false, compact = false, supporting = false, pending = false }) {
  const [src, alt, heading, copy] = illustrations[state];
  const reading = state === 'reading-bill' || (state === 'welcome' && pending);
  return <section className={`rc-illustration${compact ? ' rc-illustration--compact' : ''}${supporting ? ' rc-illustration--supporting' : ''}`}
    data-illustration={state} role={reading ? 'status' : state === 'error' ? 'alert' : undefined} aria-busy={reading || undefined}>
    <img src={src} alt={alt} width="480" height="480" decoding="async" loading={eager ? 'eager' : 'lazy'} />
    <div><h2>{title || heading}</h2><p>{description ?? copy}</p></div>
  </section>;
}
