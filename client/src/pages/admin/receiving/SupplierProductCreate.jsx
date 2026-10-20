import { useEffect, useRef, useState } from 'react';
import { emptyProductDraft, IMPORT_COLUMNS, parseProductSheet } from './supplier-product-import';
import { supplierErrorMessage } from './receiving-suppliers';

export function SupplierProductCreate({ actions, onChanged = () => {} }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(null);
  const [mode, setMode] = useState('single');
  const [draft, setDraft] = useState({ ...emptyProductDraft });
  const [sheet, setSheet] = useState('');
  const [group, setGroup] = useState('');
  const [departments, setDepartments] = useState([]);
  const [countable, setCountable] = useState(true);
  const [carryover, setCarryover] = useState(false);
  const [preview, setPreview] = useState(null);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const request = useRef(null);
  const lock = useRef(false);
  const revision = useRef(0);
  const invalidate = () => { revision.current++; setPreview(null); request.current = null; setNotice(''); setProblem(''); };
  useEffect(() => {
    if (!open || options || !actions.productOptions) return;
    let active = true;
    setBusy('options');
    actions.productOptions().then(data => { if (active) { setOptions(data); setGroup(String(data.default_group_id || '')); } })
      .catch(error => { if (active) { setProblem(supplierErrorMessage(error)); setOpen(false); } })
      .finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
  }, [open, options, actions]);
  const field = key => event => { invalidate(); setDraft(previous => ({ ...previous, [key]: event.target.value })); };
  const check = async event => {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy('preview'); setProblem(''); setNotice(''); setPreview(null);
    const version = revision.current;
    try {
      const rows = mode === 'single' ? [{ ...draft }] : parseProductSheet(sheet);
      const body = { rows, department_ids: departments, default_group_id: Number(group), is_countable: countable, allow_pending_carryover: carryover };
      const result = await actions.previewProducts(body);
      if (revision.current === version) { setPreview({ ...result, body }); request.current = crypto.randomUUID(); }
    } catch (error) { setProblem(error.response ? supplierErrorMessage(error) : error.message); }
    finally { lock.current = false; setBusy(''); }
  };
  const save = async () => {
    if (lock.current || !preview?.valid) return;
    lock.current = true; setBusy('save'); setProblem('');
    try {
      const result = await actions.createProducts({ ...preview.body, preview_hash: preview.preview_hash, request_id: request.current });
      invalidate(); setDraft({ ...emptyProductDraft }); setSheet('');
      setNotice(`เพิ่มสินค้า ${result.count} รายการ และผูกชื่อย่อกับร้านนี้แล้ว`); onChanged();
    } catch (error) { setProblem(supplierErrorMessage(error)); }
    finally { lock.current = false; setBusy(''); }
  };
  const readFile = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    invalidate();
    if (file.size > 100000) return setProblem('ไฟล์ต้องไม่เกิน 100 KB');
    try { const contents = await file.text(); parseProductSheet(contents); setSheet(contents); }
    catch (error) { setProblem(error.message); }
    event.target.value = '';
  };
  return <section className="ra-panel ra-product-create" aria-labelledby="ra-product-create-title">
    <h3 id="ra-product-create-title">เพิ่มสินค้าใหม่ให้ร้านนี้</h3>
    <p className="ra-note">เพิ่มสินค้า หน่วย แผนก และชื่อย่อในบิลพร้อมกัน · ถ้ามีสินค้าเดิมแล้ว ให้ผูกชื่อย่อด้านล่าง</p>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} disabled={Boolean(busy)}>{open ? 'ย่อแบบฟอร์ม' : '+ เพิ่มสินค้าใหม่ให้ร้านนี้'}</button>
    {notice && <p role="status" className="ra-ok">{notice}</p>}{problem && <p role="alert" className="ra-problem">{problem}</p>}
    {open && (busy === 'options' ? <p role="status">กำลังโหลดหน่วยและแผนก…</p> : options && <>
      {(!options.units.length || !options.groups.length || !options.departments.length) && <p role="alert" className="ra-problem">ยังไม่มีหน่วย กลุ่ม หรือแผนกที่เปิดใช้งานครบ กรุณาให้ผู้ดูแลตั้งค่าทะเบียนก่อนเพิ่มสินค้า</p>}
      <form className="ra-form" onSubmit={check}>
        <fieldset disabled={Boolean(busy)} className="ra-product-fields">
          <legend>ข้อมูลสินค้า</legend>
          <label>วิธีเพิ่ม<select value={mode} onChange={event => { invalidate(); setMode(event.target.value); }}><option value="single">ทีละรายการ</option><option value="sheet">นำเข้า CSV / วางจาก Excel</option></select></label>
          <label>กลุ่มสินค้าเริ่มต้น<select required value={group} onChange={event => { invalidate(); setGroup(event.target.value); }}><option value="">เลือกกลุ่มสินค้า</option>{options.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          <fieldset className="ra-product-departments"><legend>แผนกที่ใช้สินค้า (เลือกอย่างน้อย 1)</legend>
            {options.departments.map(dep => <label key={dep.id}><input type="checkbox" checked={departments.includes(Number(dep.id))} onChange={event => { invalidate(); setDepartments(previous => event.target.checked ? [...previous, Number(dep.id)] : previous.filter(id => id !== Number(dep.id))); }} />{dep.branch_name} · {dep.name}</label>)}
          </fieldset>
          <label className="ra-product-check"><input type="checkbox" checked={countable} onChange={event => { invalidate(); setCountable(event.target.checked); }} />นับสต๊อก (เพิ่มในแบบเช็คสต๊อกของแผนก)</label>
          <label className="ra-product-check"><input type="checkbox" checked={carryover} onChange={event => { invalidate(); setCarryover(event.target.checked); }} />อนุญาตยกยอดค้างรับ</label>
          {mode === 'single' ? <div className="ra-product-grid">
            <label>ชื่อสินค้า<input required maxLength={255} value={draft.name} onChange={field('name')} /></label>
            <label>หน่วย<select required value={draft.unit} onChange={field('unit')}><option value="">เลือกหน่วย</option>{options.units.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}</select></label>
            <label>ราคาเริ่มต้น (บาท)<input required inputMode="decimal" maxLength={10} value={draft.price} onChange={field('price')} placeholder="0.00" /></label>
            <label>ชื่อตามบิล<input maxLength={255} value={draft.bill_text} onChange={field('bill_text')} placeholder="เว้นว่างเพื่อใช้ชื่อสินค้า" /></label>
            <label>รหัสสินค้าในบิล (ถ้ามี)<input maxLength={40} autoComplete="off" value={draft.item_code} onChange={field('item_code')} placeholder="เช่น SYN-2010" /></label>
          </div> : <>
            <p className="ra-note">ใช้ UTF-8 พร้อมหัวคอลัมน์เรียงตามนี้: {IMPORT_COLUMNS.join(', ')} · กลุ่มเว้นว่างใช้กลุ่มเริ่มต้น · ราคาไม่ใส่คอมมา ไม่เกิน 2 ตำแหน่ง · ไม่เกิน 100 แถว</p>
            <label>เลือกไฟล์ CSV<input type="file" accept=".csv,text/csv" onChange={readFile} /></label>
            <label>วางตารางจาก Excel<textarea rows={7} maxLength={100000} value={sheet} onChange={event => { invalidate(); setSheet(event.target.value); }} placeholder={IMPORT_COLUMNS.join('\t')} /></label>
          </>}
          <p className="ra-note">ห้ามใส่เบอร์โทร เลขบัญชีธนาคาร หรือเลขภาษีในข้อมูลสินค้า</p>
          <button type="submit" className="ra-primary" disabled={!departments.length || !group}>{busy === 'preview' ? 'กำลังตรวจ…' : 'ตรวจตัวอย่างก่อนเพิ่ม'}</button>
        </fieldset>
      </form>
      {preview && <div className="ra-product-preview" aria-live="polite">
        <h4>ตัวอย่างก่อนยืนยัน · {preview.items.length} รายการ</h4>
        <p role="status">{preview.valid ? 'ข้อมูลพร้อมเพิ่ม กรุณาตรวจชื่อ หน่วย ราคา และแผนกอีกครั้ง' : 'พบข้อผิดพลาด กรุณาแก้ข้อมูลแล้วตรวจใหม่'}</p>
        <ol>{preview.items.map(row => <li key={row.row}><strong>แถว {row.row}</strong>{row.errors.length ? <p className="ra-problem">{row.errors.join(' · ')}</p> : <>
          <p>{row.name} · {row.unit} · {row.price} บาท</p><p className="ra-note">ตามบิล: {row.bill_text} · รหัส: {row.item_code || 'ไม่มี'} · กลุ่ม: {row.group}</p>
        </>}</li>)}</ol>
        <button type="button" className="ra-primary" disabled={!preview.valid || Boolean(busy)} onClick={save}>{busy === 'save' ? 'กำลังเพิ่มสินค้า…' : `ยืนยันเพิ่ม ${preview.items.length} รายการ`}</button>
      </div>}
    </>)}
  </section>;
}
