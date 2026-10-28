import { useEffect, useRef, useState } from 'react';

const noMemory = { load: async () => null, save: async () => {} };

// Internal debug pilot only; the server still authenticates and owns all scope.
// memory keeps the last branch/department this device entered with, so the next login is one tap.
export function PilotLogin({ api, online, busy, onLogin, onBusy = () => {}, memory = noMemory }) {
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branch, setBranch] = useState('');
  const [department, setDepartment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const rememberedDepartment = useRef('');
  useEffect(() => {
    let active = true;
    setBranches([]); setDepartments([]); setBranch(''); setDepartment(''); setError('');
    setLoading(online);
    if (online) Promise.all([api.branches(), memory.load().catch(() => null)]).then(([rows, saved]) => {
      if (active) {
        setBranches(rows);
        if (saved && rows.some(row => String(row.id) === saved.branch)) {
          rememberedDepartment.current = saved.department;
          setBranch(saved.branch);
        } else if (rows.length === 1) setBranch(String(rows[0].id));
      }
    })
      .catch(() => { if (active) setError('โหลดสาขาไม่สำเร็จ กรุณาลองใหม่'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, online, retry]);
  useEffect(() => {
    let active = true;
    if (!branch || !online) return;
    setLoading(true); setError('');
    api.departments(branch).then(rows => {
      if (active) {
        setDepartments(rows);
        const remembered = rememberedDepartment.current; rememberedDepartment.current = '';
        if (rows.some(row => String(row.id) === remembered)) setDepartment(remembered);
        else if (rows.length === 1) setDepartment(String(rows[0].id));
      }
    })
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
    try {
      const session = await api.login(Number(department));
      memory.save({ branch, department }).catch(() => {});
      await onLogin(session);
    }
    catch { setError('เข้าสู่ระบบไม่สำเร็จ ตรวจการเชื่อมต่อและสิทธิ์แผนก แล้วลองใหม่'); }
    finally { lock.current = false; setSubmitting(false); onBusy(false); }
  }
  const disabled = busy || loading || submitting || !online;
  const branchDisabled = busy || submitting || !online;
  return <section><h2>เข้าใช้งาน</h2>
    <p>เลือกสาขาและแผนก</p>
    {!online && <p role="status">เชื่อมต่ออินเทอร์เน็ตเพื่อเข้าสู่ระบบ</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <form onSubmit={submit}>
      <div className="apk-choice-group">
        <span className="apk-choice-label">สาขา</span>
        <div className="apk-choice-grid" role="group" aria-label="สาขา">
          {branches.map(row => {
            const selected = branch === String(row.id);
            return <button
              key={row.id}
              type="button"
              className={`apk-choice-btn${selected ? ' selected' : ''}`}
              aria-pressed={selected}
              disabled={branchDisabled}
              onClick={() => {
                if (branch === String(row.id)) return;
                rememberedDepartment.current = '';
                setBranch(String(row.id));
                setDepartment('');
                setDepartments([]);
              }}>{row.name}</button>;
          })}
        </div>
      </div>
      {branch ? <div className="apk-choice-group">
        <span className="apk-choice-label">แผนก</span>
        <div className="apk-choice-grid" role="group" aria-label="แผนก">
          {departments.map(row => {
            const selected = department === String(row.id);
            return <button
              key={row.id}
              type="button"
              className={`apk-choice-btn${selected ? ' selected' : ''}`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => setDepartment(String(row.id))}>{row.name}</button>;
          })}
        </div>
      </div> : null}
      <button disabled={disabled || !branch || !department}>{submitting ? 'กำลังเข้าสู่ระบบ…' : loading ? 'กำลังโหลด…' : 'เข้าใช้งาน'}</button>
    </form>
    {error && <button className="secondary" disabled={busy || submitting || !online} onClick={() => setRetry(value => value + 1)}>ลองใหม่</button>}
  </section>;
}
