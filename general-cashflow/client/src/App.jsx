import {
  AlertTriangle,
  Banknote,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Upload,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, setAuthToken } from './api.js';

const today = () => new Date().toISOString().slice(0, 10);

const money = (value) =>
  Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const statusClass = (status) => `status status-${String(status || '').toLowerCase().replaceAll('_', '-')}`;

const can = (user, action) => {
  const role = user?.role;
  if (role === 'admin') return true;
  return {
    create: role === 'cashier',
    submit: role === 'cashier',
    check: role === 'auditor',
    correction: role === 'auditor',
    close: role === 'recorder',
    settings: false,
    report: role === 'recorder'
  }[action];
};

const Button = ({ children, icon: Icon, variant = 'primary', busy, ...props }) => (
  <button className={`btn btn-${variant}`} disabled={busy || props.disabled} {...props}>
    {busy ? <RefreshCw className="spin" size={16} /> : Icon ? <Icon size={16} /> : null}
    <span>{children}</span>
  </button>
);

const Field = ({ label, children }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cashierBusy, setCashierBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.login({ username, password });
      setAuthToken(result.token);
      localStorage.setItem('cashflow_user', JSON.stringify(result.user));
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enterCashier = async () => {
    setCashierBusy(true);
    setError('');
    try {
      const result = await api.cashierLogin();
      setAuthToken(result.token);
      localStorage.setItem('cashflow_user', JSON.stringify(result.user));
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setCashierBusy(false);
    }
  };

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-row">
          <div className="brand-mark"><Banknote size={26} /></div>
          <div>
            <h1>General Cashflow</h1>
            <p>รับเงินหน้าร้านรายวัน</p>
          </div>
        </div>
        <Button icon={Banknote} busy={cashierBusy} type="button" onClick={enterCashier}>
          เข้าใช้งานแคชเชียร์
        </Button>
        <div className="login-divider"><span>ฝ่ายตรวจ / ผู้บันทึก / Admin</span></div>
        <Field label="Username">
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </Field>
        {error && <div className="error-box">{error}</div>}
        <Button icon={Lock} busy={busy} type="submit">เข้าสู่ระบบ</Button>
      </form>
    </main>
  );
};

const NOTE_DENOMINATIONS = [1000, 500, 100, 50, 20];

const decomposeCash = (total) => {
  let remaining = Math.max(0, Math.round(Number(total) || 0));
  const noteCounts = {};
  for (const denom of NOTE_DENOMINATIONS) {
    noteCounts[denom] = Math.floor(remaining / denom);
    remaining -= noteCounts[denom] * denom;
  }
  return { noteCounts, coinTotal: remaining || '' };
};

const CashDenominationPad = ({ initialValue, onTotalChange }) => {
  const [noteCounts, setNoteCounts] = useState(() => decomposeCash(initialValue).noteCounts);
  const [openDenoms, setOpenDenoms] = useState(
    () => new Set(NOTE_DENOMINATIONS.filter((denom) => decomposeCash(initialValue).noteCounts[denom] > 0))
  );
  const [coinTotal, setCoinTotal] = useState(() => decomposeCash(initialValue).coinTotal);

  const emitTotal = (nextNoteCounts, nextCoinTotal) => {
    const noteSum = NOTE_DENOMINATIONS.reduce((sum, d) => sum + d * (Number(nextNoteCounts[d]) || 0), 0);
    onTotalChange(noteSum + (Number(nextCoinTotal) || 0));
  };

  const setNoteQty = (denom, qty) => {
    const next = { ...noteCounts, [denom]: qty };
    setNoteCounts(next);
    emitTotal(next, coinTotal);
  };

  const setCoins = (value) => {
    setCoinTotal(value);
    emitTotal(noteCounts, value);
  };

  const clearAll = () => {
    setNoteCounts({});
    setOpenDenoms(new Set());
    setCoinTotal('');
    onTotalChange(0);
  };

  const noteTotal = NOTE_DENOMINATIONS.reduce((sum, denom) => sum + denom * (Number(noteCounts[denom]) || 0), 0);
  const total = noteTotal + (Number(coinTotal) || 0);

  return (
    <div className="cash-pad">
      <span className="cash-pad-label">ธนบัตร</span>
      <div className="cash-pad-grid">
        {NOTE_DENOMINATIONS.map((denom) =>
          openDenoms.has(denom) ? (
            <div className="cash-denom-input-cell" key={denom}>
              <span className="cash-denom-input-label">฿{denom.toLocaleString('th-TH')}</span>
              <input
                className="cash-denom-input"
                inputMode="numeric"
                placeholder="0"
                autoFocus
                value={noteCounts[denom] ?? ''}
                onFocus={(event) => event.target.select()}
                onChange={(event) => {
                  const raw = event.target.value.replace(/[^0-9]/g, '');
                  setNoteQty(denom, raw === '' ? '' : Number(raw));
                }}
              />
              <span className="cash-denom-sub">{money(denom * (Number(noteCounts[denom]) || 0))}</span>
            </div>
          ) : (
            <button
              type="button"
              className="cash-denom-btn"
              key={denom}
              onClick={() => setOpenDenoms((current) => new Set(current).add(denom))}
            >
              <span className="cash-denom-value">฿{denom.toLocaleString('th-TH')}</span>
            </button>
          )
        )}
      </div>

      <div className="cash-coin-row">
        <span className="cash-pad-label">เหรียญ (รวมทุกชนิด)</span>
        <input
          className="cash-coin-input"
          inputMode="decimal"
          placeholder="รับเหรียญมากี่บาท"
          value={coinTotal}
          onFocus={(event) => event.target.select()}
          onChange={(event) => setCoins(event.target.value)}
        />
      </div>

      <div className="cash-pad-footer">
        <span>รวมเงินสด</span>
        <strong>{money(total)}</strong>
        <button type="button" className="cash-pad-reset" onClick={clearAll}>ล้างค่า</button>
      </div>
    </div>
  );
};

const MISC_ITEM_PRESETS = ['เช็คอิน', 'แลกแต้ม', 'รถตู้'];

const CashierWorkspace = ({ branches }) => {
  const [date, setDate] = useState(today());
  const [branchId, setBranchId] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [draftLines, setDraftLines] = useState([]);
  const [attachmentFiles, setAttachmentFiles] = useState([]);
  const [miscLabel, setMiscLabel] = useState('');
  const [miscAmount, setMiscAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!branchId && branches[0]) setBranchId(String(branches[0].id));
  }, [branches, branchId]);

  useEffect(() => {
    if (!branchId) return;
    setLoading(true);
    setError('');
    setMessage('');
    setAttachmentFiles([]);
    setMiscLabel('');
    setMiscAmount('');
    api
      .receipts({ date, branch_id: branchId })
      .then((rows) => (rows[0] ? api.receipt(rows[0].id) : null))
      .then(setReceipt)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [branchId, date]);

  useEffect(() => {
    setDraftLines((receipt?.lines || []).map((line) => ({ ...line })));
  }, [receipt]);

  const editable = Boolean(receipt) && ['DRAFT', 'NEEDS_CORRECTION'].includes(receipt.status);
  const enteredTotal = draftLines.reduce((sum, line) => sum + Number(line.cashier_amount || 0), 0);
  const expectedTotal = draftLines.reduce((sum, line) => sum + Number(line.expected_amount || 0), 0);
  const balanced = Math.abs(enteredTotal - expectedTotal) < 0.01;
  const miscTotal = (receipt?.misc_items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const updateLine = (id, value) => {
    setDraftLines((lines) => lines.map((line) => (line.id === id ? { ...line, cashier_amount: value } : line)));
  };

  const createReceipt = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setReceipt(await api.createFromClickHouse({ date, branch_id: branchId }));
      setMessage('ดึงยอดขายสำเร็จ');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setReceipt(
        await api.submitReceipt(receipt.id, {
          lines: draftLines.map((line) => ({
            payment_channel_id: line.payment_channel_id,
            cashier_amount: line.cashier_amount
          }))
        })
      );
      setMessage('ส่งยอดสำเร็จ รอฝ่ายตรวจ');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async () => {
    if (!attachmentFiles.length) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setReceipt(await api.uploadAttachments(receipt.id, attachmentFiles, 'cashier_summary'));
      setAttachmentFiles([]);
      setMessage('แนบไฟล์สำเร็จ');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addMiscItem = async () => {
    if (!miscLabel.trim() || !miscAmount) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setReceipt(await api.addMiscItem(receipt.id, { label: miscLabel.trim(), amount: miscAmount }));
      setMiscLabel('');
      setMiscAmount('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeMiscItem = async (itemId) => {
    setBusy(true);
    setError('');
    try {
      setReceipt(await api.removeMiscItem(receipt.id, itemId));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cashier-shell">
      <div className="cashier-selector">
        <Field label="วันที่">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="สาขา">
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            {branches.length === 0 && <option value="">ไม่มีสาขา</option>}
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </Field>
      </div>

      {loading && (
        <div className="cashier-loading">
          <RefreshCw className="spin" size={18} /> กำลังโหลด...
        </div>
      )}

      {!loading && !receipt && (
        <div className="cashier-card cashier-empty">
          <RefreshCw size={30} />
          <p>ยังไม่มีข้อมูลยอดขายวันนี้ของสาขานี้</p>
          <Button icon={RefreshCw} busy={busy} disabled={!branchId} onClick={createReceipt}>
            ดึงยอดขายจาก POS
          </Button>
        </div>
      )}

      {!loading && receipt && (
        <>
          <div className="cashier-status-row">
            <span className={statusClass(receipt.status)}>{receipt.status_label}</span>
            <span className="muted">{receipt.bill_count} บิล</span>
          </div>

          {receipt.status === 'NEEDS_CORRECTION' && receipt.correction_note && (
            <div className="correction-banner">
              <AlertTriangle size={18} />
              <div>
                <strong>ฝ่ายตรวจส่งกลับให้แก้ไข</strong>
                <p>{receipt.correction_note}</p>
              </div>
            </div>
          )}

          <div className="cashier-summary">
            <span>ยอดขายรวมที่ระบบคาดไว้</span>
            <strong>{money(receipt.gross_sales_expected)}</strong>
          </div>

          <div className="cashier-lines">
            {draftLines.map((line) => (
              <div className="cashier-line-card" key={line.id}>
                <div className="cashier-line-head">
                  <strong>{line.channel_label}</strong>
                  <span>คาดไว้ {money(line.expected_amount)}</span>
                </div>
                {editable && line.channel_code === 'CASH' ? (
                  <CashDenominationPad
                    key={`cash-${receipt.id}-${line.id}`}
                    initialValue={line.cashier_amount}
                    onTotalChange={(total) => updateLine(line.id, total)}
                  />
                ) : editable ? (
                  <input
                    className="cashier-amount-input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={line.cashier_amount ?? ''}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => updateLine(line.id, event.target.value)}
                  />
                ) : (
                  <div className="cashier-amount-readonly">{money(line.cashier_amount)}</div>
                )}
              </div>
            ))}
          </div>

          <div className="cashier-card misc-items">
            <span className="cash-pad-label">รายการอื่นๆ (เงินเข้าเพิ่มเติม)</span>

            {(receipt.misc_items || []).length > 0 && (
              <div className="misc-items-list">
                {receipt.misc_items.map((item) => (
                  <div className="misc-item-row" key={item.id}>
                    <span>{item.label}</span>
                    <strong>{money(item.amount)}</strong>
                    {editable && (
                      <button
                        type="button"
                        className="misc-item-remove"
                        aria-label={`ลบ ${item.label}`}
                        onClick={() => removeMiscItem(item.id)}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {editable && (
              <>
                <div className="misc-item-presets">
                  {MISC_ITEM_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      className={`misc-preset-btn ${miscLabel === preset ? 'active' : ''}`}
                      onClick={() => setMiscLabel(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <div className="misc-item-form">
                  <input
                    placeholder="ชื่อรายการ"
                    value={miscLabel}
                    onChange={(event) => setMiscLabel(event.target.value)}
                  />
                  <input
                    inputMode="decimal"
                    placeholder="จำนวนเงิน"
                    value={miscAmount}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => setMiscAmount(event.target.value)}
                  />
                  <Button
                    icon={Plus}
                    variant="secondary"
                    busy={busy}
                    disabled={!miscLabel.trim() || !miscAmount}
                    onClick={addMiscItem}
                  >
                    เพิ่ม
                  </Button>
                </div>
              </>
            )}

            {miscTotal > 0 && (
              <div className="misc-items-total">
                <span>รวมรายการอื่นๆ</span>
                <strong>{money(miscTotal)}</strong>
              </div>
            )}
          </div>

          <div className="cashier-card cashier-upload">
            <label className="upload-dropzone">
              <Camera size={22} />
              <span>{attachmentFiles.length ? `เลือกแล้ว ${attachmentFiles.length} ไฟล์` : 'ถ่ายรูป / แนบสรุปแคชเชียร์'}</span>
              <input
                type="file"
                accept="image/*,.pdf"
                capture="environment"
                multiple
                hidden
                onChange={(event) => setAttachmentFiles(event.target.files)}
              />
            </label>
            {attachmentFiles.length > 0 && (
              <Button icon={Upload} variant="secondary" busy={busy} onClick={uploadFiles}>
                แนบไฟล์ที่เลือก
              </Button>
            )}
            {(receipt.attachments || []).length > 0 && (
              <p className="muted">แนบไว้แล้ว {receipt.attachments.length} ไฟล์</p>
            )}
          </div>

          {error && <div className="error-box">{error}</div>}
          {message && <div className="success-box">{message}</div>}

          {editable && (
            <div className="cashier-actionbar">
              <div className="cashier-actionbar-total">
                <span>รวมที่นับได้</span>
                <strong className={balanced ? 'amount-ok' : 'amount-bad'}>{money(enteredTotal)}</strong>
              </div>
              <Button icon={Save} busy={busy} onClick={submit}>ส่งยอด</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
};

const Dashboard = ({
  user,
  branches,
  receipts,
  selected,
  filters,
  setFilters,
  onLoad,
  onCreate,
  onSelect,
  busy
}) => {
  const counts = useMemo(() => {
    const base = { DRAFT: 0, SUBMITTED: 0, CHECKED_VARIANCE: 0, CLOSED: 0 };
    receipts.forEach((receipt) => {
      if (base[receipt.status] !== undefined) base[receipt.status] += 1;
    });
    return base;
  }, [receipts]);

  return (
    <section className="workspace">
      <div className="toolbar">
        <Field label="วันที่">
          <input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} />
        </Field>
        <Field label="สาขา">
          <select value={filters.branch_id} onChange={(event) => setFilters({ ...filters, branch_id: event.target.value })}>
            <option value="">ทุกสาขา</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </Field>
        <Field label="สถานะ">
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">ทั้งหมด</option>
            <option value="DRAFT">ยังไม่ส่ง</option>
            <option value="SUBMITTED">รอตรวจ</option>
            <option value="CHECKED_OK">ตรวจแล้วครบ</option>
            <option value="CHECKED_VARIANCE">มีส่วนต่าง</option>
            <option value="NEEDS_CORRECTION">ส่งกลับแก้ไข</option>
            <option value="CLOSED">ปิดแล้ว</option>
          </select>
        </Field>
        <Button icon={Search} variant="secondary" busy={busy} onClick={onLoad}>ค้นหา</Button>
        {can(user, 'create') && (
          <Button icon={RefreshCw} busy={busy} onClick={onCreate} disabled={!filters.branch_id || !filters.date}>
            ดึงยอด ClickHouse
          </Button>
        )}
      </div>

      <div className="metric-strip">
        <div><span>ยังไม่ส่ง</span><strong>{counts.DRAFT}</strong></div>
        <div><span>รอตรวจ</span><strong>{counts.SUBMITTED}</strong></div>
        <div><span>มีส่วนต่าง</span><strong>{counts.CHECKED_VARIANCE}</strong></div>
        <div><span>ปิดแล้ว</span><strong>{counts.CLOSED}</strong></div>
      </div>

      <div className="split-view">
        <div className="receipt-list">
          {receipts.length === 0 && <div className="empty-state">ไม่พบเอกสารในเงื่อนไขนี้</div>}
          {receipts.map((receipt) => (
            <button
              key={receipt.id}
              className={`receipt-row ${selected?.id === receipt.id ? 'active' : ''}`}
              onClick={() => onSelect(receipt.id)}
            >
              <div>
                <strong>{receipt.branch_name}</strong>
                <span>{receipt.receipt_date}</span>
              </div>
              <div>
                <span className={statusClass(receipt.status)}>{receipt.status_label}</span>
                <span className={Number(receipt.variance_total || 0) === 0 ? 'amount-ok' : 'amount-bad'}>
                  ส่วนต่าง {money(receipt.variance_total)}
                </span>
              </div>
            </button>
          ))}
        </div>
        <ReceiptDetail user={user} receipt={selected} onChanged={onSelect} />
      </div>
    </section>
  );
};

const ReceiptDetail = ({ user, receipt, onChanged }) => {
  const [draftLines, setDraftLines] = useState([]);
  const [statementChannel, setStatementChannel] = useState('');
  const [statementFile, setStatementFile] = useState(null);
  const [attachmentFiles, setAttachmentFiles] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraftLines((receipt?.lines || []).map((line) => ({ ...line })));
    setMessage('');
    setError('');
  }, [receipt?.id]);

  if (!receipt) {
    return <div className="detail-panel empty-state">เลือกเอกสารเพื่อทำงานต่อ</div>;
  }

  const updateLine = (id, patch) => {
    setDraftLines((lines) => lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const run = async (action) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await action();
      setMessage('บันทึกสำเร็จ');
      onChanged(next.id || receipt.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(() =>
      api.submitReceipt(receipt.id, {
        lines: draftLines.map((line) => ({
          payment_channel_id: line.payment_channel_id,
          cashier_amount: line.cashier_amount
        }))
      })
    );

  const uploadCashierFiles = () =>
    run(() => api.uploadAttachments(receipt.id, attachmentFiles, 'cashier_summary'));

  const importStatement = () =>
    run(() =>
      api.importStatement({
        receiptId: receipt.id,
        paymentChannelId: statementChannel,
        file: statementFile
      })
    );

  const check = () =>
    run(() =>
      api.checkReceipt(receipt.id, {
        lines: draftLines.map((line) => ({
          id: line.id,
          payment_channel_id: line.payment_channel_id,
          statement_amount: line.statement_amount,
          variance_reason: line.variance_reason
        }))
      })
    );

  const correction = () => {
    const note = window.prompt('เหตุผลที่ส่งกลับแก้ไข');
    if (note === null) return;
    run(() => api.requestCorrection(receipt.id, { note }));
  };

  const close = () => run(() => api.closeReceipt(receipt.id, { note: 'Closed from UI' }));

  return (
    <div className="detail-panel">
      <div className="detail-head">
        <div>
          <h2>{receipt.branch_name}</h2>
          <p>{receipt.receipt_date} • {receipt.bill_count} บิล</p>
        </div>
        <span className={statusClass(receipt.status)}>{receipt.status_label}</span>
      </div>

      <div className="summary-grid">
        <div><span>ยอดขายรวม</span><strong>{money(receipt.gross_sales_expected)}</strong></div>
        <div><span>เงินสด expected</span><strong>{money(receipt.cash_expected)}</strong></div>
        <div><span>ไม่ใช่เงินสด</span><strong>{money(receipt.non_cash_expected)}</strong></div>
      </div>

      {(receipt.misc_items || []).length > 0 && (
        <div className="misc-items misc-items-readonly">
          <span className="cash-pad-label">รายการอื่นๆ ที่แคชเชียร์เพิ่ม</span>
          <div className="misc-items-list">
            {receipt.misc_items.map((item) => (
              <div className="misc-item-row" key={item.id}>
                <span>{item.label}</span>
                <strong>{money(item.amount)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="line-table">
        <div className="line-header">
          <span>ช่องทาง</span>
          <span>Expected</span>
          <span>แคชเชียร์ส่ง</span>
          <span>ตรวจพบ/Statement</span>
          <span>เหตุผลส่วนต่าง</span>
        </div>
        {draftLines.map((line) => {
          const variance = Number(line.statement_amount || 0) - Number(line.expected_amount || 0);
          return (
            <div className="line-row" key={line.id}>
              <span>
                <strong>{line.channel_label}</strong>
                <small>{line.source_description || line.provider || '-'}</small>
              </span>
              <span>{money(line.expected_amount)}</span>
              <input
                inputMode="decimal"
                value={line.cashier_amount ?? ''}
                disabled={!can(user, 'submit') || !['DRAFT', 'NEEDS_CORRECTION'].includes(receipt.status)}
                onChange={(event) => updateLine(line.id, { cashier_amount: event.target.value })}
              />
              <input
                inputMode="decimal"
                value={line.statement_amount ?? ''}
                disabled={!can(user, 'check') || !['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE'].includes(receipt.status)}
                onChange={(event) => updateLine(line.id, { statement_amount: event.target.value })}
              />
              <input
                value={line.variance_reason || ''}
                placeholder={Math.abs(variance) >= 0.01 ? 'ต้องระบุเหตุผล' : ''}
                disabled={!can(user, 'check') || !['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE'].includes(receipt.status)}
                onChange={(event) => updateLine(line.id, { variance_reason: event.target.value })}
              />
            </div>
          );
        })}
      </div>

      {can(user, 'submit') && (
        <div className="action-band">
          <input type="file" multiple onChange={(event) => setAttachmentFiles(event.target.files)} />
          <Button icon={Upload} variant="secondary" disabled={!attachmentFiles.length} busy={busy} onClick={uploadCashierFiles}>
            แนบสรุป/สลิป
          </Button>
          <Button icon={Save} busy={busy} disabled={!['DRAFT', 'NEEDS_CORRECTION'].includes(receipt.status)} onClick={submit}>
            ส่งยอดแคชเชียร์
          </Button>
        </div>
      )}

      {can(user, 'check') && (
        <div className="action-band">
          <select value={statementChannel} onChange={(event) => setStatementChannel(event.target.value)}>
            <option value="">ให้ระบบเดาจากรายการ</option>
            {receipt.lines.filter((line) => line.channel_code !== 'CASH').map((line) => (
              <option key={line.payment_channel_id} value={line.payment_channel_id}>{line.channel_label}</option>
            ))}
          </select>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => setStatementFile(event.target.files?.[0] || null)} />
          <Button icon={FileSpreadsheet} variant="secondary" disabled={!statementFile} busy={busy} onClick={importStatement}>
            อัปโหลด statement
          </Button>
          <Button icon={ClipboardCheck} busy={busy} disabled={!['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE'].includes(receipt.status)} onClick={check}>
            ตรวจยอด
          </Button>
          <Button icon={RotateCcw} variant="warning" busy={busy} disabled={receipt.status === 'CLOSED'} onClick={correction}>
            ส่งกลับแก้ไข
          </Button>
        </div>
      )}

      {can(user, 'close') && (
        <div className="action-band">
          <Button icon={CheckCircle2} busy={busy} disabled={!['CHECKED_OK', 'CHECKED_VARIANCE'].includes(receipt.status)} onClick={close}>
            ปิดเอกสาร
          </Button>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box">{message}</div>}

      <div className="history-grid">
        <section>
          <h3>Statement imports</h3>
          {(receipt.statement_imports || []).map((item) => (
            <div className="mini-row" key={item.id}>
              <span>{item.original_name}</span>
              <strong>{money(item.total_amount)}</strong>
            </div>
          ))}
          {(receipt.statement_imports || []).length === 0 && <p className="muted">ยังไม่มี statement</p>}
        </section>
        <section>
          <h3>Audit trail</h3>
          {(receipt.audit_logs || []).slice(0, 6).map((item) => (
            <div className="mini-row" key={item.id}>
              <span>{item.action}</span>
              <small>{item.actor_name || item.actor_role || '-'}</small>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
};

const SettingsView = ({ branches, channels, onReload }) => {
  const [branchForm, setBranchForm] = useState({ code: '', name: '', clickhouse_branch_id: '' });
  const [channelDrafts, setChannelDrafts] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const drafts = {};
    channels.forEach((channel) => {
      drafts[channel.id] = {
        ...channel,
        mappingsText: (channel.mappings || []).join('\n')
      };
    });
    setChannelDrafts(drafts);
  }, [channels]);

  const saveBranch = async () => {
    setError('');
    try {
      await api.createBranch(branchForm);
      setBranchForm({ code: '', name: '', clickhouse_branch_id: '' });
      setMessage('บันทึกสาขาแล้ว');
      onReload();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveChannel = async (channelId) => {
    setError('');
    const draft = channelDrafts[channelId];
    try {
      await api.updatePaymentChannel(channelId, {
        label: draft.label,
        provider: draft.provider,
        account_number: draft.account_number,
        sort_order: draft.sort_order,
        is_active: draft.is_active,
        mappings: draft.mappingsText.split('\n').map((line) => line.trim()).filter(Boolean)
      });
      setMessage('บันทึกช่องทางแล้ว');
      onReload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="settings-view">
      <div className="settings-section">
        <h2>สาขา</h2>
        <div className="settings-grid">
          {branches.map((branch) => (
            <div className="setting-row" key={branch.id}>
              <strong>{branch.name}</strong>
              <span>{branch.clickhouse_branch_id || 'ไม่มี ClickHouse ID'}</span>
            </div>
          ))}
        </div>
        <div className="inline-form">
          <input placeholder="Code" value={branchForm.code} onChange={(event) => setBranchForm({ ...branchForm, code: event.target.value })} />
          <input placeholder="ชื่อสาขา" value={branchForm.name} onChange={(event) => setBranchForm({ ...branchForm, name: event.target.value })} />
          <input placeholder="ClickHouse branch id" value={branchForm.clickhouse_branch_id} onChange={(event) => setBranchForm({ ...branchForm, clickhouse_branch_id: event.target.value })} />
          <Button icon={Save} onClick={saveBranch}>บันทึก</Button>
        </div>
      </div>

      <div className="settings-section">
        <h2>ช่องทางรับเงิน</h2>
        <div className="channel-editor">
          {channels.map((channel) => {
            const draft = channelDrafts[channel.id] || channel;
            return (
              <div className="channel-row" key={channel.id}>
                <input placeholder="ชื่อช่องทาง" value={draft.label || ''} onChange={(event) => setChannelDrafts({ ...channelDrafts, [channel.id]: { ...draft, label: event.target.value } })} />
                <input placeholder="ผู้ให้บริการ" value={draft.provider || ''} onChange={(event) => setChannelDrafts({ ...channelDrafts, [channel.id]: { ...draft, provider: event.target.value } })} />
                <input placeholder="เลขบัญชี" value={draft.account_number || ''} onChange={(event) => setChannelDrafts({ ...channelDrafts, [channel.id]: { ...draft, account_number: event.target.value } })} />
                <textarea placeholder="คำอธิบายที่ตรงกับ ClickHouse (บรรทัดละ 1 รายการ)" value={draft.mappingsText || ''} onChange={(event) => setChannelDrafts({ ...channelDrafts, [channel.id]: { ...draft, mappingsText: event.target.value } })} />
                <Button icon={Save} variant="secondary" onClick={() => saveChannel(channel.id)}>บันทึก</Button>
              </div>
            );
          })}
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box">{message}</div>}
    </section>
  );
};

const ReportView = ({ branches }) => {
  const [filters, setFilters] = useState({ from: today(), to: today(), branch_id: '' });
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      setReport(await api.reconciliation(filters));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="workspace">
      <div className="toolbar">
        <Field label="จาก">
          <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </Field>
        <Field label="ถึง">
          <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </Field>
        <Field label="สาขา">
          <select value={filters.branch_id} onChange={(event) => setFilters({ ...filters, branch_id: event.target.value })}>
            <option value="">ทุกสาขา</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </Field>
        <Button icon={Search} onClick={load}>ดูรายงาน</Button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {report && (
        <>
          <div className="metric-strip">
            <div><span>Expected</span><strong>{money(report.summary.gross_sales_expected)}</strong></div>
            <div><span>แคชเชียร์</span><strong>{money(report.summary.cashier_total)}</strong></div>
            <div><span>ตรวจพบ</span><strong>{money(report.summary.verified_total)}</strong></div>
            <div><span>ส่วนต่าง</span><strong>{money(report.summary.variance_total)}</strong></div>
          </div>
          <div className="report-table">
            {report.rows.map((row) => (
              <div className="report-row" key={`${row.receipt_date}-${row.branch_name}`}>
                <span>{row.receipt_date}</span>
                <strong>{row.branch_name}</strong>
                <span>{row.status}</span>
                <span>{money(row.gross_sales_expected)}</span>
                <span>{money(row.variance_total)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
};

const App = () => {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('cashflow_user') || 'null');
    } catch {
      return null;
    }
  });
  const [view, setView] = useState('dashboard');
  const [branches, setBranches] = useState([]);
  const [channels, setChannels] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ date: today(), branch_id: '', status: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadSettings = async () => {
    const [branchRows, channelRows] = await Promise.all([api.branches(), api.paymentChannels()]);
    setBranches(branchRows);
    setChannels(channelRows);
    if (!filters.branch_id && branchRows[0]) {
      setFilters((current) => ({ ...current, branch_id: String(branchRows[0].id) }));
    }
  };

  const loadReceipts = async () => {
    setBusy(true);
    setError('');
    try {
      setReceipts(await api.receipts(filters));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const selectReceipt = async (id) => {
    setBusy(true);
    setError('');
    try {
      const next = await api.receipt(id);
      setSelected(next);
      setReceipts(await api.receipts(filters));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const createFromClickHouse = async () => {
    setBusy(true);
    setError('');
    try {
      const receipt = await api.createFromClickHouse({ date: filters.date, branch_id: filters.branch_id });
      setSelected(receipt);
      setReceipts(await api.receipts(filters));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    setView('dashboard');
    loadSettings().catch((err) => setError(err.message));
  }, [user]);

  useEffect(() => {
    if (!user || user.role === 'cashier') return;
    loadReceipts();
  }, [user, filters.date, filters.status, filters.branch_id]);

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  const logout = () => {
    setAuthToken('');
    localStorage.removeItem('cashflow_user');
    setUser(null);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-row compact">
          <div className="brand-mark"><Banknote size={22} /></div>
          <div>
            <h1>General Cashflow</h1>
            <p>{user.full_name || user.username} • {user.role}</p>
          </div>
        </div>
        <nav>
          <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>
            <ClipboardCheck size={16} /> งานรับเงิน
          </button>
          {can(user, 'report') && (
            <button className={view === 'report' ? 'active' : ''} onClick={() => setView('report')}>
              <FileSpreadsheet size={16} /> รายงาน
            </button>
          )}
          {can(user, 'settings') && (
            <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
              <Settings size={16} /> ตั้งค่า
            </button>
          )}
          <button onClick={logout}><LogOut size={16} /> ออก</button>
        </nav>
      </header>
      {error && <div className="global-error">{error}</div>}
      {view === 'dashboard' && user.role === 'cashier' && <CashierWorkspace branches={branches} />}
      {view === 'dashboard' && user.role !== 'cashier' && (
        <Dashboard
          user={user}
          branches={branches}
          receipts={receipts}
          selected={selected}
          filters={filters}
          setFilters={setFilters}
          onLoad={loadReceipts}
          onCreate={createFromClickHouse}
          onSelect={selectReceipt}
          busy={busy}
        />
      )}
      {view === 'settings' && can(user, 'settings') && <SettingsView branches={branches} channels={channels} onReload={loadSettings} />}
      {view === 'report' && can(user, 'report') && <ReportView branches={branches} />}
    </main>
  );
};

export default App;
