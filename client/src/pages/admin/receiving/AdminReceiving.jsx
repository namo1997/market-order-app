import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
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
      if (id) setState({ doc: result, loading: false });
      else { setState({ data: result[0], loading: false }); setOptions(result[1]); }
    }).catch(error => { if (active) setState({ loading: false, error: message(error) }); });
    return () => { active = false; controller.abort(); };
  }, [id, search]);
  const onSearch = event => {
    event?.preventDefault();
    setSearch({ ...filters, page: 1 });
  };
  return <Layout mainClassName="ra-layout"><div className="receiving-admin">
    <header className="ra-heading"><div><p>SOLAO · ฝ่ายบัญชีและแอดมิน</p><h1>จัดการใบรับสินค้า</h1><p>ตรวจใบรับสินค้า รูปบิล และประวัติการรับสินค้า</p></div><Link className="ra-issues-link" to="/admin/receiving/issues">ปัญหารับของ →</Link></header>
    <nav className="ra-tabs" aria-label="เมนูรับสินค้า"><Link aria-current="page" to="/admin/receiving">ใบรับสินค้า</Link><Link to="/admin/receiving/issues">ปัญหารับของ</Link></nav>
    {id ? state.loading ? <p role="status">กำลังโหลดใบรับสินค้า…</p> : state.error ? <p role="alert">{state.error} <button onClick={() => setSearch(value => ({ ...value }))}>ลองใหม่</button></p> : <ReceivingDocumentView key={id} doc={state.doc} followups={followups} followupError={followupError} />
      : <ReceivingLedgerView filters={filters} setFilters={setFilters} options={options} {...state} followups={followups} followupError={followupError} onReloadFollowups={() => setReloadFollowups(value => value + 1)} onSearch={onSearch} onPage={page => setSearch(previous => ({ ...previous, page }))} />}
  </div></Layout>;
}
