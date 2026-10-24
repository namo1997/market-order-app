import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReceivingAdminShell } from './ReceivingAdminShell';
import { receivingAdminAPI as api } from '../../../api/receiving-admin';
import { receivingFollowupsAPI as followupAPI } from '../../../api/receiving-followups';
import { ReceivingLedgerView, emptyFilters } from './ReceivingLedgerView';
import { ReceivingDocumentView } from './ReceivingDocumentView';
import './receiving-admin.css';
const message = error => error?.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่';
export function AdminReceiving() {
  const { id } = useParams();
  const [filters, setFilters] = useState({ ...emptyFilters });
  const [search, setSearch] = useState({ page: 1 });
  const [options, setOptions] = useState({ branches: [], departments: [] });
  const [state, setState] = useState({ loading: true });
  const [followups, setFollowups] = useState(null);
  const [followupError, setFollowupError] = useState(false);
  const [reloadFollowups, setReloadFollowups] = useState(0);
  const [issues, setIssues] = useState({ loading: true });
  const [reloadIssues, setReloadIssues] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setIssues({ loading: true });
    api.issuesSummary(controller.signal).then(result => { if (active) setIssues(result); })
      .catch(() => { if (active) setIssues({ error: true }); });
    return () => { active = false; controller.abort(); };
  }, [reloadIssues]);
  useEffect(() => {
    let active = true;
    setFollowups(null); setFollowupError(false);
    followupAPI.followups('pending').then(result => { if (active) setFollowups(result); })
      .catch(() => { if (active) setFollowupError(true); });
    return () => { active = false; };
  }, [reloadFollowups]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ loading: true });
    const request = id ? api.get(id, controller.signal) : Promise.all([api.list(search, controller.signal), api.options(controller.signal)]);
    request.then(result => {
      if (!active) return;
      if (id) setState({ doc: result, documentId: id, loading: false });
      else { setState({ data: result[0], loading: false }); setOptions(result[1]); }
    }).catch(error => { if (active) setState({ loading: false, documentId: id, error: message(error) }); });
    return () => { active = false; controller.abort(); };
  }, [id, search]);
  const onAwaitingProduct = () => {
    const next = { ...emptyFilters, awaiting_product: 'yes' };
    setFilters(next); setSearch({ ...next, page: 1 });
  };
  const onSearch = event => {
    event?.preventDefault();
    setSearch({ ...filters, page: 1 });
  };
  return <ReceivingAdminShell>
    <header className="ra-heading"><div><p>SOLAO · ฝ่ายบัญชีและแอดมิน</p><h1>จัดการใบรับสินค้า</h1><p>ตรวจใบรับสินค้า รูปบิล และประวัติการรับสินค้า</p></div></header>
    {id ? <><Link to="/admin/receiving">← กลับทะเบียนใบรับสินค้า</Link>{state.loading || state.documentId !== id ? <p role="status">กำลังโหลดใบรับสินค้า…</p> : state.error ? <p role="alert">{state.error} <button onClick={() => setSearch(value => ({ ...value }))}>ลองใหม่</button></p> : state.doc ? <ReceivingDocumentView key={id} doc={state.doc} followups={followups} followupError={followupError} onReload={() => setSearch(value => ({ ...value }))} /> : <p role="alert">ไม่พบใบรับสินค้า</p>}</>
      : <ReceivingLedgerView filters={filters} setFilters={setFilters} options={options} {...state} issues={issues} onReloadIssues={() => setReloadIssues(value => value + 1)} followups={followups} followupError={followupError} onReloadFollowups={() => setReloadFollowups(value => value + 1)} onSearch={onSearch} onAwaitingProduct={onAwaitingProduct} onPage={page => setSearch(previous => ({ ...previous, page }))} />}
  </ReceivingAdminShell>;
}
