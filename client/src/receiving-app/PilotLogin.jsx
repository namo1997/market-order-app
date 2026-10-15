import { useEffect, useRef, useState } from 'react';

// Internal debug pilot only; the server still authenticates and owns all scope.
export function PilotLogin({ api, online, busy, onLogin, onBusy = () => {} }) {
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branch, setBranch] = useState('');
  const [department, setDepartment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setBranches([]); setDepartments([]); setBranch(''); setDepartment(''); setError('');
    setLoading(online);
    if (online) api.branches().then(rows => { if (active) setBranches(rows); })
      .catch(() => { if (active) setError('โหลดสาขาไม่สำเร็จ กรุณาลองใหม่'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, online, retry]);
  useEffect(() => {
    let active = true;
    if (!branch || !online) return;
    setLoading(true); setError('');
    api.departments(branch).then(rows => { if (active) setDepartments(rows); })
      .catch(() => { if (active) setError('โหลดแผนกไม่สำเร็จ กรุณาลองใหม่'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, branch, online]);
  async function submit(event) {
    event.preventDefault();
    if (lock.current || busy || loading || !online ||
        !branches.some(row => String(row.id) === branch) ||
        !departments.some(row => String(row.id) === department)) return;
    lock.current = true; setSubmitting(true); onBusy(true); setError('');
    try { await onLogin(await api.login(Number(department))); }
    catch { setError('เข้าสู่ระบบไม่สำเร็จ ตรวจการเชื่อมต่อและสิทธิ์แผนก แล้วลองใหม่'); }
    finally { lock.current = false; setSubmitting(false); onBusy(false); }
  }
  const disabled = busy || loading || submitting || !online;
  return <section><h2>เข้าสู่ระบบทดลอง</h2>
    <p className="pilot-notice">DEBUG · PILOT — สำหรับทดลองภายในเท่านั้น</p>
    <p>เลือกสาขาและแผนกที่ต้องการทดลอง ระบบจะใช้สิทธิ์ที่เซิร์ฟเวอร์กำหนด</p>
    {!online && <p role="status">เชื่อมต่ออินเทอร์เน็ตเพื่อเข้าสู่ระบบ</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <form onSubmit={submit}>
      <label>สาขา<select value={branch} disabled={disabled} required onChange={event => {
        setBranch(event.target.value); setDepartment(''); setDepartments([]);
      }}><option value="">เลือกสาขา</option>{branches.map(row => <option key={row.id} value={String(row.id)}>{row.name}</option>)}</select></label>
      <label>แผนก<select value={department} disabled={disabled || !branch} required onChange={event => setDepartment(event.target.value)}>
        <option value="">เลือกแผนก</option>{departments.map(row => <option key={row.id} value={String(row.id)}>{row.name}</option>)}</select></label>
      <button disabled={disabled || !branch || !department}>{submitting ? 'กำลังเข้าสู่ระบบ…' : loading ? 'กำลังโหลด…' : 'เข้าทดลองรับสินค้า'}</button>
    </form>
    {error && <button className="secondary" disabled={busy || submitting || !online} onClick={() => setRetry(value => value + 1)}>ลองใหม่</button>}
  </section>;
}
