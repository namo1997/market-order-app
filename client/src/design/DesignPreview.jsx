import { useState } from 'react';
import { GlassBar, PrimaryAction, IconButton, Sheet, Segmented, StatusPill, ListCard, NumberField, EmptyState, Toast } from './components';
import { Icon, iconNames } from './icons';
import './preview.css';
import tokenSource from './tokens.css?raw';

const themeOptions = [
  { value: 'auto', label: 'อัตโนมัติ' },
  { value: 'light', label: 'สว่าง' },
  { value: 'dark', label: 'มืด' },
];
const iconLabels = ['กล้อง', 'บิล', 'สแกน', 'รับของ', 'รายการ', 'แก้ไข', 'ลายเซ็น', 'ยืนยัน', 'รอตรวจ', 'ผิดพลาด', 'ลบ', 'เพิ่ม', 'ค้นหา', 'ร้านค้า', 'วันที่', 'ออฟไลน์', 'ลองใหม่', 'ย้อนกลับ', 'ปิด', 'ธีม'];

function ReceivingSample({ theme }) {
  const [tab, setTab] = useState('review');
  const [quantity, setQuantity] = useState('12.00');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toastOpen, setToastOpen] = useState(true);
  return <section className="solao sg-demo-phone" data-theme={theme} aria-label={`ตัวอย่างธีม${theme === 'light' ? 'สว่าง' : 'มืด'}`}>
    <header className="sg-demo-header"><div><span className="sg-demo-eyebrow">SOLAO</span><h2>รับสินค้า</h2></div>
      <Icon name="box" size={28} />
    </header>
    <div className="sg-demo-content">
      <Segmented label="เอกสารรับสินค้า" value={tab} onChange={setTab} options={[
        { value: 'review', label: 'รอตรวจ' }, { value: 'done', label: 'รับแล้ว' },
      ]} />
      <div className="sg-demo-date"><span>15 ตุลาคม 2569</span><span>{theme === 'light' ? 'สว่าง' : 'มืด'}</span></div>
      {tab === 'review' ? <>
        <ListCard title="ร้านผักป้าดา" subtitle="บิล 00128" leading={<Icon name="supplier" />} trailing={<StatusPill status="review" />}>
          <div className="sg-demo-total"><span>ยอดรวม</span><strong>1,280.00 <small>บาท</small></strong></div>
        </ListCard>
        <ListCard title="มะเขือเทศ" subtitle="สั่ง 12 กก." leading={<Icon name="box" />} trailing={<StatusPill status="ok">ตรงกัน</StatusPill>}>
          <NumberField label="รับจริง" value={quantity} onValueChange={setQuantity} unit="กก." />
        </ListCard>
        <Toast open={toastOpen} onDismiss={() => setToastOpen(false)}>บันทึกฉบับร่างแล้ว</Toast>
      </> : <EmptyState title="ยังไม่มีบิล" description="บิลที่รับแล้วจะอยู่ที่นี่" />}
    </div>
    <GlassBar inline>
      <IconButton icon="receipt" label="ดูบิล" onClick={() => setTab(tab === 'review' ? 'done' : 'review')} />
      <PrimaryAction icon="scan" onClick={() => setSheetOpen(true)}>ตรวจบิล</PrimaryAction>
    </GlassBar>
    <Sheet open={sheetOpen} onDismiss={() => setSheetOpen(false)} title="จำนวนที่รับ"
      actions={<PrimaryAction onClick={() => { setSheetOpen(false); setToastOpen(true); }}>บันทึก</PrimaryAction>}>
      <NumberField label="มะเขือเทศ" value={quantity} onValueChange={setQuantity} unit="กก." />
    </Sheet>
  </section>;
}

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
  const [theme, setTheme] = useState('auto');
  const [badValue, setBadValue] = useState('-1');
  return <main className="solao sg-preview" data-theme={theme} lang="th">
    <div className="sg-preview-shell">
      <header className="sg-preview-heading">
        <div><p className="sg-demo-eyebrow">SOLAO GLASS <span aria-hidden="true" className="sg-brand-mark" /></p>
          <h1>ชัดในทุกการรับ</h1><p>ระบบออกแบบสำหรับคนหน้าร้าน</p></div>
        <div className="sg-theme-control"><Segmented label="ธีมตัวอย่าง" value={theme} onChange={setTheme} options={themeOptions} /></div>
      </header>
      <div className="sg-preview-phones"><ReceivingSample theme="light" /><ReceivingSample theme="dark" /></div>
      <section className="sg-preview-section" aria-label="สีและสถานะ"><h2>สีที่มีความหมาย</h2>
        <div className="sg-preview-grid"><TokenSample theme="light" /><TokenSample theme="dark" /></div>
        <p className="sg-preview-note">Navy #1E3168 / Gold #C8941C / Cream #F7F5F0</p>
      </section>
      <section className="sg-preview-section"><h2>ครบทุกสถานะ</h2><div className="sg-preview-grid">
        <div className="sg-specimen-stack"><PrimaryAction busy>กำลังบันทึก</PrimaryAction><PrimaryAction disabled>ยืนยัน</PrimaryAction>
          <NumberField label="จำนวน" value={badValue} onValueChange={setBadValue} error="จำนวนต้องมากกว่าศูนย์" unit="กก." />
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
          <p style={{ fontSize: 'var(--sg-type-heading)', fontWeight: 700 }}>รับสินค้า 28 / 700</p>
          <p style={{ fontSize: 'var(--sg-type-title)', fontWeight: 600 }}>ตรวจบิล 22 / 600</p>
          <p style={{ fontWeight: 500 }}>เนื้อหา 16 / 500</p>
          <p style={{ fontSize: 'var(--sg-type-caption)' }}>คำกำกับ 15 / 400</p>
          <p style={{ fontSize: 'var(--sg-type-number)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>1,280.00</p>
        </div><div className="sg-specimen-stack">
          <div className="sg-spacing-samples">{[1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => <div key={n}><span style={{ width: `var(--sg-space-${n})` }} /><code>{n * 4}px</code></div>)}</div>
          <div className="sg-radius-samples">{['sm', 'md', 'lg', 'pill'].map(radius => <span key={radius} style={{ borderRadius: `var(--sg-radius-${radius})` }}>{radius}</span>)}</div>
        </div>
      </div>
      <details className="sg-token-details"><summary>ค่าพื้นผิวและการเคลื่อนไหว</summary>
        <dl><dt>กระจก</dt><dd>Blur 24px / tint 86–89% / ขอบแสง / เงานุ่ม</dd>
          <dt>จังหวะ</dt><dd>140 / 260 / 360ms / spring cubic-bezier(.2, .85, .25, 1.15)</dd>
          <dt>ลำดับชั้น</dt><dd>เนื้อหา 0 / แถบล่าง 20 / Toast 40 / Sheet 60 + native top layer</dd>
          <dt>ระยะปลอดภัย</dt><dd>safe-area ทั้ง 4 ด้าน / เป้าแตะ 48px / ปุ่มหลัก 56px</dd>
          <dt>ทางเลือก</dt><dd>กระจกทึบเมื่อไม่รองรับ / ลดการเคลื่อนไหวตามเครื่อง</dd>
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
