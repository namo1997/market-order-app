// วันที่ของรายงานยอดขายต้องเป็นวันไทยเสมอ ไม่ขึ้นกับ timezone ของเครื่องที่เปิด
const DAY_MS = 86_400_000;

export const bangkokDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(now);

const toMs = (ymd) => Date.parse(`${ymd}T00:00:00.000Z`);
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (ymd, days) => fromMs(toMs(ymd) + days * DAY_MS);
// month เป็น 0-based และติดลบได้ (Date.UTC เลื่อนข้ามปีให้เอง)
const monthStart = (year, month) => fromMs(Date.UTC(year, month, 1));
const monthEnd = (year, month) => fromMs(Date.UTC(year, month + 1, 0));

export const quickDateRange = (range, now = new Date()) => {
  const today = bangkokDate(now);
  const [year, monthNumber] = today.split('-').map(Number);
  const month = monthNumber - 1;
  switch (range) {
    case 'yesterday': {
      const day = addDays(today, -1);
      return { start: day, end: day };
    }
    case 'week': return { start: addDays(today, -6), end: today };
    case 'last30': return { start: addDays(today, -29), end: today };
    case 'month': return { start: monthStart(year, month), end: today };
    case 'lastmonth': return { start: monthStart(year, month - 1), end: monthEnd(year, month - 1) };
    // สามเดือนเต็มที่จบแล้ว เช่น เปิดเดือน พ.ย. = 1 ส.ค. – 31 ต.ค.
    case 'last3months': return { start: monthStart(year, month - 3), end: monthEnd(year, month - 1) };
    default: return { start: today, end: today };
  }
};

// ช่วงที่รวมวันนี้ = ยอดยังขายไม่จบวัน การเทียบกับช่วงก่อนหน้าจึงยังไม่ครบ
export const rangeIncludesToday = (end, now = new Date()) => Boolean(end) && end >= bangkokDate(now);
