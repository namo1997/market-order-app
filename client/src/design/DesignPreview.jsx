import { useState, useSyncExternalStore } from 'react';
import { GlassBar, PrimaryAction, IconButton, Sheet, Segmented, StatusPill, ListCard, NumberField, EmptyState, Toast, MotionSwitch, useMotionPreference } from './components';
import { Icon, iconNames } from './icons';
import './preview.css';
import tokenSource from './tokens.css?raw';
import ReceiptExample from './ReceiptExample';
import { withSavingFeedback } from './motion-preference';
import { validateSampleQuantity } from './sample-quantity';

const themeOptions = [
  { value: 'auto', label: 'อัตโนมัติ' },
  { value: 'light', label: 'สว่าง' },
  { value: 'dark', label: 'มืด' },
];
const iconLabels = ['กล้อง', 'บิล', 'สแกน', 'รับของ', 'รายการ', 'แก้ไข', 'ลายเซ็น', 'ยืนยัน', 'รอตรวจ', 'ผิดพลาด', 'ลบ', 'เพิ่ม', 'ค้นหา', 'ร้านค้า', 'วันที่', 'ออฟไลน์', 'ลองใหม่', 'ย้อนกลับ', 'ปิด', 'ธีม'];

function ReceivingSample({ theme, motion, onMotionChange, mobile = false }) {
  const [tab, setTab] = useState('review');
  const [quantity, setQuantity] = useState('12.00');
  const [sheetQuantity, setSheetQuantity] = useState(quantity);
  const sheetValidation = validateSampleQuantity(sheetQuantity);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const validation = validateSampleQuantity(quantity);
  const changeQuantity = value => { setQuantity(value); setToastOpen(false); };
  return <section className={`solao sg-demo-phone ${mobile ? 'sg-demo-mobile sg-with-bar' : ''}`} data-theme={theme} data-motion={motion} aria-label="ตัวอย่างรับสินค้า">
    <header className="sg-demo-header"><div><span className="sg-demo-eyebrow">SOLAO</span><h2>รับสินค้า</h2></div>
      <Icon name="box" size={28} />
    </header>
    {mobile && <details className="sg-display-settings"><summary>การแสดงผล</summary><MotionSwitch value={motion} onChange={onMotionChange} /></details>}
    <div className="sg-demo-content">
      <Segmented sticky={mobile} label="เอกสารรับสินค้า" value={tab} onChange={setTab} options={[
        { value: 'review', label: 'รอตรวจ' }, { value: 'done', label: 'รับแล้ว' },
      ]} />
      <div className="sg-demo-date">15 ตุลาคม 2569</div>
      {tab === 'review' ? <>
        <section className="sg-demo-summary" aria-label="สรุปบิล">
          <div><h3>ร้านผักป้าดา</h3><p>บิล 00128</p></div><StatusPill status="review" />
          <div className="sg-demo-total"><span>ยอดรวม</span><strong>1,280.00 <small>บาท</small></strong></div>
        </section>
        <ListCard title="มะเขือเทศ" subtitle="สั่ง 12 กก." leading={<Icon name="box" />}
          trailing={<span aria-live="polite"><StatusPill status={validation.status}>{validation.label}</StatusPill></span>}>
          <NumberField label="รับจริง" value={quantity} onValueChange={changeQuantity} unit="กก." error={validation.error} />
        </ListCard>
        <Toast open={toastOpen} onDismiss={() => setToastOpen(false)}>บันทึกฉบับร่างตัวอย่างแล้ว</Toast>
        {mobile && <div className="sg-demo-items" aria-label="รายการในบิลตัวอย่าง">
          {['แตงกวา', 'คะน้า', 'ผักบุ้ง', 'กะหล่ำปลี', 'ต้นหอม', 'ผักชี', 'มะนาว', 'พริกสด'].map((name, index) =>
            <ListCard key={name} title={name} subtitle={`สั่ง ${index + 1} กก.`} leading={<Icon name="box" />}
              trailing={<StatusPill status="review" />} />)}
          <p className="sg-preview-note">ครบ 9 รายการ</p>
        </div>}
      </> : <EmptyState title="ยังไม่มีบิล" description="บิลที่รับแล้วจะอยู่ที่นี่" />}
    </div>
    <GlassBar inline={!mobile}>
      <IconButton icon="receipt" label="ดูบิล" onClick={() => setReceiptOpen(true)} />
      <PrimaryAction icon="edit" disabled={tab !== 'review'} onClick={() => { setSheetQuantity(quantity); setSheetOpen(true); }}>แก้จำนวน</PrimaryAction>
    </GlassBar>
    <Sheet open={sheetOpen} onDismiss={() => setSheetOpen(false)} title="จำนวนที่รับ"
      actions={<PrimaryAction disabled={Boolean(sheetValidation.error)} onClick={() => { changeQuantity(sheetQuantity); setSheetOpen(false); setToastOpen(true); }}>บันทึกตัวอย่าง</PrimaryAction>}>
      <NumberField label="มะเขือเทศ" value={sheetQuantity} onValueChange={setSheetQuantity} unit="กก." error={sheetValidation.error} />
    </Sheet>
    <Sheet open={receiptOpen} onDismiss={() => setReceiptOpen(false)} title="บิลตัวอย่าง">
      <ReceiptExample />
    </Sheet>
  </section>;
}

function CriticalFlowSample() {
  const [status, setStatus] = useState('draft');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    await withSavingFeedback(() => undefined);
    setStatus(status === 'draft' ? 'confirmed' : 'void');
    setBusy(false);
  };
  return <div className="sg-demo-flow">
    <p role="status">{status === 'draft' ? 'ตัวอย่างใบรับ รอยืนยัน' : status === 'confirmed' ? 'ยืนยันรับสินค้าแล้ว' : 'ยกเลิกเอกสารแล้ว'}</p>
    {status !== 'void' && <PrimaryAction busy={busy} busyLabel="กำลังบันทึก…" className={status === 'confirmed' ? 'sg-destructive' : ''} onClick={save}>
      {status === 'draft' ? 'ยืนยัน' : 'ยกเลิกเอกสาร'}</PrimaryAction>}
  </div>;
}

const subscribeViewport = callback => {
  const media = window.matchMedia('(max-width: 700px)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const mobileViewport = () => window.matchMedia('(max-width: 700px)').matches;
const serverViewport = () => false;

// Read the CSS source for the reference table so its values cannot drift from tokens.css.
const declarations = block => Object.fromEntries([...block.matchAll(/(--sg-[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]]));
const lightTokens = declarations(tokenSource.match(/\.solao \{([^}]+)\}/)[1]);
const darkTokens = { ...lightTokens, ...declarations(tokenSource.match(/\.solao\[data-theme='dark'\] \{([^}]+)\}/)[1]) };

const colors = [
  ['พื้นหลัง', '--sg-bg'], ['เนื้อหา', '--sg-surface'], ['ตัวหนังสือ', '--sg-text'],
  ['ข้อความรอง', '--sg-muted'], ['ปุ่มหลัก', '--sg-action'], ['ขอบควบคุม', '--sg-control-border'],
  ['ปกติ', '--sg-ok'], ['รอตรวจ', '--sg-review'], ['ผิดพลาด', '--sg-error'],
];
function TokenSample({ theme }) {
  return <section className="solao sg-token-panel" data-theme={theme}>
    <h3>{theme === 'light' ? 'สว่าง' : 'มืด'}</h3>
    <div className="sg-swatches">{colors.map(([label, token]) => <div key={token} className="sg-swatch">
      <span style={{ background: `var(${token})` }} /><div>{label}<code>{token}</code></div>
    </div>)}</div>
    <div className="sg-demo-statuses"><StatusPill status="ok" /><StatusPill status="review" /><StatusPill status="error" /></div>
  </section>;
}

/** Standalone source entry: intentionally has no app route or backend calls. */
export default function DesignPreview() {
  const [motion, setMotion] = useMotionPreference();
  const [theme, setTheme] = useState('auto');
  const [badValue, setBadValue] = useState('-1');
  const narrow = useSyncExternalStore(subscribeViewport, mobileViewport, serverViewport);
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  if (params.get('view') === 'mobile' || (narrow && params.get('view') !== 'catalog')) {
    const mobileTheme = themeOptions.some(option => option.value === params.get('theme')) ? params.get('theme') : 'auto';
    return <main lang="th"><ReceivingSample theme={mobileTheme} motion={motion} onMotionChange={setMotion} mobile /></main>;
  }
  return <main className="solao sg-preview" data-theme={theme} data-motion={motion} lang="th">
    <div className="sg-preview-shell">
      <header className="sg-preview-heading">
        <div><p className="sg-demo-eyebrow">SOLAO GLASS <span aria-hidden="true" className="sg-brand-mark" /></p>
          <h1>ชัดในทุกการรับ</h1><p>ระบบออกแบบสำหรับคนหน้าร้าน</p></div>
        <div className="sg-theme-control"><Segmented label="ธีมตัวอย่าง" value={theme} onChange={setTheme} options={themeOptions} /><MotionSwitch value={motion} onChange={setMotion} /></div>
      </header>
      <nav className="sg-preview-links" aria-label="เปิดตัวอย่างเต็มจอ">
        <a href="?view=mobile&theme=light">ลองมือถือสว่าง <Icon name="back" /></a>
        <a href="?view=mobile&theme=dark">ลองมือถือมืด <Icon name="back" /></a>
      </nav>
      <div className="sg-preview-phones"><ReceivingSample theme="light" motion={motion} /><ReceivingSample theme="dark" motion={motion} /></div>
      <section className="sg-preview-section" aria-label="สีและสถานะ"><h2>สีที่มีความหมาย</h2>
        <div className="sg-preview-grid"><TokenSample theme="light" /><TokenSample theme="dark" /></div>
        <p className="sg-preview-note">Navy #1E3168 / Gold #C8941C / Cream #F7F5F0</p>
      </section>
      <section className="sg-preview-section"><h2>งานสำคัญ</h2><CriticalFlowSample /></section>
      <section className="sg-preview-section"><h2>ครบทุกสถานะ</h2><div className="sg-preview-grid">
        <div className="sg-specimen-stack"><PrimaryAction busy>กำลังบันทึก</PrimaryAction><PrimaryAction disabled>ยืนยัน</PrimaryAction>
          <NumberField label="จำนวน" value={badValue} onValueChange={setBadValue} error={validateSampleQuantity(badValue).error} unit="กก." />
          <NumberField label="ยอดรวม" value="1280.00" readOnly unit="บาท" hint="ตัวเลขคงค่าทศนิยมเป็นข้อความ" />
          <NumberField label="จำนวนที่ล็อก" value="12.00" disabled unit="กก." />
          <Toast status="error">บันทึกไม่สำเร็จ</Toast><Toast status="review">ตรวจยอดอีกครั้ง</Toast>
        </div><EmptyState title="เริ่มจากบิลแรก" description="ถ่ายรูป แล้วตรวจรายการ" icon="camera" />
      </div></section>
      <section className="sg-preview-section"><h2>ไอคอนเส้นเดียว</h2><div className="sg-icon-grid">
        {iconNames.map((name, index) => <div key={name}><Icon name={name} size={28} /><span>{iconLabels[index]}</span></div>)}
      </div></section>
      <section className="sg-preview-section"><h2>ตัวอักษรและจังหวะ</h2><div className="sg-preview-grid">
        <div className="sg-type-samples">
          <p style={{ fontSize: 'var(--sg-type-heading)', fontWeight: 700 }}>รับสินค้า / หัวข้อ</p>
          <p style={{ fontSize: 'var(--sg-type-title)', fontWeight: 600 }}>ตรวจบิล / ชื่อส่วน</p>
          <p style={{ fontWeight: 500 }}>เนื้อหา 1rem / 500</p>
          <p style={{ fontSize: 'var(--sg-type-caption)' }}>คำกำกับ .9375rem / 400</p>
          <p style={{ fontSize: 'var(--sg-type-number)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>1,280.00</p>
        </div><div className="sg-specimen-stack">
          <div className="sg-spacing-samples">{[1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => <div key={n}><span style={{ width: `var(--sg-space-${n})` }} /><code>{n * 4}px</code></div>)}</div>
          <div className="sg-radius-samples">{['sm', 'md', 'lg', 'pill'].map(radius => <span key={radius} style={{ borderRadius: `var(--sg-radius-${radius})` }}>{radius}</span>)}</div>
        </div>
      </div>
      <details className="sg-token-details"><summary>ค่าพื้นผิวและการเคลื่อนไหว</summary>
        <dl><dt>กระจก</dt><dd>แถบลอยเท่านั้น / blur 24px / tint 74–76% / ขอบชั้นเดียว</dd>
          <dt>จังหวะ</dt><dd>140 / 260 / 360ms / spring cubic-bezier(.2, .85, .25, 1.15)</dd>
          <dt>ลำดับชั้น</dt><dd>เนื้อหา 0 / แถบล่าง 20 / Toast 40 / Sheet 60 + native top layer</dd>
          <dt>ระยะปลอดภัย</dt><dd>safe-area ทั้ง 4 ด้าน / เป้าแตะ 48px / ปุ่มหลัก 56px</dd>
          <dt>ทางเลือก</dt><dd>กระจกทึบเมื่อไม่รองรับ / ลดการเคลื่อนไหวตามเครื่อง หรือเลือกเอง</dd>
        </dl>
      </details></section>
      <details className="sg-token-details"><summary>ค่าทั้งหมด {Object.keys(lightTokens).length} tokens</summary>
        <table className="sg-token-table"><thead><tr><th scope="col">Token</th><th scope="col">สว่าง</th><th scope="col">มืด</th></tr></thead>
          <tbody>{Object.keys(lightTokens).map(name => <tr key={name}><th scope="row"><code>{name}</code></th><td><code>{lightTokens[name]}</code></td><td><code>{darkTokens[name]}</code></td></tr>)}</tbody>
        </table>
      </details>
      <footer className="sg-preview-footer">IBM Plex Sans Thai / ฟอนต์ในแอป / ไม่เชื่อมข้อมูลจริง</footer>
    </div>
  </main>;
}
