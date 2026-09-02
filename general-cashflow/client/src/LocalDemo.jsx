import {
  Banknote,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  FileCheck2,
  FileText,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  X
} from 'lucide-react';
import { useMemo, useState } from 'react';
import './localDemo.css';

const PDF_PATH = '/demo/general-cashflow-close-package-with-evidence-2026-08-05.pdf';

const evidence = [
  { id: 'STORE-01', group: 'หน้าร้าน', title: 'ใบนับเงินและสรุปยอดเงินสด', file: 'store-01.png', note: 'ยืนยันเงินสดที่นับได้ 23,689.00 บาท' },
  { id: 'STORE-02', group: 'หน้าร้าน', title: 'รูปสรุปรวมหน้าร้าน 1', file: 'store-02.png', note: 'ยอด QR กสิกร 36,590.80 บาท' },
  { id: 'STORE-03', group: 'หน้าร้าน', title: 'รูปสรุปรวมหน้าร้าน 2', file: 'store-03.png', note: 'ยอด QR กรุงศรี 1,279.00 บาท' },
  { id: 'STORE-04', group: 'หน้าร้าน', title: 'รูปสรุปรวมหน้าร้าน 3', file: 'store-04.png', note: 'ยอด GRAB food 6,411.00 บาท' },
  { id: 'STORE-05', group: 'หน้าร้าน', title: 'สรุปบัตรเครดิตหน้าร้าน', file: 'store-05.png', note: 'ตรวจสลิป SCB และ KTC ก่อนจับคู่ Statement' },
  { id: 'STORE-06', group: 'หน้าร้าน', title: 'บิลจ่ายอื่น ๆ 1', file: 'store-06.png', note: 'เอกสารประกอบรายการอื่นของวันปิดยอด' },
  { id: 'STORE-07', group: 'หน้าร้าน', title: 'บิลจ่ายอื่น ๆ 2', file: 'store-07.png', note: 'เอกสารประกอบรายการอื่นเพิ่มเติม' },
  { id: 'MATCH-01', group: 'Statement', title: 'บัตรเครดิต SCB', file: 'match-01.png', note: 'ยอดสุทธิ 2,474.97 บาท' },
  { id: 'MATCH-02', group: 'Statement', title: 'บัตรเครดิต KTC', file: 'match-02.png', note: 'ยอดสุทธิ 795.05 บาท' },
  { id: 'MATCH-03', group: 'Statement', title: 'รายงาน QR กสิกร', file: 'match-03.png', note: 'ยอดรับ 36,590.80 บาท' },
  { id: 'MATCH-04', group: 'Statement', title: 'รายงาน GRAB food', file: 'match-04.png', note: 'ยอดสุทธิ 4,982.77 บาท' },
  { id: 'MATCH-05', group: 'Statement', title: 'QR กรุงศรี / PromptPay', file: 'match-05.png', note: 'ยอดรับ 1,279.00 บาท' }
];

const channels = [
  ['บัตรเครดิต SCB', '2,543.00', '-68.03', '2,474.97'],
  ['บัตรเครดิต KTC', '816.00', '-20.95', '795.05'],
  ['QR กสิกร', '36,590.80', '0.00', '36,590.80'],
  ['GRAB food', '6,411.00', '-1,428.23', '4,982.77'],
  ['QR กรุงศรี', '1,279.00', '0.00', '1,279.00'],
  ['อื่น ๆ', '442.00', '0.00', '442.00'],
  ['เงินสด', '23,689.00', '0.00', '23,689.00']
];

const stepLabels = ['ตรวจยอด', 'ตรวจหลักฐาน', 'ปิดและสร้าง PDF'];

function LocalDemo() {
  const [reviewed, setReviewed] = useState(new Set());
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const [checked, setChecked] = useState(false);
  const [closed, setClosed] = useState(false);
  const [varianceReason, setVarianceReason] = useState('เงินเกินจากการปัดเศษ/การนับหน้าร้าน รอตรวจทานโดยผู้อนุมัติ');
  const [confirmClose, setConfirmClose] = useState(false);

  const reviewedCount = reviewed.size;
  const allReviewed = reviewedCount === evidence.length;
  const currentStep = closed ? 3 : checked ? 2 : allReviewed ? 2 : 1;

  const summaryStatus = useMemo(() => {
    if (closed) return { label: 'CLOSED', text: 'ปิดเอกสารจำลองแล้ว', className: 'is-closed' };
    if (checked) return { label: 'CHECKED', text: 'ตรวจยอดครบ รอปิดเอกสาร', className: 'is-checked' };
    return { label: 'REVIEW', text: 'กำลังตรวจหลักฐาน', className: 'is-review' };
  }, [checked, closed]);

  const markReviewed = (item) => {
    setReviewed((current) => {
      const next = new Set(current);
      next.add(item.id);
      return next;
    });
    setSelectedEvidence(item);
  };

  const markAllReviewed = () => setReviewed(new Set(evidence.map((item) => item.id)));

  const reset = () => {
    setReviewed(new Set());
    setSelectedEvidence(null);
    setChecked(false);
    setClosed(false);
    setConfirmClose(false);
  };

  return (
    <main className="local-demo-shell">
      <header className="demo-topbar">
        <div className="demo-brand">
          <span className="demo-brand-mark"><Banknote size={22} /></span>
          <div>
            <strong>General Cashflow</strong>
            <small>Daily close sandbox</small>
          </div>
        </div>
        <div className="local-badge"><LockKeyhole size={15} /> LOCAL DEMO · ไม่ส่งข้อมูลออก</div>
      </header>

      <section className="demo-hero">
        <div>
          <p className="eyebrow">ทดลองปิดยอด 1 วัน</p>
          <h1>สาขาคันคลอง · 5 สิงหาคม 2569</h1>
          <p>ตรวจเอกสารจริง 12 รายการ กระทบยอด และสร้างชุด PDF หน้าสรุปตามด้วยหลักฐาน 2 รายการต่อ A4</p>
        </div>
        <div className={`demo-status ${summaryStatus.className}`}>
          <span>{summaryStatus.label}</span>
          <small>{summaryStatus.text}</small>
        </div>
      </section>

      <ol className="demo-steps" aria-label="ขั้นตอนจำลองปิดยอด">
        {stepLabels.map((label, index) => {
          const step = index + 1;
          const done = currentStep > step || closed;
          const active = currentStep === step && !closed;
          return (
            <li key={label} className={`${done ? 'done' : ''} ${active ? 'active' : ''}`}>
              <span>{done ? <Check size={16} /> : step}</span>
              <strong>{label}</strong>
              {index < stepLabels.length - 1 && <ChevronRight size={16} />}
            </li>
          );
        })}
      </ol>

      <div className="demo-layout">
        <aside className="demo-sidebar">
          <section className="demo-card summary-card">
            <div className="card-title"><ShieldCheck size={18} /><h2>ผลกระทบยอด</h2></div>
            <dl className="money-summary">
              <div><dt>ยอดขาย POS</dt><dd>64,769.60</dd></div>
              <div><dt>เงินทอนตอนเช้า</dt><dd>7,000.00</dd></div>
              <div className="total"><dt>ยอดที่ควรรับ</dt><dd>71,769.60</dd></div>
              <div><dt>ยอดแคชเชียร์ส่ง</dt><dd>71,773.80</dd></div>
              <div className="variance"><dt>ส่วนต่าง</dt><dd>+4.20</dd></div>
              <div><dt>เงินเข้าสุทธิ</dt><dd>70,253.59</dd></div>
            </dl>
            <div className="formula-note">
              <strong>สูตรตรวจสอบ</strong>
              <span>70,253.59 + 1,517.21 + 3.00</span>
              <b>= 71,773.80 บาท</b>
            </div>
          </section>

          <section className="demo-card action-card">
            <div className="card-title"><FileCheck2 size={18} /><h2>การอนุมัติ</h2></div>
            <label className="demo-field">
              <span>เหตุผลส่วนต่าง +4.20 บาท</span>
              <textarea value={varianceReason} onChange={(event) => setVarianceReason(event.target.value)} disabled={closed} />
            </label>

            {!allReviewed && (
              <button className="demo-button secondary" onClick={markAllReviewed}>
                <Eye size={17} /> ทำเครื่องหมายว่าตรวจครบทั้ง 12 รายการ
              </button>
            )}
            {!checked && (
              <button
                className="demo-button primary"
                disabled={!allReviewed || !varianceReason.trim()}
                onClick={() => setChecked(true)}
              >
                <CheckCircle2 size={17} /> ยืนยันตรวจยอดทั้งหมด
              </button>
            )}
            {checked && !closed && (
              <>
                <label className="close-confirm">
                  <input type="checkbox" checked={confirmClose} onChange={(event) => setConfirmClose(event.target.checked)} />
                  <span>ยืนยันว่าเป็นการปิดยอดในโหมดจำลองเท่านั้น</span>
                </label>
                <button className="demo-button close" disabled={!confirmClose} onClick={() => setClosed(true)}>
                  <LockKeyhole size={17} /> ปิดเอกสารและสร้าง PDF
                </button>
              </>
            )}
            {closed && (
              <div className="closed-actions">
                <a className="demo-button download" href={PDF_PATH} download>
                  <Download size={17} /> ดาวน์โหลด PDF ตัวอย่าง
                </a>
                <button className="demo-button secondary" onClick={reset}><RefreshCw size={17} /> เริ่มจำลองใหม่</button>
              </div>
            )}
            <p className="local-note">ไม่มีการเขียนฐานข้อมูล ไม่มีการเรียก API และไม่เปลี่ยนสถานะวันจริง</p>
          </section>
        </aside>

        <section className="demo-main">
          <section className="demo-card channel-card">
            <div className="card-title-row">
              <div className="card-title"><FileText size={18} /><h2>กระทบยอดรายช่องทาง</h2></div>
              <span className="match-pill"><Check size={14} /> ตรงกับยอดส่ง</span>
            </div>
            <div className="channel-table" role="table" aria-label="กระทบยอดรายช่องทาง">
              <div className="channel-row head" role="row">
                <span>ช่องทาง</span><span>ก่อนหัก</span><span>รายการหัก</span><span>เงินเข้าสุทธิ</span>
              </div>
              {channels.map((row) => (
                <div className="channel-row" role="row" key={row[0]}>
                  {row.map((cell, index) => <span key={cell} className={index ? 'number' : ''}>{cell}</span>)}
                </div>
              ))}
              <div className="channel-row total" role="row">
                <strong>รวม</strong><strong className="number">71,770.80</strong><strong className="number">-1,517.21</strong><strong className="number">70,253.59</strong>
              </div>
            </div>
          </section>

          <section className="demo-card evidence-card">
            <div className="card-title-row">
              <div className="card-title"><FileCheck2 size={18} /><h2>หลักฐานแนบ</h2></div>
              <div className="evidence-progress"><b>{reviewedCount}/{evidence.length}</b><span>ตรวจแล้ว</span></div>
            </div>
            <div className="progress-track"><span style={{ width: `${(reviewedCount / evidence.length) * 100}%` }} /></div>
            <div className="evidence-grid">
              {evidence.map((item) => {
                const isReviewed = reviewed.has(item.id);
                return (
                  <button className={`evidence-item ${isReviewed ? 'reviewed' : ''}`} key={item.id} onClick={() => markReviewed(item)}>
                    <span className="evidence-thumb"><img src={`/demo/evidence/${item.file}`} alt="" /></span>
                    <span className="evidence-copy">
                      <small>{item.id} · {item.group}</small>
                      <strong>{item.title}</strong>
                      <em>{item.note}</em>
                    </span>
                    <span className="review-state">{isReviewed ? <Check size={16} /> : <Eye size={16} />}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {closed && (
            <section className="demo-card pdf-card">
              <div className="card-title-row">
                <div className="card-title"><FileText size={18} /><h2>ชุดเอกสารที่สร้างแล้ว</h2></div>
                <span className="pdf-pages">7 หน้า A4</span>
              </div>
              <p>หน้าแรกเป็นสรุปปิดยอด หน้า 2-7 เป็นหลักฐานแนบหน้าละ 2 รายการ</p>
              <iframe title="ตัวอย่าง PDF ปิดยอด" src={`${PDF_PATH}#view=FitH`} />
            </section>
          )}
        </section>
      </div>

      {selectedEvidence && (
        <div className="evidence-modal" role="dialog" aria-modal="true" aria-label={selectedEvidence.title} onClick={() => setSelectedEvidence(null)}>
          <div className="evidence-modal-panel" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><small>{selectedEvidence.id} · {selectedEvidence.group}</small><h2>{selectedEvidence.title}</h2></div>
              <button aria-label="ปิด" onClick={() => setSelectedEvidence(null)}><X size={20} /></button>
            </header>
            <img src={`/demo/evidence/${selectedEvidence.file}`} alt={selectedEvidence.title} />
            <footer><CheckCircle2 size={17} /><span>ทำเครื่องหมายว่าตรวจเอกสารรายการนี้แล้ว</span></footer>
          </div>
        </div>
      )}
    </main>
  );
}

export default LocalDemo;
