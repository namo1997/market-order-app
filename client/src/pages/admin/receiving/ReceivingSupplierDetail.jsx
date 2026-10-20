import { useEffect, useState } from 'react';
import { ledgerDate } from './receiving-ledger';
import { orderingModeOptions, orderingLabel, kindLabels, auditLabels, emptyAliasDraft, NOTE_LIMITS, profileDraft, profileProblem,
  profileBody, aliasDraftFrom, aliasProblem, aliasBody, aliasChanges, supplierErrorMessage, auditSummary } from './receiving-suppliers';

// Detail of one supplier: ordering notes + confirmed aliases. All writes go through
// the `actions` callbacks; every successful write asks the page to reload from the server.
export function ReceivingSupplierDetail({ detail, actions = {}, onChanged = () => {} }) {
  const [profile, setProfile] = useState(() => profileDraft(detail));
  const [alias, setAlias] = useState({ ...emptyAliasDraft });
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  useEffect(() => { setProfile(profileDraft(detail)); }, [detail]);
  useEffect(() => {
    if (!actions.searchProducts) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      actions.searchProducts(query.trim()).then(result => { if (active) setFound(result?.items || []); })
        .catch(() => { if (active) setFound([]); });
    }, query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, detail?.supplier_key]);
  const run = async (label, work, done) => {
    setBusy(label); setProblem(''); setNotice('');
    try { await work(); setNotice(done); await onChanged(); return true; }
    catch (error) { setProblem(supplierErrorMessage(error)); return false; }
    finally { setBusy(''); }
  };
  const editing = alias.id != null;
  const current = editing ? detail.aliases.find(item => item.id === alias.id) : null;
  const options = [...found];
  if (current && !options.some(product => Number(product.id) === Number(current.product_id))) {
    options.unshift({ id: current.product_id, name: current.product_name || `สินค้า #${current.product_id}`, unit_name: current.unit_name });
  }
  const profileError = profileProblem(profile);
  const aliasError = aliasProblem(alias);
  const saveProfile = async event => {
    event.preventDefault();
    if (profileError) return setProblem(profileError);
    await run('profile', () => actions.saveProfile(profileBody(profile)), 'บันทึกรูปแบบการสั่งแล้ว');
  };
  const saveAlias = async event => {
    event.preventDefault();
    if (aliasError) return setProblem(aliasError);
    const changes = editing ? aliasChanges(alias, current) : null;
    if (editing && !Object.keys(changes).length) return setNotice('ไม่มีการเปลี่ยนแปลง');
    const ok = await run('alias', () => (editing ? actions.updateAlias(alias.id, changes) : actions.createAlias(aliasBody(alias))),
      editing ? 'แก้ชื่อย่อแล้ว' : 'เพิ่มชื่อย่อแล้ว');
    if (ok) setAlias({ ...emptyAliasDraft });
  };
  const toggle = item => run(`toggle-${item.id}`, () => actions.setActive(item.id, !item.is_active), item.is_active ? 'ปิดใช้ชื่อย่อแล้ว' : 'เปิดใช้ชื่อย่อแล้ว');
  const field = (key, limit) => event => setProfile(previous => ({ ...previous, [key]: event.target.value.slice(0, limit ?? 2000) }));
  const branches = detail.branches_seen?.length ? detail.branches_seen.join(', ') : 'ยังไม่มีใบรับที่ยืนยันแล้ว';
  return <div className="ra-supplier-detail">
    <header className="ra-document-heading"><div><h2>{detail.name}</h2>
      <p className="ra-note">{detail.code ? `รหัส ${detail.code} · ` : ''}{kindLabels[detail.kind]}{detail.is_active ? '' : ' · ปิดใช้งาน'} · การสั่งปัจจุบัน: {orderingLabel(detail.ordering_mode)}</p></div></header>
    <div aria-live="polite">{notice && <p role="status" className="ra-ok">{notice}</p>}{problem && <p role="alert" className="ra-problem">{problem}</p>}</div>
    <div className="ra-detail-grid">
      <section className="ra-panel" aria-labelledby="ra-profile-title">
        <h3 id="ra-profile-title">รูปแบบการสั่งและบิล</h3>
        <form className="ra-form" onSubmit={saveProfile}>
          <label>รูปแบบการสั่ง<select value={profile.ordering_mode} onChange={field('ordering_mode')}>
            <option value="">ยังไม่ระบุ</option>{orderingModeOptions.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
          <label>ส่งให้สาขา (หมายเหตุ)<input type="text" maxLength={NOTE_LIMITS.branches_note} value={profile.branches_note} onChange={field('branches_note', NOTE_LIMITS.branches_note)} placeholder="เช่น คันคลอง, ครัวกลาง" /></label>
          <p className="ra-note">สาขาที่เคยรับของจริง: {branches}</p>
          <label>รูปแบบบิล<textarea rows={3} maxLength={NOTE_LIMITS.bill_format_note} value={profile.bill_format_note} onChange={field('bill_format_note', NOTE_LIMITS.bill_format_note)} placeholder="เช่น ใบส่งของเขียนมือ 1–2 รายการ/ใบ" /></label>
          <label>หมายเหตุการสั่ง<textarea rows={3} maxLength={NOTE_LIMITS.ordering_note} value={profile.ordering_note} onChange={field('ordering_note', NOTE_LIMITS.ordering_note)} placeholder="เช่น บางครั้งโทรสั่งแยก ไม่มีใบสั่ง" /></label>
          <p className="ra-note">ห้ามใส่เลขบัญชีธนาคาร เลขภาษี หรือเบอร์โทรในหมายเหตุ</p>
          <button className="ra-primary" type="submit" disabled={busy === 'profile'}>{busy === 'profile' ? 'กำลังบันทึก…' : 'บันทึกรูปแบบการสั่ง'}</button>
        </form>
      </section>
      <section className="ra-panel" aria-labelledby="ra-audit-title">
        <h3 id="ra-audit-title">ประวัติการแก้ไขล่าสุด</h3>
        {detail.audits?.length ? <ol className="ra-audits">{detail.audits.map(audit => <li key={audit.id}>
          <strong>{auditLabels[audit.action] || audit.action}</strong> · {audit.actor_name || 'ไม่ทราบผู้ทำ'}
          <small>{ledgerDate(audit.created_at, true)}</small><small>{auditSummary(audit)}</small></li>)}</ol>
          : <p className="ra-note">ยังไม่มีการแก้ไขผ่านหน้านี้</p>}
      </section>
    </div>
    <section className="ra-panel ra-alias-panel" aria-labelledby="ra-alias-title">
      <h3 id="ra-alias-title">ชื่อย่อในบิล → สินค้าในระบบ</h3>
      <form className="ra-form ra-alias-form" onSubmit={saveAlias}>
        <strong>{editing ? `แก้ชื่อย่อ #${alias.id}` : 'เพิ่มชื่อย่อใหม่'}</strong>
        <label>ข้อความตามบิล<input type="text" maxLength={255} value={alias.bill_text} onChange={event => setAlias(previous => ({ ...previous, bill_text: event.target.value }))} placeholder="เช่น ทB" required /></label>
        <label>หน่วยตามบิล (ถ้ามี)<input type="text" maxLength={100} value={alias.unit_text} onChange={event => setAlias(previous => ({ ...previous, unit_text: event.target.value }))} placeholder="เช่น กก." /></label>
        <label>ค้นหาสินค้า<input type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} placeholder="พิมพ์ชื่อสินค้า" /></label>
        <label>สินค้าในระบบ<select value={alias.product_id} onChange={event => setAlias(previous => ({ ...previous, product_id: event.target.value }))} required>
          <option value="">เลือกสินค้า</option>
          {options.map(product => <option key={product.id} value={product.id}>{product.name}{product.unit_name ? ` (${product.unit_name})` : ''}{product.is_supplier_product ? ' · ของร้านนี้' : ''}</option>)}
        </select></label>
        <div className="ra-form-actions">
          <button className="ra-primary" type="submit" disabled={busy === 'alias'}>{busy === 'alias' ? 'กำลังบันทึก…' : editing ? 'บันทึกการแก้ไข' : 'เพิ่มชื่อย่อ'}</button>
          {editing && <button type="button" onClick={() => { setAlias({ ...emptyAliasDraft }); setProblem(''); }}>ยกเลิกการแก้ไข</button>}
        </div>
      </form>
      <div className="ra-table-scroll" tabIndex={0} aria-label="ตารางชื่อย่อ เลื่อนซ้ายขวาได้">
        <table><caption>ชื่อย่อที่ยืนยันแล้ว · {detail.aliases?.length || 0} รายการ</caption>
          <thead><tr><th>ข้อความตามบิล</th><th>หน่วย</th><th>สินค้าในระบบ</th><th className="ra-number">ยืนยันแล้ว (ครั้ง)</th><th>สถานะ</th><th>แก้ล่าสุด</th><th>จัดการ</th></tr></thead>
          <tbody>{detail.aliases?.length ? detail.aliases.map(item => <tr key={item.id} className={item.is_active ? '' : 'ra-alias-off'}>
            <td>{item.bill_text}</td><td>{item.unit_text || '—'}</td><td>{item.product_name || `สินค้า #${item.product_id}`}</td>
            <td className="ra-number">{item.confirm_count}</td>
            <td><span className={`ra-status ${item.is_active ? 'ra-confirmed' : 'ra-void'}`}>{item.is_active ? 'ใช้งาน' : 'ปิดใช้'}</span></td>
            <td>{ledgerDate(item.updated_at, true)}<small>{item.updated_by_name || ''}</small></td>
            <td><div className="ra-row-actions">
              <button type="button" onClick={() => { setAlias(aliasDraftFrom(item)); setNotice(''); setProblem(''); }} aria-label={`แก้ชื่อย่อ ${item.bill_text}`}>แก้ไข</button>
              <button type="button" disabled={busy === `toggle-${item.id}`} onClick={() => toggle(item)} aria-label={`${item.is_active ? 'ปิดใช้' : 'เปิดใช้'}ชื่อย่อ ${item.bill_text}`}>{item.is_active ? 'ปิดใช้' : 'เปิดใช้'}</button>
            </div></td>
          </tr>) : <tr><td colSpan={7} className="ra-empty">ร้านนี้ยังไม่มีชื่อย่อ เพิ่มจากแบบฟอร์มด้านบนได้</td></tr>}</tbody>
        </table>
      </div>
    </section>
  </div>;
}
