import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { CONTACT_LINK_TEXT, legacySupplierPath } from './receiving-supplier-links';
import { ledgerDate } from './receiving-ledger';
import { orderingModeOptions, orderingLabel, kindLabels, auditLabels, emptyAliasDraft, NOTE_LIMITS, profileDraft, profileProblem,
  profileBody, aliasDraftFrom, aliasProblem, aliasBody, aliasChanges, supplierErrorMessage, auditSummary, TOGGLE_LOCK_MS, TOGGLE_NOTE_MS,
  BRANCH_CODE_LIMIT, emptyBranchCode, branchCodesDraft, branchCodesProblem, branchCodesBody, branchCodesChanged, aliasSourceLabel, filterAliases, ITEM_CODE_LIMIT } from './receiving-suppliers';

// Detail of one supplier: ordering notes + confirmed aliases. All writes go through
// the `actions` callbacks; every successful write asks the page to reload from the server.
export function ReceivingSupplierDetail({ detail, actions = {}, onChanged = () => {} }) {
  const { isAdmin } = useAuth();
  const [profile, setProfile] = useState(() => profileDraft(detail));
  const [alias, setAlias] = useState({ ...emptyAliasDraft });
  const [query, setQuery] = useState('');
  const [aliasFilter, setAliasFilter] = useState('');
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [codes, setCodes] = useState(() => branchCodesDraft(detail));
  // Alias status changes show in the same row at once (override) and the button stays locked for a moment,
  // so the next click cannot land on the opposite action of the same row.
  const [override, setOverride] = useState({});
  const [rowState, setRowState] = useState({});
  const busyRows = useRef(new Set());
  const timers = useRef([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  useEffect(() => { setProfile(profileDraft(detail)); setCodes(branchCodesDraft(detail)); setOverride({}); }, [detail]);
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
  const profileError = profileProblem(profile) || branchCodesProblem(codes);
  const aliasError = aliasProblem(alias);
  const saveProfile = async event => {
    event.preventDefault();
    if (profileError) return setProblem(profileError);
    const body = profileBody(profile);
    if (branchCodesChanged(codes, detail)) body.branch_codes = branchCodesBody(codes);
    await run('profile', () => actions.saveProfile(body), 'บันทึกรูปแบบการสั่งแล้ว');
  };
  const setCode = (index, key) => event => setCodes(previous => previous.map((entry, at) => (at === index ? { ...entry, [key]: event.target.value } : entry)));
  const saveAlias = async event => {
    event.preventDefault();
    if (aliasError) return setProblem(aliasError);
    const changes = editing ? aliasChanges(alias, current) : null;
    if (editing && !Object.keys(changes).length) return setNotice('ไม่มีการเปลี่ยนแปลง');
    const ok = await run('alias', () => (editing ? actions.updateAlias(alias.id, changes) : actions.createAlias(aliasBody(alias))),
      editing ? 'แก้ชื่อย่อแล้ว' : 'เพิ่มชื่อย่อแล้ว');
    if (ok) setAlias({ ...emptyAliasDraft });
  };
  const activeOf = item => override[item.id] ?? item.is_active;
  const later = (work, ms) => { timers.current.push(setTimeout(work, ms)); };
  const toggle = async item => {
    if (busyRows.current.has(item.id)) return; // a second click while saving or locked is ignored
    busyRows.current.add(item.id);
    const target = !activeOf(item);
    setProblem(''); setNotice(''); setRowState(previous => ({ ...previous, [item.id]: { saving: true } }));
    try {
      await actions.setActive(item.id, target);
      setOverride(previous => ({ ...previous, [item.id]: target }));
      setRowState(previous => ({ ...previous, [item.id]: { locked: true, note: target ? 'เปิดใช้' : 'ปิดใช้' } }));
      setNotice(target ? 'เปิดใช้ชื่อย่อแล้ว' : 'ปิดใช้ชื่อย่อแล้ว');
      later(() => setRowState(previous => ({ ...previous, [item.id]: { note: previous[item.id]?.note } })), TOGGLE_LOCK_MS);
      later(() => setRowState(previous => { const { [item.id]: _done, ...rest } = previous; return rest; }), TOGGLE_NOTE_MS);
      await onChanged();
    } catch (error) {
      setProblem(supplierErrorMessage(error));
      setRowState(previous => { const { [item.id]: _failed, ...rest } = previous; return rest; });
    } finally { later(() => busyRows.current.delete(item.id), TOGGLE_LOCK_MS); }
  };
  const field = (key, limit) => event => setProfile(previous => ({ ...previous, [key]: event.target.value.slice(0, limit ?? 2000) }));
  const shownAliases = filterAliases(detail.aliases || [], aliasFilter);
  const branches = detail.branches_seen?.length ? detail.branches_seen.join(', ') : 'ยังไม่มีใบรับที่ยืนยันแล้ว';
  return <div className="ra-supplier-detail">
    <header className="ra-document-heading"><div><h2>{detail.name}</h2>
      <p className="ra-note">{detail.code ? `รหัส ${detail.code} · ` : ''}{kindLabels[detail.kind]}{detail.is_active ? '' : ' · ปิดใช้งาน'} · การสั่งปัจจุบัน: {orderingLabel(detail.ordering_mode)}</p></div>
      {isAdmin && <Link className="ra-manage-link" to={legacySupplierPath(detail)}>{CONTACT_LINK_TEXT}</Link>}</header>
    {detail.merged_keys?.length > 1 && <p className="ra-note ra-merged-note">ร้านนี้รวมทะเบียนซัพพลายเออร์กับกลุ่มสินค้าเดิมที่ชื่อเดียวกันไว้เป็นรายการเดียว · ชื่อย่อจากทั้งสองที่แสดงรวมกันด้านล่าง และเพิ่ม/แก้ไข/ปิดใช้จะมีผลกับทั้งสองที่</p>}
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
          <fieldset className="ra-codes"><legend>รหัสเจ้าหนี้ตามสาขา</legend>
            <p className="ra-note">ร้านเดียวกันอาจใช้รหัสเจ้าหนี้ต่างกันในแต่ละสาขา เช่น AP-049 (สันกำแพง) · ใส่ได้เฉพาะรหัสสั้น</p>
            {codes.length ? codes.map((entry, index) => <div className="ra-code-row" key={index}>
              <label>รหัส<input type="text" maxLength={30} value={entry.code} onChange={setCode(index, 'code')} placeholder="เช่น AP-049" /></label>
              <label>สาขา / หมายเหตุ<input type="text" maxLength={100} value={entry.branch_note} onChange={setCode(index, 'branch_note')} placeholder="เช่น สันกำแพง" /></label>
              <button type="button" aria-label={`ลบรหัส ${entry.code || index + 1}`} onClick={() => setCodes(previous => previous.filter((_, at) => at !== index))}>ลบ</button>
            </div>) : <p className="ra-note">ยังไม่มีรหัสตามสาขา</p>}
            <button type="button" disabled={codes.length >= BRANCH_CODE_LIMIT} onClick={() => setCodes(previous => [...previous, { ...emptyBranchCode }])}>+ เพิ่มรหัสตามสาขา</button>
          </fieldset>
          <p className="ra-note">ห้ามใส่เลขบัญชีธนาคาร เลขภาษี หรือเบอร์โทรในหมายเหตุและรหัสเจ้าหนี้</p>
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
        <label>รหัสสินค้าในบิล (ถ้ามี)<input type="text" inputMode="text" autoComplete="off" maxLength={ITEM_CODE_LIMIT} value={alias.item_code} onChange={event => setAlias(previous => ({ ...previous, item_code: event.target.value }))} placeholder="เช่น 5002 (รหัสที่ร้านพิมพ์หน้าชื่อสินค้า)" />
          <small className="ra-note">ใช้รหัสสั้นที่ผู้ขายพิมพ์ในบิลเท่านั้น ห้ามใส่เลขบัญชี เลขภาษี หรือเบอร์โทร · ระบบจะจับคู่สินค้าจากรหัสก่อนอ่านชื่อ</small></label>
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
      <label className="ra-alias-search">ค้นหาในตารางชื่อย่อ<input type="search" maxLength={100} value={aliasFilter} onChange={event => setAliasFilter(event.target.value)} placeholder="ข้อความตามบิล รหัสสินค้าในบิล หรือสินค้า" /></label>
      <div className="ra-table-scroll" tabIndex={0} aria-label="ตารางชื่อย่อ เลื่อนซ้ายขวาได้">
        <table><caption>ชื่อย่อที่ยืนยันแล้ว · {aliasFilter.trim() ? `${shownAliases.length} จาก ${detail.aliases?.length || 0}` : detail.aliases?.length || 0} รายการ</caption>
          <thead><tr><th>ข้อความตามบิล</th><th>รหัสสินค้าในบิล</th><th>หน่วย</th><th>สินค้าในระบบ</th><th className="ra-number">ยืนยันแล้ว (ครั้ง)</th><th>สถานะ</th><th>แก้ล่าสุด</th><th>จัดการ</th></tr></thead>
          <tbody>{shownAliases.length ? shownAliases.map(item => {
            const active = activeOf(item), state = rowState[item.id] || {}, source = detail.merged_keys ? aliasSourceLabel(item.source_keys) : '';
            return <tr key={item.id} className={active ? '' : 'ra-alias-off'}>
            <td>{item.bill_text}{source && <small>{source}</small>}</td><td>{item.item_code || '—'}</td><td>{item.unit_text || '—'}</td><td>{item.product_name || `สินค้า #${item.product_id}`}</td>
            <td className="ra-number">{item.confirm_count}</td>
            <td><span className={`ra-status ${active ? 'ra-confirmed' : 'ra-void'}`}>{active ? 'ใช้งาน' : 'ปิดใช้'}</span>
              {state.saving && <small role="status">กำลังบันทึก…</small>}{state.note && !state.saving && <small role="status" className="ra-row-note">{state.note}แล้วเมื่อสักครู่</small>}</td>
            <td>{ledgerDate(item.updated_at, true)}<small>{item.updated_by_name || ''}</small></td>
            <td><div className="ra-row-actions">
              <button type="button" onClick={() => { setAlias(aliasDraftFrom(item)); setNotice(''); setProblem(''); }} aria-label={`แก้ชื่อย่อ ${item.bill_text}`}>แก้ไข</button>
              <button type="button" disabled={Boolean(state.saving || state.locked)} onClick={() => toggle(item)} aria-label={`${active ? 'ปิดใช้' : 'เปิดใช้'}ชื่อย่อ ${item.bill_text}`}>{state.saving ? 'กำลังบันทึก…' : active ? 'ปิดใช้' : 'เปิดใช้'}</button>
            </div></td>
          </tr>; }) : <tr><td colSpan={8} className="ra-empty">{detail.aliases?.length ? 'ไม่พบชื่อย่อที่ตรงกับคำค้น' : 'ร้านนี้ยังไม่มีชื่อย่อ เพิ่มจากแบบฟอร์มด้านบนได้'}</td></tr>}</tbody>
        </table>
      </div>
    </section>
  </div>;
}
