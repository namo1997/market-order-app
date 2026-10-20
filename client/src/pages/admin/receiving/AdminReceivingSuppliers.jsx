import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReceivingAdminShell } from './ReceivingAdminShell';
import { receivingAdminAPI as api } from '../../../api/receiving-admin';
import { ReceivingSuppliersView } from './ReceivingSuppliersView';
import { ReceivingSupplierDetail } from './ReceivingSupplierDetail';
import { emptySupplierFilters, supplierErrorMessage } from './receiving-suppliers';
import './receiving-admin.css';

const loadMessage = error => error?.response?.status === 403 ? supplierErrorMessage(error) : error?.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่';

export function AdminReceivingSuppliers() {
  const { key } = useParams();
  const [filters, setFilters] = useState({ ...emptySupplierFilters });
  const [search, setSearch] = useState({});
  const [state, setState] = useState({ loading: true });
  const [reload, setReload] = useState(0);
  const scope = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    // A reload after a save keeps the current page (and its notices); a new key or search blanks it.
    const signature = JSON.stringify([key || null, search]);
    setState(previous => (scope.current === signature && previous.data ? previous : { loading: true }));
    scope.current = signature;
    const request = key ? api.supplier(key, controller.signal) : api.suppliers(search, controller.signal);
    request.then(result => { if (active) setState({ data: result, loading: false, key }); })
      .catch(error => { if (active && !controller.signal.aborted) setState({ loading: false, key, error: loadMessage(error) }); });
    return () => { active = false; controller.abort(); };
  }, [key, search, reload]);
  const actions = useMemo(() => key ? {
    productOptions: () => api.supplierProductOptions(key),
    previewProducts: body => api.previewSupplierProducts(key, body),
    createProducts: body => api.createSupplierProducts(key, body),
    saveProfile: body => api.saveSupplierProfile(key, body),
    createAlias: body => api.createAlias(key, body),
    updateAlias: (id, body) => api.updateAlias(key, id, body),
    setActive: (id, active) => api.setAliasActive(key, id, active),
    searchProducts: q => api.supplierProducts(key, q),
  } : {}, [key]);
  const onSearch = event => {
    event?.preventDefault();
    setSearch(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  };
  const detailReady = key && state.key === key && !state.loading;
  return <ReceivingAdminShell suppliers>
    <header className="ra-heading"><div><p>SOLAO · ฝ่ายบัญชีและแอดมิน</p><h1>ร้านค้าและชื่อย่อในบิล</h1><p>ดูรูปแบบการสั่งของแต่ละร้าน และจัดการชื่อย่อที่ใช้ช่วยอ่านบิล</p></div></header>
    {key ? <>
      <Link to="/admin/receiving/suppliers">← กลับรายชื่อร้าน</Link>
      {state.loading || state.key !== key ? <p role="status">กำลังโหลดข้อมูลร้าน…</p>
        : state.error ? <p role="alert">{state.error} <button type="button" onClick={() => setReload(value => value + 1)}>ลองใหม่</button></p>
          : detailReady && state.data && <ReceivingSupplierDetail key={key} detail={state.data} actions={actions} onChanged={() => setReload(value => value + 1)} />}
    </> : <ReceivingSuppliersView filters={filters} setFilters={setFilters} onSearch={onSearch}
      onReset={() => { setFilters({ ...emptySupplierFilters }); setSearch({}); }} {...state} />}
  </ReceivingAdminShell>;
}
