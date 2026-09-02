import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Bot, CalendarDays, Check, ChevronLeft, ChevronRight,
  CircleDollarSign, FileText, Home, Image as ImageIcon, Link2, ListChecks,
  Menu, MessageCircle, Minus, Plus, Search, Send, Users, X, ZoomIn, ZoomOut,
  BadgeCheck, ReceiptText, Eye, Banknote
} from 'lucide-react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { addDays, api, bangkokToday, businessDate, imageUrl, lineTime, money, shortDate, type Row } from './api';
import { classifyItem, equalAmounts, itemAmount, urgency, type Bucket } from './domain';

const GROUP_NAMES: Record<string, string> = {
  C987d13b96371f18f5a0996107d4f6ef5: 'สันกำแพง',
  C92c8a7b4a5099db619f6464e10eefab5: 'คันคลอง'
};

const bucketInfo: Record<Bucket, { label: string; tone: string }> = {
  review: { label: 'รอตรวจ', tone: 'amber' },
  needs_amount: { label: 'ต้องแก้ยอด', tone: 'red' },
  bill: { label: 'บิลไม่เข้าคู่', tone: 'blue' },
  slip: { label: 'สลิปไม่เข้าคู่', tone: 'purple' },
  other: { label: 'เอกสารอื่น', tone: 'gray' },
  done: { label: 'เสร็จแล้ว', tone: 'green' }
};

function useGroups() {
  return useQuery({ queryKey: ['groups'], queryFn: api.groups });
}

function groupName(sourceId: string, groups: Row[] = []) {
  const group = groups.find((row) => row.source_id === sourceId || row.source_key === sourceId);
  return group?.display_name || GROUP_NAMES[sourceId] || sourceId.slice(0, 9);
}

function datesForMonth(value: string) {
  const [year, month] = value.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end, days: Number(end.slice(8)) };
}

function AppShell() {
  const location = useLocation();
  const hideNav = location.pathname.startsWith('/review/') || location.pathname.startsWith('/group/');
  return <div className="app-shell">
    <Routes>
      <Route path="/" element={<WorkHome />} />
      <Route path="/calendar" element={<CalendarPage />} />
      <Route path="/day/:date/:sourceId" element={<DayPage />} />
      <Route path="/group/:date/:sourceId" element={<GroupBuilder />} />
      <Route path="/review/:kind/:id" element={<ReviewPage />} />
      <Route path="/flags" element={<FlagsPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/more" element={<MorePage />} />
    </Routes>
    {!hideNav && <BottomNav />}
  </div>;
}

export default function App() {
  return <AppShell />;
}

function BottomNav() {
  const links = [
    ['/', Home, 'งาน'], ['/calendar', CalendarDays, 'ปฏิทิน'], ['/search', Search, 'ค้นหา'],
    ['/more', Menu, 'เพิ่มเติม']
  ] as const;
  return <nav className="bottom-nav" aria-label="เมนูหลัก">
    {links.map(([to, Icon, label]) => <NavLink key={to} to={to} end={to === '/'}>
      <Icon size={21} /><span>{label}</span>
    </NavLink>)}
  </nav>;
}

function PageHeader({ title, subtitle, back }: { title: string; subtitle?: string; back?: boolean }) {
  const navigate = useNavigate();
  return <header className="page-header">
    {back && <button className="icon-button" onClick={() => navigate(-1)} aria-label="ย้อนกลับ"><ArrowLeft /></button>}
    <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
  </header>;
}

function ErrorBox({ error }: { error: unknown }) {
  return error ? <div className="notice error"><AlertTriangle size={18} />{String((error as Error).message || error)}</div> : null;
}

function WorkHome() {
  const today = bangkokToday();
  const start = addDays(today, -14);
  const groups = useGroups();
  const days = useQuery({ queryKey: ['days', start, today], queryFn: () => api.days(start, today) });
  const rows = useMemo(() => [...(days.data || [])].sort((a, b) => urgency(b) - urgency(a)), [days.data]);
  const urgent = rows.filter((row) => urgency(row) > 0 && row.closing_status !== 'closed');
  const totals = urgent.reduce((sum, row) => ({
    review: sum.review + Number(row.pending_count ?? row.pending ?? row.pending_matches ?? 0),
    amount: sum.amount + Number(row.needs_amount_count ?? row.needs_amount ?? 0),
    unmatched: sum.unmatched + Number(row.unmatched_count ?? row.unmatched ?? 0)
  }), { review: 0, amount: 0, unmatched: 0 });
  const next = urgent[0];
  const nextBucket: Bucket = Number(next?.needs_amount_count || 0) ? 'needs_amount' : Number(next?.pending_count || 0) ? 'review' : 'bill';
  const firstReview = urgent.find((row) => Number(row.pending_count || 0) > 0);
  const firstUnmatched = urgent.find((row) => Number(row.unmatched_count || 0) > 0);
  return <main>
    <PageHeader title="ตรวจเอกสาร" subtitle="เลือกงานแล้วทำต่อเนื่องทีละรายการ" />
    <ErrorBox error={days.error || groups.error} />
    {next && <section className="focus-card">
      <div className="focus-label"><span>งานถัดไป</span><b>สำคัญที่สุดตอนนี้</b></div>
      <div className="focus-title"><div className="focus-icon"><ReceiptText /></div><div><h2>{groupName(next.source_id, groups.data)}</h2><p>{shortDate(next.business_date)}</p></div></div>
      <div className="focus-stats"><span><b>{next.pending_count || 0}</b> คู่รอตรวจ</span><span><b>{next.needs_amount_count || 0}</b> แก้ยอด</span><span><b>{next.unmatched_count || 0}</b> ยังไม่มีคู่</span></div>
      <Link className="primary-button" to={`/day/${next.business_date}/${next.source_id}?bucket=${nextBucket}`}><Eye /> เริ่มทำรอบนี้</Link>
    </section>}
    <section className="task-shortcuts" aria-label="เลือกประเภทงาน">
      <Link to="/flags"><span className="task-icon red"><CircleDollarSign /></span><span><strong>แก้ยอดเอกสาร</strong><small>ยอดในรูปกับแชทไม่ตรง</small></span><b>{totals.amount}</b><ChevronRight /></Link>
      {firstReview && <Link to={`/day/${firstReview.business_date}/${firstReview.source_id}?bucket=review`}><span className="task-icon amber"><ListChecks /></span><span><strong>ยืนยันคู่ที่ AI เสนอ</strong><small>ดูบิลและสลิปพร้อมกัน</small></span><b>{totals.review}</b><ChevronRight /></Link>}
      {firstUnmatched && <Link to={`/day/${firstUnmatched.business_date}/${firstUnmatched.source_id}?bucket=bill`}><span className="task-icon blue"><Link2 /></span><span><strong>หาเอกสารที่ยังไม่มีคู่</strong><small>เลือกคู่ข้ามวันและข้ามกลุ่มได้</small></span><b>{totals.unmatched}</b><ChevronRight /></Link>}
    </section>
    <section className="section-block">
      <div className="section-title"><h2>รอบที่ยังไม่ปิด</h2><Link to="/calendar">ดูปฏิทิน</Link></div>
      <div className="round-list">
        {urgent.slice(0, 6).map((day) => <RoundRow key={`${day.business_date}-${day.source_id}`} day={day} groups={groups.data} />)}
        {!urgent.length && !days.isLoading && <Empty text="ไม่มีงานค้างในช่วง 45 วัน" />}
      </div>
    </section>
  </main>;
}

function RoundRow({ day, groups }: { day: Row; groups?: Row[] }) {
  const sourceId = day.source_id || day.source_key;
  return <Link className="round-row" to={`/day/${day.business_date}/${sourceId}`}>
    <div className="date-tile"><strong>{String(day.business_date).slice(8)}</strong><span>{shortDate(day.business_date).split(' ')[1]}</span></div>
    <div className="round-main"><strong>{groupName(sourceId, groups)}</strong><span>{shortDate(day.business_date)}</span>
      <div className="mini-statuses">
        {Number(day.needs_amount_count ?? day.needs_amount ?? 0) > 0 && <b className="red">แก้ยอด {day.needs_amount_count ?? day.needs_amount}</b>}
        {Number(day.pending_count ?? day.pending ?? day.pending_matches ?? 0) > 0 && <b className="amber">รอตรวจ {day.pending_count ?? day.pending ?? day.pending_matches}</b>}
        {Number(day.unmatched_count ?? day.unmatched ?? 0) > 0 && <b>ไม่เข้าคู่ {day.unmatched_count ?? day.unmatched}</b>}
      </div>
    </div><ChevronRight />
  </Link>;
}

function CalendarPage() {
  const now = bangkokToday();
  const [month, setMonth] = useState(now.slice(0, 7));
  const [sourceId, setSourceId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const groups = useGroups();
  const range = datesForMonth(month);
  const days = useQuery({ queryKey: ['days', range.start, range.end, sourceId], queryFn: () => api.days(range.start, range.end, sourceId) });
  const firstWeekday = new Date(`${range.start}T12:00:00+07:00`).getDay();
  const groupOptions = groups.data || [];
  const monthLabel = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(new Date(`${range.start}T12:00:00+07:00`));
  const changeMonth = (delta: number) => {
    const date = new Date(`${range.start}T12:00:00+07:00`); date.setMonth(date.getMonth() + delta);
    setMonth(date.toISOString().slice(0, 7));
  };
  return <main>
    <PageHeader title="ปฏิทินเอกสาร" subtitle="แตะวันที่เพื่อเปิดรอบงาน" />
    <div className="toolbar">
      <button className="icon-button" onClick={() => changeMonth(-1)} aria-label="เดือนก่อน"><ChevronLeft /></button>
      <strong>{monthLabel}</strong>
      <button className="icon-button" onClick={() => changeMonth(1)} aria-label="เดือนถัดไป"><ChevronRight /></button>
    </div>
    <select className="select-wide" value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="เลือกกลุ่ม">
      <option value="">ทุกกลุ่ม</option>{groupOptions.map((g) => <option key={g.source_id} value={g.source_id}>{groupName(g.source_id, groupOptions)}</option>)}
    </select>
    <div className="calendar-grid weekdays">{['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((d) => <span key={d}>{d}</span>)}</div>
    <div className="calendar-grid">
      {Array.from({ length: firstWeekday }, (_, i) => <span key={`blank-${i}`} />)}
      {Array.from({ length: range.days }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, '0')}`;
        const rows = (days.data || []).filter((d) => d.business_date === date);
        const total = rows.reduce((n, d) => n + Number(d.item_count || d.total_items || 0), 0);
        const target = sourceId || (rows.length === 1 ? rows[0]?.source_id : '');
        if (target) return <Link key={date} className={`calendar-day ${rows.length ? 'has-data' : ''}`} to={`/day/${date}/${target}`}><strong>{i + 1}</strong>{total > 0 && <small>{total}</small>}</Link>;
        if (rows.length > 1) return <button key={date} className="calendar-day has-data" onClick={() => setSelectedDate(date)}><strong>{i + 1}</strong><small>{total}</small></button>;
        return <span key={date} className="calendar-day"><strong>{i + 1}</strong></span>;
      })}
    </div>
    {selectedDate && <DayGroupSheet date={selectedDate} rows={(days.data || []).filter((row) => row.business_date === selectedDate)} groups={groupOptions} onClose={() => setSelectedDate('')} />}
  </main>;
}

function DayGroupSheet({ date, rows, groups, onClose }: { date: string; rows: Row[]; groups: Row[]; onClose: () => void }) {
  return <div className="sheet-backdrop"><section className="choice-sheet"><header><div><h2>{shortDate(date)}</h2><p>เลือกกลุ่มที่ต้องการเปิด</p></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <div>{rows.map((row) => <Link key={row.source_id} to={`/day/${date}/${row.source_id}`}><span><strong>{groupName(row.source_id, groups)}</strong><small>{row.item_count || 0} รูป · ค้าง {Number(row.pending_count || 0) + Number(row.needs_amount_count || 0) + Number(row.unmatched_count || 0)}</small></span><ChevronRight /></Link>)}</div>
  </section></div>;
}

function useDayData(date: string, sourceId: string) {
  const pool = useQuery({ queryKey: ['item-pool', date, sourceId], queryFn: async () => {
    const [sameSource, crossSource] = await Promise.all([
      api.items({ start: addDays(date, -14), end: addDays(date, 14), source_id: sourceId }),
      api.items({ start: addDays(date, -2), end: addDays(date, 2) })
    ]);
    return [...new Map([...sameSource, ...crossSource].map((item) => [Number(item.id), item])).values()];
  } });
  const matches = useQuery({ queryKey: ['matches', date, sourceId], queryFn: async () => {
    const statuses = ['pending', 'manual_review', 'confirmed', 'needs_amount'];
    const results = await Promise.all(statuses.map((status) => api.matches({ start: date, end: date, source_id: sourceId, status })));
    return results.flat();
  }});
  const items = { ...pool, data: (pool.data || []).filter((item) => businessDate(item) === date && item.source_id === sourceId) };
  return { items, pool, matches };
}

type QueueEntry = { key: string; bucket: Bucket; item: Row; match?: Row; bill?: Row; slip?: Row };

function buildQueueEntries(dayRows: Row[], poolRows: Row[], matches: Row[]) {
  const byId = new Map(poolRows.map((item) => [Number(item.id), item]));
  const consumed = new Set<number>();
  const entries: QueueEntry[] = [];
  matches.forEach((match) => {
    const bill = byId.get(Number(match.bill_item_id)); const slip = byId.get(Number(match.slip_item_id));
    const item = bill || slip;
    if (!item) return;
    const bucket: Bucket = match.status === 'confirmed' ? 'done' : match.status === 'needs_amount' ? 'needs_amount' : 'review';
    entries.push({ key: `match-${match.id}`, bucket, item, match, bill, slip });
    consumed.add(Number(match.bill_item_id)); consumed.add(Number(match.slip_item_id));
  });
  dayRows.forEach((item) => {
    if (consumed.has(Number(item.id))) return;
    if (item.match_status === 'confirmed' && !Number(item.cash_payment_id || 0)) return;
    entries.push({ key: `item-${item.id}`, bucket: classifyItem(item), item });
  });
  const priority: Record<Bucket, number> = { needs_amount: 0, review: 1, bill: 2, slip: 2, other: 4, done: 5 };
  return entries.sort((a, b) => priority[a.bucket] - priority[b.bucket] || Number(b.item.event_timestamp_ms || 0) - Number(a.item.event_timestamp_ms || 0));
}

function DayPage() {
  const { date = bangkokToday(), sourceId = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const groups = useGroups();
  const { items, pool, matches } = useDayData(date, sourceId);
  const requestedBucket = (search.get('bucket') as Bucket) || 'review';
  const [mode, setMode] = useState<'todo' | 'done' | 'other'>(requestedBucket === 'done' ? 'done' : requestedBucket === 'other' ? 'other' : 'todo');
  const [doneFilter, setDoneFilter] = useState<'all' | 'transfer' | 'cash'>('all');
  const rows = items.data || [];
  const entries = useMemo(() => buildQueueEntries(rows, pool.data || [], matches.data || []), [rows, pool.data, matches.data]);
  const todo = entries.filter((entry) => ['review', 'needs_amount', 'bill', 'slip'].includes(entry.bucket));
  const done = entries.filter((entry) => entry.bucket === 'done'); const other = entries.filter((entry) => entry.bucket === 'other');
  const openEntry = (entry: QueueEntry) => {
    const kind = entry.match ? 'match' : 'item'; const id = entry.match?.id || entry.item.id;
    navigate(`/review/${kind}/${id}?date=${date}&source=${sourceId}&bucket=${entry.bucket}&item=${entry.bill?.id || entry.item.id}`);
  };
  return <main>
    <PageHeader back title={groupName(sourceId, groups.data)} subtitle={shortDate(date)} />
    <div className="day-switcher"><Link to={`/day/${addDays(date, -1)}/${sourceId}`}><ChevronLeft /> วันก่อน</Link><Link to={`/day/${addDays(date, 1)}/${sourceId}`}>วันถัดไป <ChevronRight /></Link></div>
    <section className="round-progress">
      <div><span>เหลือต้องจัดการ</span><strong>{todo.length}</strong><small>จาก {todo.length + done.length} ธุรกรรม</small></div>
      <div className="progress-track"><span style={{ width: `${todo.length + done.length ? done.length / (todo.length + done.length) * 100 : 100}%` }} /></div>
    </section>
    <div className="queue-modes" role="tablist">
      <button className={mode === 'todo' ? 'active' : ''} onClick={() => setMode('todo')}>ต้องทำ <b>{todo.length}</b></button>
      <button className={mode === 'done' ? 'active' : ''} onClick={() => setMode('done')}>เสร็จแล้ว <b>{done.length}</b></button>
      <button className={mode === 'other' ? 'active' : ''} onClick={() => setMode('other')}>รูปอื่น <b>{other.length}</b></button>
    </div>
    {mode === 'todo' && <div className="action-sections">
      <QueueSection title="แก้ยอดก่อน" subtitle="อ่านยอดไม่ได้หรือยอดขัดแย้ง" entries={todo.filter((x) => x.bucket === 'needs_amount')} onOpen={openEntry} />
      <QueueSection title="ตรวจคู่ที่เสนอ" subtitle="ดูบิลและสลิปก่อนยืนยัน" entries={todo.filter((x) => x.bucket === 'review')} onOpen={openEntry} />
      <QueueSection title="ยังไม่มีคู่" subtitle="เลือกบิลหรือสลิปที่เกี่ยวข้อง" entries={todo.filter((x) => ['bill', 'slip'].includes(x.bucket))} onOpen={openEntry} />
      {!todo.length && !items.isLoading && <Empty text="รอบนี้ไม่มีงานค้างแล้ว" />}
    </div>}
    {mode === 'done' && <>
      <div className="done-filters" role="group" aria-label="กรองวิธีชำระ"><button className={doneFilter === 'all' ? 'active' : ''} onClick={() => setDoneFilter('all')}>ทั้งหมด</button><button className={doneFilter === 'transfer' ? 'active' : ''} onClick={() => setDoneFilter('transfer')}>โอน</button><button className={doneFilter === 'cash' ? 'active' : ''} onClick={() => setDoneFilter('cash')}>เงินสด</button></div>
      <QueueSection title="ยืนยันแล้ว" subtitle="แตะเพื่อดูหลักฐานการชำระ" entries={done.filter((entry) => doneFilter === 'all' || (doneFilter === 'cash' ? Boolean(entry.item.cash_payment_id) : !entry.item.cash_payment_id))} onOpen={openEntry} />
    </>}
    {mode === 'other' && <QueueSection title="รูปที่ไม่อยู่ในธุรกรรม" subtitle="แชท รูปทั่วไป และหลักฐานอื่น" entries={other} onOpen={openEntry} />}
    <div className="day-actions">
      <Link className="secondary-button" to={`/group/${date}/${sourceId}`}><Link2 /> รวมบิลและสลิป</Link>
      <CloseDay date={date} sourceId={sourceId} unresolved={todo.length} />
    </div>
    <UndoMatch />
  </main>;
}

function QueueSection({ title, subtitle, entries, onOpen }: { title: string; subtitle: string; entries: QueueEntry[]; onOpen: (entry: QueueEntry) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!entries.length) return null;
  return <section className="queue-section"><div className="queue-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><b>{entries.length}</b></div>
    <div>{entries.slice(0, expanded ? entries.length : 6).map((entry) => <QueueRow key={entry.key} entry={entry} onClick={() => onOpen(entry)} />)}</div>
    {entries.length > 6 && <button className="show-more" onClick={() => setExpanded(!expanded)}>{expanded ? 'ย่อรายการ' : `ดูอีก ${entries.length - 6} รายการ`}</button>}
  </section>;
}

function QueueRow({ entry, onClick }: { entry: QueueEntry; onClick: () => void }) {
  const label = entry.bucket === 'review' ? 'รอตรวจ' : bucketInfo[entry.bucket].label;
  if (entry.match) return <button className="queue-row pair" onClick={onClick}>
    <div className="pair-thumbs">{entry.bill && <img src={imageUrl(entry.bill.id)} alt="บิล" loading="lazy" />}{entry.slip && <img src={imageUrl(entry.slip.id)} alt="สลิป" loading="lazy" />}</div>
    <span><span className={`status-pill ${entry.bucket}`}>{label}</span><strong>{entry.bill?.vendor_name || entry.bill?.supplier_name || `คู่ #${entry.match.id}`}</strong><small>บิล {money(itemAmount(entry.bill || {}))} · โอน {money(itemAmount(entry.slip || {}))}</small></span><ChevronRight />
  </button>;
  const item = entry.item;
  const cash = Boolean(item.cash_payment_id);
  return <button className={`queue-row ${cash ? 'cash' : ''}`} onClick={onClick}><img src={imageUrl(item.id)} alt="" loading="lazy" /><span><span className={`status-pill ${cash ? 'cash' : entry.bucket}`}>{cash ? 'จ่ายเงินสด' : label}</span><strong>{item.vendor_name || item.supplier_name || item.ai_title || `รูป #${item.id}`}</strong><small>{money(itemAmount(item))} บาท · {cash ? item.cash_recipient_name : item.sender_display_name || 'ไม่ทราบผู้ส่ง'} · {lineTime(item)}</small></span><ChevronRight /></button>;
}

function UndoMatch() {
  const qc = useQueryClient();
  const [entry, setEntry] = useState<{ billId: number; slipId: number; at: number } | null>(() => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem('mobileUndo') || 'null');
      return parsed && Date.now() - parsed.at < 8_000 ? parsed : null;
    } catch { return null; }
  });
  useEffect(() => {
    if (!entry) return;
    const timer = window.setTimeout(() => { setEntry(null); sessionStorage.removeItem('mobileUndo'); }, Math.max(0, 8_000 - (Date.now() - entry.at)));
    return () => window.clearTimeout(timer);
  }, [entry]);
  if (!entry) return null;
  const undo = async () => {
    await api.mutate('/api/admin/matches', { bill_item_id: entry.billId, slip_item_id: entry.slipId, status: 'pending', score: 100, reasons: ['ย้อนกลับภายใน 8 วินาที'] });
    sessionStorage.removeItem('mobileUndo'); setEntry(null); await qc.invalidateQueries();
  };
  return <div className="undo-toast"><span>ยืนยันคู่แล้ว</span><button onClick={undo}>เลิกทำ</button></div>;
}

function CloseDay({ date, sourceId, unresolved }: { date: string; sourceId: string; unresolved: number }) {
  const qc = useQueryClient();
  const mutation = useMutation({ mutationFn: () => api.mutate('/api/admin/days/close', { business_date: date, source_id: sourceId }), onSuccess: () => qc.invalidateQueries({ queryKey: ['days'] }) });
  const close = () => {
    if (unresolved && !window.confirm(`ยังมี ${unresolved} รายการที่ต้องจัดการ ต้องการลองปิดรอบหรือไม่`)) return;
    mutation.mutate();
  };
  return <><button className="primary-button" onClick={close} disabled={mutation.isPending}><Check /> ปิดรอบวันนี้</button>
    {mutation.isSuccess && <a className="secondary-button" href={`/admin/day-report?date=${date}&group=${sourceId}&autoprint=0`} target="_blank"><FileText /> ดูรายงาน</a>}
    <ErrorBox error={mutation.error} /></>;
}

function ReviewPage() {
  const { kind = 'item', id = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const date = search.get('date') || bangkokToday(); const sourceId = search.get('source') || '';
  const { items, pool, matches } = useDayData(date, sourceId);
  const match = kind === 'match' ? (matches.data || []).find((row) => String(row.id) === id) : null;
  const selectedItemId = Number(search.get('item') || id);
  const item = (pool.data || []).find((row) => Number(row.id) === selectedItemId);
  const bill = match ? (pool.data || []).find((row) => Number(row.id) === Number(match.bill_item_id)) : (item?.category?.startsWith('bill') ? item : null);
  const slip = match ? (pool.data || []).find((row) => Number(row.id) === Number(match.slip_item_id)) : (['transfer', 'transfer_notice'].includes(item?.category) ? item : null);
  const [note, setNote] = useState(''); const [learn, setLearn] = useState(false); const [picker, setPicker] = useState(false);
  const [receipt, setReceipt] = useState(false); const [batch, setBatch] = useState(false);
  const [cashForm, setCashForm] = useState(false);
  const editAmount = async () => {
    if (!item) return;
    const isSlip = ['transfer', 'transfer_notice', 'incoming_transfer'].includes(item.category);
    const label = isSlip ? 'สลิป' : 'บิล';
    const value = window.prompt(`แก้ยอด${label}`, String(itemAmount(item) || ''));
    if (!value) return;
    const parsed = Number(value.replace(/,/g, ''));
    if (!(parsed > 0)) return window.alert('กรุณาระบุยอดมากกว่า 0 บาท');
    let result;
    try { result = await api.mutate(`/api/admin/items/${item.id}`, isSlip ? { slip_amount_text: value } : { bill_total_text: value }, 'PATCH'); }
    catch (error) { if ((error as any)?.code === 'decision_cancelled') return; throw error; }
    await qc.invalidateQueries();
    if (result.auto_match_id) {
      navigate(`/review/match/${result.auto_match_id}?date=${date}&source=${sourceId}&bucket=review&item=${result.auto_match_bill_id || item.id}`, { replace: true });
      return;
    }
    window.alert('บันทึกยอดแล้ว ระบบลองจับคู่ใหม่แล้ว แต่ยังไม่พบคู่ที่ผ่านเกณฑ์');
  };
  const [preview, setPreview] = useState<Row | null>(null); const [chatOpen, setChatOpen] = useState(false);
  const contextItemId = Number((item || bill || slip)?.id || 0);
  const context = useQuery({ queryKey: ['context', contextItemId], enabled: Boolean(contextItemId && chatOpen), queryFn: () => api.context(contextItemId) });
  const queue = buildQueueEntries(items.data || [], pool.data || [], matches.data || []).filter((entry) => entry.bucket === 'review');
  const currentIndex = queue.findIndex((entry) => String(entry.match?.id) === String(match?.id));
  const nextEntry = currentIndex >= 0 ? queue[currentIndex + 1] : undefined;
  const goNext = () => nextEntry
    ? navigate(`/review/match/${nextEntry.match?.id}?date=${date}&source=${sourceId}&bucket=review&item=${nextEntry.bill?.id || nextEntry.item.id}`, { replace: true })
    : navigate(`/day/${date}/${sourceId}`, { replace: true });
  const mutateMatch = useMutation({
    mutationFn: (status: string) => api.mutate('/api/admin/matches', {
      bill_item_id: bill?.id, slip_item_id: slip?.id, status, score: match?.score || 100,
      reasons: match?.reasons || ['ตรวจจากมือถือ'], review_note: note, ai_learning_approved: learn
    }),
    onSuccess: (_, status) => {
      if (status === 'confirmed') sessionStorage.setItem('mobileUndo', JSON.stringify({ billId: bill?.id, slipId: slip?.id, at: Date.now() }));
      qc.invalidateQueries(); goNext();
    }
  });
  const classify = async (category: string) => {
    const reason = category === 'other' ? window.prompt('ระบุเหตุผลที่ไม่ใช่เอกสารนี้') : '';
    if (category === 'other' && !reason) return;
    const amountKey = category === 'bill' ? 'bill_total_text' : category === 'transfer' ? 'slip_amount_text' : '';
    const entered = amountKey ? window.prompt(`ระบุยอด${category === 'bill' ? 'บิล' : 'สลิป'}ก่อนบันทึก`, String(itemAmount(item || {}) || '')) : '';
    if (amountKey && entered == null) return;
    const parsed = Number(String(entered).replace(/,/g, '').trim());
    if (amountKey && (!(parsed > 0) || !Number.isFinite(parsed))) return window.alert('กรุณาระบุยอดมากกว่า 0 บาท');
    try { await api.mutate(`/api/admin/items/${item?.id}/category`, { category, reason, ...(amountKey ? { [amountKey]: String(entered).trim() } : {}) }, 'PUT'); }
    catch (error) { if ((error as any)?.code === 'decision_cancelled') return; throw error; }
    await qc.invalidateQueries(); navigate(-1);
  };
  if (pool.isLoading || matches.isLoading) return <Loading />;
  if (!item && !match) return <main><PageHeader back title="ไม่พบรายการ" /><Empty text="รายการอาจถูกย้ายสถานะแล้ว" /></main>;
  const difference = itemAmount(bill || {}) - itemAmount(slip || {}); const exact = Boolean(bill && slip && Math.abs(difference) < .01);
  const isConfirmed = match?.status === 'confirmed';
  const isCash = Boolean(item?.cash_payment_id);
  const voidCash = async () => {
    const reason = window.prompt('ระบุเหตุผลที่ยกเลิกการชำระเงินสด');
    if (!reason) return;
    if (!window.confirm('ยืนยันยกเลิกรายการเงินสด บิลจะกลับไปรอหลักฐานใช่หรือไม่')) return;
    try { await api.mutate(`/api/admin/items/${item?.id}/cash-payment/void`, { reason }); }
    catch (error) { if ((error as any)?.code === 'decision_cancelled') return; throw error; }
    await qc.invalidateQueries(); navigate(`/day/${date}/${sourceId}`, { replace: true });
  };
  return <main className="review-page">
    <PageHeader back title={isCash ? 'บิลจ่ายเงินสด' : isConfirmed ? 'รายการที่ยืนยันแล้ว' : match ? 'ตรวจบิลกับสลิป' : `ตรวจรูป #${item?.id}`} subtitle={`${groupName(sourceId)} · ${shortDate(date)}`} />
    {match && <section className={`decision-banner ${exact ? 'exact' : 'mismatch'}`}>
      {exact ? <BadgeCheck /> : <AlertTriangle />}<div><strong>{exact ? 'ยอดตรงกัน' : `ยอดต่าง ${money(Math.abs(difference))} บาท`}</strong><span>{exact ? 'ตรวจชื่อร้านและหลักฐานก่อนยืนยัน' : 'ยังยืนยันไม่ได้จนกว่าจะเลือกคู่หรือแก้ยอด'}</span></div>
    </section>}
    <div className={`evidence-grid ${match || isCash ? 'paired' : 'single'}`}>
      {bill && <EvidenceCard label="บิล" item={bill} onOpen={() => setPreview(bill)} />}
      {slip && <EvidenceCard label="สลิป" item={slip} onOpen={() => setPreview(slip)} />}
      {isCash && item && <CashEvidenceCard item={item} />}
      {!bill && !slip && item && <EvidenceCard label="รูปที่ส่งมา" item={item} onOpen={() => setPreview(item)} />}
    </div>
    <button className="context-button" onClick={() => setChatOpen(true)}><MessageCircle /><span><strong>ดูข้อความแชทรอบรูปนี้</strong><small>ใช้ตรวจว่าเป็นค่าอะไรและใครเป็นผู้ส่ง</small></span><ChevronRight /></button>
    {match && <section className="review-facts">
      <div><span>ร้าน/ผู้รับเงิน</span><strong>{bill?.vendor_name || bill?.supplier_name || slip?.vendor_name || '-'}</strong></div>
      <div><span>เวลาเอกสาร</span><strong>{bill && slip ? `${lineTime(bill)} / ${lineTime(slip)}` : '-'}</strong></div>
      <details><summary>หมายเหตุและส่งให้ AI เรียนรู้</summary><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="พิมพ์สิ่งที่ AI ควรรู้จากคู่นี้" /><label className="check-row"><input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} /> ใช้หมายเหตุนี้เป็นตัวอย่างให้ AI</label></details>
    </section>}
    {!match && item && !isCash && <OperationalTools item={item} onReceipt={() => setReceipt(true)} onBatch={() => setBatch(true)} />}
    <div className="sticky-actions">
      {match && !isConfirmed && <>
        <button className="secondary-button" onClick={() => setPicker(true)}>เปลี่ยนคู่</button>
        <button className="danger-button" onClick={() => mutateMatch.mutate('rejected')}>ไม่ใช่คู่</button>
        <button className="primary-button grow" onClick={() => mutateMatch.mutate('confirmed')} disabled={!exact || mutateMatch.isPending}><Check /> {nextEntry ? 'ยืนยัน · คู่ถัดไป' : 'ยืนยัน'}</button>
      </>}
      {match && isConfirmed && <button className="primary-button grow" onClick={() => navigate(-1)}><ArrowLeft /> กลับรายการ</button>}
      {isCash && item && <><button className="secondary-button" onClick={() => setCashForm(true)}>แก้ข้อมูล</button><button className="danger-button grow" onClick={voidCash}>ยกเลิกเงินสด</button></>}
      {!match && item && !isCash && <>
        {['bill', 'transfer', 'transfer_notice', 'incoming_transfer'].includes(item.category) && <button className="secondary-button" onClick={editAmount}>แก้ยอด{item.category === 'bill' ? 'บิล' : 'สลิป'}</button>}
        {['bill', 'bill_page', 'transfer', 'transfer_notice'].includes(item.category) && <button className="secondary-button" onClick={() => classify('other')}>ไม่ใช่{item.category.startsWith('bill') ? 'บิล' : 'สลิป'}</button>}
        {item.category === 'other' && <><button className="secondary-button" onClick={() => classify('bill')}>เป็นบิล</button><button className="secondary-button" onClick={() => classify('transfer')}>เป็นสลิป</button></>}
        {item.category === 'bill' && <button className="cash-button" onClick={() => setCashForm(true)}><Banknote /> เงินสด</button>}
        {item.category !== 'other' && <button className="primary-button grow" onClick={() => setPicker(true)}><Link2 /> เลือก{item.category?.startsWith('bill') ? 'สลิป' : 'บิล'}</button>}
      </>}
    </div>
    <ErrorBox error={mutateMatch.error} />
    {picker && (item || bill || slip) && <CandidatePicker current={(item || bill || slip)!} bill={bill} slip={slip} date={date} sourceId={sourceId} onClose={() => setPicker(false)} />}
    {preview && <ImageSheet item={preview} bill={bill} slip={slip} onClose={() => setPreview(null)} onChange={setPreview} />}
    {chatOpen && <div className="sheet-backdrop"><section className="full-sheet chat-sheet"><header><div><h2>แชทรอบเอกสาร</h2><p>{groupName(sourceId)} · {shortDate(date)}</p></div><button className="icon-button" onClick={() => setChatOpen(false)}><X /></button></header><ChatContext rows={context.data?.messages || []} loading={context.isLoading} /></section></div>}
    {receipt && item && <ReceiptSubstitute item={item} onClose={() => setReceipt(false)} />}
    {batch && item && <BatchSplit item={item} onClose={() => setBatch(false)} />}
    {cashForm && item && <CashPaymentSheet item={item} editing={isCash} onClose={() => setCashForm(false)} onSaved={async () => { setCashForm(false); await qc.invalidateQueries(); navigate(`/day/${date}/${sourceId}?bucket=done`, { replace: true }); }} />}
  </main>;
}

function EvidenceCard({ label, item, onOpen }: { label: string; item: Row; onOpen: () => void }) {
  return <button className="evidence-card" onClick={onOpen}><span className="evidence-label">{label}</span><img src={imageUrl(item.id)} alt={label} /><div><strong>{money(itemAmount(item))}</strong><small>บาท</small></div><p>{item.vendor_name || item.supplier_name || item.ai_title || `รูป #${item.id}`}</p><span className="tap-hint"><ZoomIn /> แตะเพื่อขยาย</span></button>;
}

function CashEvidenceCard({ item }: { item: Row }) {
  return <section className="cash-evidence-card"><span className="evidence-label">เงินสด</span><Banknote /><strong>{money(item.cash_payment_amount)} บาท</strong><dl><dt>ผู้รับเงิน</dt><dd>{item.cash_recipient_name || '-'}</dd><dt>หมายเหตุ</dt><dd>{item.cash_payment_note || '-'}</dd><dt>ยืนยันเมื่อ</dt><dd>{item.cash_confirmed_at ? new Date(item.cash_confirmed_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</dd></dl></section>;
}

function ImageSheet({ item, bill, slip, onClose, onChange }: { item: Row; bill?: Row | null; slip?: Row | null; onClose: () => void; onChange: (item: Row) => void }) {
  return <div className="sheet-backdrop"><section className="full-sheet image-sheet"><header><div><h2>{item.id === bill?.id ? 'บิล' : item.id === slip?.id ? 'สลิป' : 'เอกสาร'}</h2><p>{money(itemAmount(item))} บาท · รูป #{item.id}</p></div><button className="icon-button" onClick={onClose}><X /></button></header>
    {bill && slip && <div className="image-switch"><button className={item.id === bill.id ? 'active' : ''} onClick={() => onChange(bill)}>บิล</button><button className={item.id === slip.id ? 'active' : ''} onClick={() => onChange(slip)}>สลิป</button></div>}
    <DocumentViewer item={item} /><DocumentMeta item={item} />
  </section></div>;
}

function DocumentViewer({ item }: { item: Row }) {
  return <div className="viewer">
    <TransformWrapper initialScale={1} minScale={1} maxScale={5} centerOnInit>
      {({ zoomIn, zoomOut, resetTransform }) => <>
        <div className="zoom-tools"><button onClick={() => zoomOut()} aria-label="ย่อ"><ZoomOut /></button><button onClick={() => resetTransform()} aria-label="ขนาดจริง"><ImageIcon /></button><button onClick={() => zoomIn()} aria-label="ขยาย"><ZoomIn /></button></div>
        <TransformComponent wrapperClass="zoom-wrapper" contentClass="zoom-content"><img src={imageUrl(item.id)} alt={`เอกสารรูป ${item.id}`} /></TransformComponent>
      </>}
    </TransformWrapper>
  </div>;
}

function DocumentMeta({ item }: { item: Row }) {
  return <section className="meta-panel">
    <div><span>ประเภท</span><b>{item.category || '-'}</b></div><div><span>ยอด</span><b>{money(itemAmount(item))} บาท</b></div>
    <div><span>ผู้ส่ง</span><b>{item.sender_display_name || item.sender_name || '-'}</b></div><div><span>ร้าน/รายการ</span><b>{item.vendor_name || item.supplier_name || item.ai_title || '-'}</b></div>
    {item.ai_summary && <p>{item.ai_summary}</p>}
  </section>;
}

function OperationalTools({ item, onReceipt, onBatch }: { item: Row; onReceipt: () => void; onBatch: () => void }) {
  const qc = useQueryClient(); const [amount, setAmount] = useState(String(item.bill_total_value || ''));
  const bill = String(item.category).startsWith('bill'); const slip = ['transfer', 'transfer_notice'].includes(item.category);
  const saveAmount = async () => {
    if (!amount || !window.confirm(`แก้ยอดบิลเป็น ${money(amount)} บาท ใช่หรือไม่`)) return;
    try { await api.mutate(`/api/admin/items/${item.id}`, { bill_total_text: amount }, 'PATCH'); }
    catch (error) { if ((error as any)?.code === 'decision_cancelled') return; throw error; }
    await qc.invalidateQueries();
  };
  const requestTransfer = async () => {
    const defaultText = `แจ้งโอน ${item.vendor_name || item.supplier_name || `บิลรูป #${item.id}`} ยอด ${money(itemAmount(item))} บาท`;
    const text = window.prompt('ข้อความที่จะส่งเข้ากลุ่ม LINE', defaultText); if (!text) return;
    if (!window.confirm('ยืนยันส่งข้อความนี้เข้ากลุ่ม LINE ใช่หรือไม่')) return;
    try { await api.mutate(`/api/admin/items/${item.id}/request-transfer`, { text }); }
    catch (error) { if ((error as any)?.code === 'decision_cancelled') return; throw error; }
  };
  return <section className="operation-tools">
    {bill && <><div className="amount-editor"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="ยอดบิล" /><button onClick={saveAmount}>บันทึกยอด</button></div><button className="secondary-button" onClick={requestTransfer}><Send /> แจ้งให้โอนในกลุ่ม</button></>}
    {slip && <button className="secondary-button" onClick={onReceipt}><FileText /> สร้างใบแทนใบเสร็จรับเงิน</button>}
    {item.category === 'other' && <button className="secondary-button" onClick={onBatch}><ListChecks /> แยกรายการจ่ายหลายราย</button>}
  </section>;
}

function CashPaymentSheet({ item, editing, onClose, onSaved }: { item: Row; editing: boolean; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [recipient, setRecipient] = useState(editing ? String(item.cash_recipient_name || '') : '');
  const [note, setNote] = useState(editing ? String(item.cash_payment_note || '') : '');
  const mutation = useMutation({
    mutationFn: () => api.mutate(`/api/admin/items/${item.id}/cash-payment`, { recipient_name: recipient, note }, editing ? 'PATCH' : 'POST'),
    onSuccess: onSaved
  });
  return <div className="sheet-backdrop"><section className="full-sheet form-sheet cash-sheet"><header><div><h2>{editing ? 'แก้ข้อมูลเงินสด' : 'ยืนยันจ่ายเงินสด'}</h2><p>บันทึกเต็มยอดและอยู่ในรอบวันที่ของบิล</p></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <div className="cash-form-summary"><Banknote /><span><small>ยอดเงินสด</small><strong>{money(itemAmount(item))} บาท</strong></span><span><small>วันที่รอบ</small><strong>{shortDate(businessDate(item))}</strong></span></div>
    <label>ชื่อผู้รับเงิน<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="ชื่อร้านหรือผู้รับเงิน" /></label>
    <label>หมายเหตุ<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="ระบุว่าใครรับเงินหรือจ่ายค่าอะไร" /></label>
    <div className="notice cash-notice"><AlertTriangle size={18} />เมื่อยืนยันแล้วบิลนี้จะไม่ถูกนำไปจับคู่กับสลิป</div>
    <ErrorBox error={mutation.error} /><button className="primary-button" onClick={() => mutation.mutate()} disabled={!recipient.trim() || !note.trim() || mutation.isPending}><Check /> {editing ? 'บันทึกการแก้ไข' : 'ยืนยันชำระเงินสด'}</button>
  </section></div>;
}

function ChatContext({ rows, loading }: { rows: Row[]; loading: boolean }) {
  if (loading) return <Loading />;
  return <section className="chat-view">{rows.map((row) => <div className={`chat-message ${row.message_type === 'image' ? 'image' : ''}`} key={row.id || row.message_id}>
    <strong>{row.sender_display_name || row.sender_name || 'สมาชิก'}</strong>
    {row.message_type === 'image' && (row.capture_item_id || row.item_id) ? <img src={imageUrl(row.capture_item_id || row.item_id)} alt="รูปในแชท" /> : <p>{row.message_text || row.text || ''}</p>}
    <small>{row.created_at_line || row.timestamp || ''}</small>
  </div>)}{!rows.length && <Empty text="ไม่พบข้อความรอบเอกสารนี้" />}</section>;
}

function CandidatePicker({ current, bill, slip, date, sourceId, onClose }: { current: Row; bill?: Row | null; slip?: Row | null; date: string; sourceId: string; onClose: () => void }) {
  const qc = useQueryClient(); const navigate = useNavigate();
  const needSlip = Boolean(bill || current?.category?.startsWith('bill'));
  const [days, setDays] = useState(7); const [allGroups, setAllGroups] = useState(false); const [query, setQuery] = useState('');
  const candidates = useQuery({ queryKey: ['candidates', needSlip, date, sourceId, days, allGroups], queryFn: async () => {
    const filters = { start: addDays(date, -days), end: addDays(date, days), source_id: allGroups ? '' : sourceId, match_status: 'unmatched' };
    if (!needSlip) return api.items({ ...filters, category: 'bill' });
    const [transfers, notices] = await Promise.all([api.items({ ...filters, category: 'transfer' }), api.items({ ...filters, category: 'transfer_notice' })]);
    return [...transfers, ...notices];
  } });
  const baseAmount = itemAmount(bill || slip || current);
  const rows = (candidates.data || []).filter((r) => Number(r.id) !== Number(current.id) && `${r.vendor_name || ''} ${r.supplier_name || ''} ${r.sender_display_name || ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Math.abs(itemAmount(a) - baseAmount) - Math.abs(itemAmount(b) - baseAmount));
  const choose = async (candidate: Row) => {
    const chosenBill = needSlip ? (bill || current) : candidate; const chosenSlip = needSlip ? candidate : (slip || current);
    let result;
    try { result = await api.mutate('/api/admin/matches', { bill_item_id: chosenBill.id, slip_item_id: chosenSlip.id, status: 'pending', score: 100, reasons: ['ผู้ใช้เลือกจากมือถือ'] }); }
    catch (error) { if ((error as any)?.code === 'decision_cancelled') return; throw error; }
    await qc.invalidateQueries(); onClose();
    if (result?.id) navigate(`/review/match/${result.id}?date=${businessDate(chosenSlip)}&source=${chosenBill.source_id}&bucket=review&item=${chosenBill.id}`, { replace: true });
    else navigate(`/day/${date}/${sourceId}`, { replace: true });
  };
  return <div className="sheet-backdrop"><section className="full-sheet">
    <header><div><h2>เลือก{needSlip ? 'สลิป' : 'บิล'}ที่เกี่ยวข้อง</h2><p>เรียงยอดใกล้เคียงที่สุด และเลือกข้ามวันได้</p></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาร้าน ผู้ส่ง หรือรายการ" />
    <div className="picker-reference"><span>ยอดที่ต้องหา</span><strong>{money(baseAmount)} บาท</strong></div>
    <div className="picker-options"><button onClick={() => setDays(days === 7 ? 31 : 7)}>ค้นหา ±{days} วัน</button><label><input type="checkbox" checked={allGroups} onChange={(e) => setAllGroups(e.target.checked)} /> รวมทุกกลุ่ม</label></div>
    <div className="candidate-list">{rows.map((row) => { const diff = Math.abs(itemAmount(row) - baseAmount); return <button key={row.id} onClick={() => choose(row)}><img src={imageUrl(row.id)} alt="" /><span><strong>{money(itemAmount(row))} บาท</strong><small>{row.vendor_name || row.supplier_name || `รูป #${row.id}`}</small><small>{shortDate(businessDate(row))} · {groupName(row.source_id)} · {row.sender_display_name || '-'}</small></span><b className={diff < .01 ? 'exact' : ''}>{diff < .01 ? 'ยอดตรง' : `ต่าง ${money(diff)}`}</b></button>; })}</div>
    {!rows.length && !candidates.isLoading && <Empty text="ไม่พบเอกสารที่ยังว่างในช่วงนี้" />}
  </section></div>;
}

function ReceiptSubstitute({ item, onClose }: { item: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [payee, setPayee] = useState(item.payee_name || item.transfer_to_name || '');
  const [account, setAccount] = useState(item.payee_account || item.transfer_to_account || '');
  const [description, setDescription] = useState(item.bill_purpose || item.ai_title || '');
  useEffect(() => {
    fetch(`/api/admin/items/${item.id}/receipt-substitute-draft`, { credentials: 'same-origin' }).then((r) => r.json()).then((p) => {
      if (!p.success) return;
      setPayee((v: string) => v || p.data.payee_name || ''); setAccount((v: string) => v || p.data.payee_account || '');
    }).catch(() => {});
  }, [item.id]);
  const mutation = useMutation({ mutationFn: () => api.mutate('/api/admin/receipt-substitutes', {
    slip_item_id: item.id, payee_name: payee, payee_account: account, description
  }), onSuccess: async () => { await qc.invalidateQueries(); onClose(); } });
  return <div className="sheet-backdrop"><section className="full-sheet form-sheet"><header><div><h2>ใบแทนใบเสร็จรับเงิน</h2><p>ผู้จ่ายกำหนดเป็น บริษัท โซลาว จำกัด</p></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <label>ชื่อผู้รับเงิน<input value={payee} onChange={(e) => setPayee(e.target.value)} /></label>
    <label>บัญชีผู้รับ<input value={account} onChange={(e) => setAccount(e.target.value)} /></label>
    <label>รายละเอียดค่าใช้จ่าย<textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <div className="form-total">ยอดเงิน <strong>{money(itemAmount(item))} บาท</strong></div>
    <ErrorBox error={mutation.error} /><button className="primary-button" onClick={() => mutation.mutate()} disabled={!payee || !description || mutation.isPending}><FileText /> สร้างและปิดหลักฐาน</button>
  </section></div>;
}

function BatchSplit({ item, onClose }: { item: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState([{ supplier_name: '', amount: '', excluded: false }, { supplier_name: '', amount: '', excluded: false }]);
  const update = (index: number, key: string, value: string | boolean) => setLines(lines.map((line, i) => i === index ? { ...line, [key]: value } : line));
  const mutation = useMutation({ mutationFn: () => api.mutate(`/api/admin/items/${item.id}/split-batch-payment`, { lines: lines.filter((line) => line.supplier_name || line.amount).map((line) => ({ ...line, amount: Number(String(line.amount).replace(/,/g, '')) })) }), onSuccess: async () => { await qc.invalidateQueries(); onClose(); } });
  return <div className="sheet-backdrop"><section className="full-sheet form-sheet"><header><div><h2>แยกรายการจ่ายหลายราย</h2><p>หนึ่งแถวต่อซัพพลายเออร์ ยกเว้นแถวจัดรวมได้</p></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <div className="batch-lines">{lines.map((line, index) => <div className="batch-line" key={index}><input value={line.supplier_name} onChange={(e) => update(index, 'supplier_name', e.target.value)} placeholder="ชื่อร้าน/ซัพพลายเออร์" /><input inputMode="decimal" value={line.amount} onChange={(e) => update(index, 'amount', e.target.value)} placeholder="ยอดเงิน" /><label><input type="checkbox" checked={line.excluded} onChange={(e) => update(index, 'excluded', e.target.checked)} /> ไม่รวมจ่าย</label>{lines.length > 1 && <button className="icon-button" onClick={() => setLines(lines.filter((_, i) => i !== index))}><X /></button>}</div>)}</div>
    <button className="secondary-button" onClick={() => setLines([...lines, { supplier_name: '', amount: '', excluded: false }])}><Plus /> เพิ่มแถว</button><ErrorBox error={mutation.error} /><button className="primary-button" onClick={() => mutation.mutate()} disabled={mutation.isPending}><Check /> บันทึกรายการแยก</button>
  </section></div>;
}

function GroupBuilder() {
  const { date = bangkokToday(), sourceId = '' } = useParams(); const navigate = useNavigate(); const qc = useQueryClient();
  const { items } = useDayData(date, sourceId); const [bills, setBills] = useState<number[]>([]); const [slips, setSlips] = useState<number[]>([]);
  const rows = items.data || []; const billRows = rows.filter((r) => classifyItem(r) === 'bill'); const slipRows = rows.filter((r) => classifyItem(r) === 'slip'); const otherRows = rows.filter((r) => classifyItem(r) === 'other');
  const selectedBills = billRows.filter((r) => bills.includes(Number(r.id))); const selectedSlips = slipRows.filter((r) => slips.includes(Number(r.id))); const totals = equalAmounts(selectedBills, selectedSlips);
  const toggle = (id: number, list: number[], setter: (v: number[]) => void) => setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const mutation = useMutation({ mutationFn: () => api.mutate('/api/admin/match-groups', { bill_item_ids: bills, slip_item_ids: slips, status: 'pending', replace_existing: true, reasons: ['รวมเอกสารจากมือถือโดยผู้ใช้ยืนยัน'] }), onSuccess: async () => { await qc.invalidateQueries(); navigate(-1); } });
  return <main className="group-page"><PageHeader back title="รวมบิลและสลิป" subtitle={shortDate(date)} />
    <div className={`group-totals ${Math.abs(totals.difference) < .01 && bills.length && slips.length ? 'balanced' : ''}`}><span>บิล <b>{money(totals.billTotal)}</b></span><span>สลิป <b>{money(totals.slipTotal)}</b></span><span>ผลต่าง <b>{money(totals.difference)}</b></span></div>
    <PickerColumn title="เลือกบิล" rows={billRows} selected={bills} onToggle={(id) => toggle(id, bills, setBills)} />
    <PickerColumn title="เลือกสลิป" rows={slipRows} selected={slips} onToggle={(id) => toggle(id, slips, setSlips)} />
    <OtherDocuments rows={otherRows} />
    <ErrorBox error={mutation.error} /><div className="group-submit"><button className="primary-button" disabled={!bills.length || !slips.length || mutation.isPending} onClick={() => window.confirm('ยืนยันสร้างชุดนี้ หากเอกสารมีคู่เดิม คู่เดิมจะถูกยกเลิก') && mutation.mutate()}><Link2 /> สร้างรายการรวมเพื่อตรวจ</button></div>
  </main>;
}

function OtherDocuments({ rows }: { rows: Row[] }) {
  const qc = useQueryClient(); const [open, setOpen] = useState(false);
  const classify = async (row: Row, category: string) => {
    const amountKey = category === 'bill' ? 'bill_total_text' : 'slip_amount_text';
    const entered = window.prompt(`ระบุยอด${category === 'bill' ? 'บิล' : 'สลิป'}ก่อนบันทึก`, String(itemAmount(row) || ''));
    if (entered == null) return;
    const parsed = Number(String(entered).replace(/,/g, '').trim());
    if (!(parsed > 0) || !Number.isFinite(parsed)) return window.alert('กรุณาระบุยอดมากกว่า 0 บาท');
    try { await api.mutate(`/api/admin/items/${row.id}/category`, { category, reason: 'ผู้ใช้เลือกจากหน้ารวมเอกสาร', [amountKey]: String(entered).trim() }, 'PUT'); }
    catch (error) { if ((error as any)?.code === 'decision_cancelled') return; throw error; }
    await qc.invalidateQueries();
  };
  return <section className="picker-column other-picker"><button className="other-toggle" onClick={() => setOpen(!open)}><Plus /> เลือกจากเอกสารอื่น <b>{rows.length}</b></button>{open && rows.map((row) => <div className="other-row" key={row.id}><img src={imageUrl(row.id)} alt="" /><span><strong>{row.ai_title || row.vendor_name || `รูป #${row.id}`}</strong><small>{money(itemAmount(row))} บาท</small></span><button onClick={() => classify(row, 'bill')}>เป็นบิล</button><button onClick={() => classify(row, 'transfer')}>เป็นสลิป</button></div>)}</section>;
}

function PickerColumn({ title, rows, selected, onToggle }: { title: string; rows: Row[]; selected: number[]; onToggle: (id: number) => void }) {
  return <section className="picker-column"><div className="section-title"><h2>{title}</h2><span>เลือก {selected.length}</span></div>{rows.map((row) => <label key={row.id}><input type="checkbox" checked={selected.includes(Number(row.id))} onChange={() => onToggle(Number(row.id))} /><img src={imageUrl(row.id)} alt="" /><span><strong>{row.vendor_name || row.supplier_name || `รูป #${row.id}`}</strong><small>{money(itemAmount(row))} บาท</small></span></label>)}{!rows.length && <Empty text="ไม่มีรายการให้เลือก" />}</section>;
}

function FlagsPage() {
  const qc = useQueryClient();
  const flags = useQuery({ queryKey: ['flags'], queryFn: () => api.items({ flagged: 1 }) });
  const resolve = useMutation({ mutationFn: ({ id, use }: { id: number; use: boolean }) => api.mutate(`/api/admin/items/${id}/resolve-flag`, { use_announced: use }), onSuccess: () => qc.invalidateQueries({ queryKey: ['flags'] }) });
  return <main><PageHeader title="ต้องตรวจยอด" subtitle="เทียบยอดบนเอกสารกับยอดที่แจ้งในแชท" /><ErrorBox error={flags.error || resolve.error} />
    <div className="flag-list">{(flags.data || []).map((item) => <article key={item.id}><img src={imageUrl(item.id)} alt="" /><div><strong>{item.vendor_name || item.ai_title || `รูป #${item.id}`}</strong><span className="amount-conflict">เอกสาร {money(itemAmount(item))} / แจ้ง {money(item.announced_amount)}</span><small>{item.sender_display_name || '-'} · {shortDate(businessDate(item))}</small><p>{item.ai_conflict_reason || item.ai_summary || 'ยอดต้องตรวจสอบ'}</p></div><div className="inline-actions"><button onClick={() => window.confirm(`เปลี่ยนยอดเป็น ${money(item.announced_amount)} บาท ใช่หรือไม่`) && resolve.mutate({ id: item.id, use: true })}>ใช้ยอดที่แจ้ง</button><button onClick={() => window.confirm(`ยืนยันยอดเอกสาร ${money(itemAmount(item))} บาท ใช่หรือไม่`) && resolve.mutate({ id: item.id, use: false })}>ยอดเอกสารถูก</button></div></article>)}
      {!flags.data?.length && !flags.isLoading && <Empty text="ไม่มีรายการติดธง" />}</div>
  </main>;
}

function SearchPage() {
  const [searchParams] = useSearchParams(); const sourceId = searchParams.get('source') || '';
  const [query, setQuery] = useState(''); const [submitted, setSubmitted] = useState('');
  const items = useQuery({ queryKey: ['search', submitted, sourceId], enabled: submitted.length >= 2, queryFn: () => api.items({ search: submitted, source_id: sourceId, limit: 100 }) });
  return <main><PageHeader title={searchParams.get('mode') === 'group' ? 'รวมบิลและสลิป' : 'ค้นหาเอกสาร'} subtitle="ค้นหาจากร้าน ยอด ผู้ส่ง หรือข้อความ AI" />
    <form className="search-form" onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim()); }}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="อย่างน้อย 2 ตัวอักษร" /><button><Search /></button></form>
    <div className="document-list">{(items.data || []).map((item) => <Link className="document-row" key={item.id} to={`/review/item/${item.id}?date=${item.business_date || String(item.created_at || '').slice(0, 10) || bangkokToday()}&source=${item.source_id}&item=${item.id}`}><img src={imageUrl(item.id)} alt="" /><span><strong>{item.vendor_name || item.supplier_name || `รูป #${item.id}`}</strong><small>{money(itemAmount(item))} บาท · {groupName(item.source_id)}</small></span><ChevronRight /></Link>)}</div>
  </main>;
}

function MorePage() {
  const ai = useQuery({ queryKey: ['ai-status'], queryFn: api.aiStatus }); const senders = useQuery({ queryKey: ['senders'], queryFn: () => api.senders() });
  return <main><PageHeader title="เพิ่มเติม" subtitle="สถานะระบบและข้อมูลผู้ส่ง" />
    <section className="info-list"><div><Bot /><span><strong>AI {ai.data?.enabled ? 'เปิด' : 'ปิด'}</strong><small>รอ {ai.data?.pending_count ?? ai.data?.queued ?? 0} · {ai.data?.model || '-'}</small></span></div><div><Users /><span><strong>ผู้ส่งที่รู้จัก</strong><small>{senders.data?.length || 0} คน</small></span></div>
      <a href="/admin"><ListChecks /><span><strong>เปิดหลังบ้านเดสก์ท็อป</strong><small>สำหรับงานละเอียดบนจอใหญ่</small></span><ChevronRight /></a>
    </section>
  </main>;
}

function Loading() { return <div className="loading"><span />กำลังโหลดข้อมูล</div>; }
function Empty({ text }: { text: string }) { return <div className="empty"><Minus /><p>{text}</p></div>; }
