import { useEffect, useMemo, useState, useRef } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Input } from '../../../components/common/Input';
import { Select } from '../../../components/common/Select';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { reportsAPI } from '../../../api/reports';
import { masterAPI } from '../../../api/master';
import { productsAPI } from '../../../api/products';
import { aiAPI } from '../../../api/ai';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v, opts = {}) => Number(v || 0).toLocaleString('th-TH', opts);
const fmtBaht = (v) => `฿${fmt(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${Number(v || 0).toFixed(1)}%`;

const deltaColor = (d) => (d === null ? '' : d > 0 ? 'text-emerald-400' : d < 0 ? 'text-red-400' : 'text-gray-400');
const deltaIcon = (d) => (d === null ? '' : d > 0 ? '↑' : d < 0 ? '↓' : '–');

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Badge เปรียบเทียบ % เปลี่ยนแปลงจากช่วงก่อน */
const DeltaBadge = ({ delta }) => {
  if (delta === null || delta === undefined) return null;
  const abs = Math.abs(delta).toFixed(1);
  return (
    <span className={`text-[10px] font-bold ${deltaColor(delta)}`}>
      {deltaIcon(delta)} {abs}% vs ก่อนหน้า
    </span>
  );
};

/** Horizontal bar chart */
const HBar = ({ data, labelKey, valueKey, colorClass = 'bg-blue-500', fmtVal }) => {
  const max = Math.max(...data.map((d) => Number(d[valueKey] || 0)), 1);
  return (
    <div className="space-y-1.5">
      {data.map((item, i) => {
        const val = Number(item[valueKey] || 0);
        return (
          <div key={i} className="flex items-center gap-2">
            <div className="w-5 text-[10px] font-bold text-gray-400 text-right shrink-0">{i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-xs text-gray-700 truncate pr-2">{item[labelKey] || '–'}</p>
                <p className="text-xs font-semibold text-gray-900 shrink-0">
                  {fmtVal ? fmtVal(val) : fmt(val)}
                </p>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100">
                <div
                  className={`h-2 rounded-full ${colorClass}`}
                  style={{ width: `${Math.max((val / max) * 100, 2)}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Donut chart (SVG) */
const Donut = ({ data, labelKey, valueKey }) => {
  const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#6366f1'];
  const total = data.reduce((s, d) => s + Number(d[valueKey] || 0), 0);
  const polar = (cx, cy, r, deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  let cum = 0;
  const slices = data.slice(0, 8).map((item, i) => {
    const pct = total ? Number(item[valueKey] || 0) / total : 0;
    const start = cum * 360;
    cum += pct;
    return { ...item, pct, start, end: cum * 360, color: COLORS[i % COLORS.length] };
  });
  return (
    <div className="flex gap-4 items-start flex-wrap">
      <svg width="110" height="110" className="shrink-0">
        {slices.map((s, i) => {
          const p1 = polar(55, 55, 50, s.end);
          const p2 = polar(55, 55, 50, s.start);
          return (
            <path
              key={i}
              d={`M 55 55 L ${p1.x} ${p1.y} A 50 50 0 ${s.end - s.start > 180 ? 1 : 0} 0 ${p2.x} ${p2.y} Z`}
              fill={s.color} opacity={0.9}
            />
          );
        })}
        <circle cx="55" cy="55" r="26" fill="white" />
        <text x="55" y="60" textAnchor="middle" fontSize="9" fill="#6b7280">{data.length} กลุ่ม</text>
      </svg>
      <div className="flex-1 space-y-1.5 min-w-0">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
            <p className="flex-1 truncate text-gray-700">{s[labelKey] || 'ไม่ระบุ'}</p>
            <p className="font-semibold text-gray-900 shrink-0">{(s.pct * 100).toFixed(1)}%</p>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Pareto cumulative chart (SVG-based) */
const ParetoChart = ({ data, valueKey }) => {
  if (!data.length) return null;
  const total = data.reduce((s, d) => s + Number(d[valueKey] || 0), 0);
  const W = 500, H = 100;
  let cum = 0;
  const points = data.map((d, i) => {
    cum += Number(d[valueKey] || 0) / total;
    return { x: ((i + 1) / data.length) * W, y: H - cum * H };
  });
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${W} ${H} L 0 ${H} Z`;
  const y80 = H - 0.8 * H;
  // find 80% threshold index
  let cum2 = 0;
  let idx80 = data.length - 1;
  for (let i = 0; i < data.length; i++) {
    cum2 += Number(data[i][valueKey] || 0) / total;
    if (cum2 >= 0.8) { idx80 = i; break; }
  }
  const x80 = ((idx80 + 1) / data.length) * W;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + 4}`} className="w-full h-24" preserveAspectRatio="none">
        <defs>
          <linearGradient id="paretoGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#paretoGrad)" />
        <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
        {/* 80% threshold line */}
        <line x1={0} y1={y80} x2={W} y2={y80} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 3" />
        <line x1={x80} y1={0} x2={x80} y2={H} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 3" />
        <circle cx={x80} cy={y80} r="5" fill="#f59e0b" />
        <text x={x80 + 6} y={y80 - 4} fontSize="9" fill="#d97706" fontWeight="bold">80%</text>
      </svg>
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────────
export const SalesReport = () => {
  const fmtDateInput = (d) => {
    const o = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return o.toISOString().split('T')[0];
  };

  const today = fmtDateInput(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [report, setReport] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [loading, setLoading] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const searchInputRef = useRef(null);

  useEffect(() => {
    fetchBranches();
    fetchProducts();
    handleLoadReport();
  }, []);

  useEffect(() => {
    const fn = (e) => {
      if (searchInputRef.current && !searchInputRef.current.contains(e.target)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const fetchBranches = async () => {
    try {
      const data = await masterAPI.getBranches();
      setBranches(Array.isArray(data) ? data : []);
    } catch { setBranches([]); }
  };

  const fetchProducts = async () => {
    try {
      const r = await productsAPI.getProducts();
      setAllProducts(Array.isArray(r?.data) ? r.data : []);
    } catch { setAllProducts([]); }
  };

  const handleLoadReport = async (options = {}) => {
    try {
      setLoading(true);
      const rawSearch = options.search !== undefined ? options.search : search;
      const response = await reportsAPI.getSalesReport({
        start: options.start || startDate,
        end: options.end || endDate,
        branchId: branchId || undefined,
        search: rawSearch.trim() || undefined,
        limit: options.limit || undefined
      });
      const data = response?.data ?? response;
      setReport(data);
      setSelectedGroup('');
      if (options.search !== undefined) setSearch(rawSearch);
      setChatMessages([]);
      setChatInput('');
    } catch (error) {
      alert(error.response?.data?.message || 'ไม่สามารถโหลดรายงานยอดขายได้');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const applyQuickRange = (range) => {
    const now = new Date();
    let start = new Date(now), end = new Date(now);
    if (range === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end = new Date(start);
    } else if (range === 'week') {
      start.setDate(start.getDate() - 6);
    } else if (range === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (range === 'last30') {
      start.setDate(start.getDate() - 29);
    } else if (range === 'lastmonth') {
      // วันที่ 1 – วันสุดท้ายของเดือนที่แล้ว
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (range === 'last3months') {
      start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    }
    const s = fmtDateInput(start), e = fmtDateInput(end);
    setStartDate(s); setEndDate(e);
    handleLoadReport({ start: s, end: e });
  };

  const branchOptions = useMemo(
    () => branches.map((b) => ({ value: b.id, label: b.clickhouse_branch_id ? b.name : `${b.name} (ไม่มี ClickHouse ID)` })),
    [branches]
  );

  // ── Computed Data ────────────────────────────────────────────────────────────
  const totals = useMemo(() => ({
    billCount: Number(report?.summary?.bill_count || 0),
    totalRevenue: Number(report?.summary?.total_revenue || 0)
  }), [report]);

  const prevTotals = useMemo(() => ({
    billCount: Number(report?.prev_summary?.bill_count || 0),
    totalRevenue: Number(report?.prev_summary?.total_revenue || 0)
  }), [report]);

  const deltas = useMemo(() => {
    const rev = prevTotals.totalRevenue > 0 ? ((totals.totalRevenue - prevTotals.totalRevenue) / prevTotals.totalRevenue) * 100 : null;
    const bills = prevTotals.billCount > 0 ? ((totals.billCount - prevTotals.billCount) / prevTotals.billCount) * 100 : null;
    const avgCurr = totals.billCount ? totals.totalRevenue / totals.billCount : 0;
    const avgPrev = prevTotals.billCount ? prevTotals.totalRevenue / prevTotals.billCount : 0;
    const avg = avgPrev > 0 ? ((avgCurr - avgPrev) / avgPrev) * 100 : null;
    return { rev, bills, avg };
  }, [totals, prevTotals]);

  const avgPerBill = totals.billCount ? totals.totalRevenue / totals.billCount : 0;
  const menuItems = useMemo(() => report?.items || [], [report]);
  const menuCount = menuItems.length;

  const groupedMenuItems = useMemo(
    () => menuItems.filter((i) => i.group_name && String(i.group_name).trim().length > 0),
    [menuItems]
  );
  const filteredMenuItems = useMemo(() => {
    if (selectedGroup) return groupedMenuItems.filter((i) => i.group_name === selectedGroup);
    return groupedMenuItems.length > 0 ? groupedMenuItems : menuItems;
  }, [groupedMenuItems, menuItems, selectedGroup]);

  const dailySeries = useMemo(() => report?.daily || [], [report]);
  const maxDailyRev = useMemo(() => dailySeries.reduce((m, d) => Math.max(m, Number(d.total_revenue || 0)), 0), [dailySeries]);

  const dailyAvgPerBill = useMemo(
    () => dailySeries.map((d) => ({
      sale_date: String(d.sale_date || '').slice(5),
      avg: Number(d.bill_count) > 0 ? Number(d.total_revenue) / Number(d.bill_count) : 0,
      bill_count: Number(d.bill_count)
    })),
    [dailySeries]
  );

  // Weekday data (1=Mon…7=Sun ตาม ClickHouse toDayOfWeek)
  const WEEKDAY_TH = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
  const WEEKDAY_FULL = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
  const weekdaySeries = useMemo(() => {
    const raw = report?.by_weekday || [];
    const map = new Map(raw.map((r) => [Number(r.day_num), r]));
    return Array.from({ length: 7 }, (_, i) => ({
      day_num: i + 1,
      label: WEEKDAY_TH[i],
      full: WEEKDAY_FULL[i],
      bill_count: Number(map.get(i + 1)?.bill_count || 0),
      total_revenue: Number(map.get(i + 1)?.total_revenue || 0)
    }));
  }, [report]);

  const bestWeekday = useMemo(
    () => weekdaySeries.length ? weekdaySeries.reduce((b, d) => (d.total_revenue > b.total_revenue ? d : b), weekdaySeries[0]) : null,
    [weekdaySeries]
  );
  const hasWeekdayData = useMemo(() => weekdaySeries.some((d) => d.total_revenue > 0), [weekdaySeries]);
  const maxWeekdayRev = useMemo(
    () => weekdaySeries.reduce((m, d) => Math.max(m, d.total_revenue), 0) || 1,
    [weekdaySeries]
  );

  // Hourly
  const hourlySeries = useMemo(() => {
    const raw = report?.by_hour || [];
    const map = new Map(raw.map((r) => [Number(r.sale_hour), r]));
    return Array.from({ length: 24 }, (_, h) => ({
      sale_hour: h,
      label: String(h).padStart(2, '0'),
      bill_count: Number(map.get(h)?.bill_count || 0),
      total_revenue: Number(map.get(h)?.total_revenue || 0)
    }));
  }, [report]);
  const peakHour = useMemo(
    () => hourlySeries.filter((h) => h.total_revenue > 0).sort((a, b) => b.total_revenue - a.total_revenue)[0] || null,
    [hourlySeries]
  );
  const maxHourlyRev = useMemo(() => Math.max(...hourlySeries.map((h) => h.total_revenue), 1), [hourlySeries]);

  // Pareto
  const paretoData = useMemo(() => {
    if (!filteredMenuItems.length) return null;
    const sorted = [...filteredMenuItems].sort((a, b) => Number(b.total_revenue || 0) - Number(a.total_revenue || 0));
    const totalRev = sorted.reduce((s, m) => s + Number(m.total_revenue || 0), 0);
    let cum = 0;
    let idx80 = sorted.length - 1;
    for (let i = 0; i < sorted.length; i++) {
      cum += Number(sorted[i].total_revenue || 0);
      if (cum / totalRev >= 0.8) { idx80 = i; break; }
    }
    const topCount = idx80 + 1;
    const topRevPct = totalRev > 0 ? (sorted.slice(0, topCount).reduce((s, m) => s + Number(m.total_revenue || 0), 0) / totalRev) * 100 : 0;
    const topMenuPct = sorted.length > 0 ? (topCount / sorted.length) * 100 : 0;
    return { sorted, totalRev, topCount, topRevPct, topMenuPct };
  }, [filteredMenuItems]);

  // New vs Dropped menus (vs prev period top 20)
  const menuComparison = useMemo(() => {
    const prevTop = report?.prev_top_items || [];
    const prevSet = new Set(prevTop.map((m) => m.barcode));
    const currSet = new Set(menuItems.map((m) => m.barcode));
    const newMenus = menuItems.filter((m) => !prevSet.has(m.barcode)).slice(0, 8);
    const dropped = prevTop.filter((m) => !currSet.has(m.barcode)).slice(0, 8);
    return { newMenus, dropped };
  }, [menuItems, report]);

  // Top menus
  const top10Revenue = useMemo(() => filteredMenuItems.slice(0, 10), [filteredMenuItems]);
  const top10Qty = useMemo(
    () => [...filteredMenuItems].sort((a, b) => Number(b.total_qty || 0) - Number(a.total_qty || 0)).slice(0, 10),
    [filteredMenuItems]
  );

  const billDist = useMemo(() => report?.bill_dist || [], [report]);
  const groupSeries = useMemo(() => report?.by_group || [], [report]);
  const branchSeries = useMemo(() => report?.by_branch || [], [report]);

  const branchMap = useMemo(() => {
    const m = new Map();
    branches.forEach((b) => { if (b.clickhouse_branch_id) m.set(b.clickhouse_branch_id, b.name); });
    return m;
  }, [branches]);

  // Auto insights
  const insights = useMemo(() => {
    if (!report) return [];
    const list = [];
    if (deltas.rev !== null) {
      list.push({
        icon: deltas.rev >= 0 ? '📈' : '📉',
        color: deltas.rev >= 0 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200',
        text: `ยอดขาย${deltas.rev >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(deltas.rev).toFixed(1)}% เมื่อเทียบกับช่วงก่อนหน้า (${report.prev_start} – ${report.prev_end})`
      });
    }
    if (filteredMenuItems.length > 0) {
      const top = filteredMenuItems[0];
      list.push({
        icon: '🥇',
        color: 'text-amber-700 bg-amber-50 border-amber-200',
        text: `เมนูขายดีที่สุด: "${top.menu_name}" ยอดรวม ${fmtBaht(top.total_revenue)}`
      });
    }
    if (peakHour) {
      list.push({
        icon: '⏰',
        color: 'text-blue-700 bg-blue-50 border-blue-200',
        text: `ช่วงขายดีที่สุด: ${peakHour.label}:00 – ${peakHour.label}:59 น. ยอดรวม ${fmtBaht(peakHour.total_revenue)} (${peakHour.bill_count} บิล)`
      });
    }
    if (bestWeekday && bestWeekday.total_revenue > 0) {
      list.push({
        icon: '📅',
        color: 'text-violet-700 bg-violet-50 border-violet-200',
        text: `วัน${bestWeekday.full}ขายดีที่สุดในสัปดาห์ ยอดรวม ${fmtBaht(bestWeekday.total_revenue)}`
      });
    }
    if (paretoData) {
      list.push({
        icon: '⚡',
        color: 'text-teal-700 bg-teal-50 border-teal-200',
        text: `${paretoData.topCount} เมนู (${paretoData.topMenuPct.toFixed(1)}%) สร้างยอดขายถึง ${paretoData.topRevPct.toFixed(1)}% ของยอดรวม — หลักการ Pareto`
      });
    }
    if (menuComparison.newMenus.length > 0) {
      list.push({
        icon: '✨',
        color: 'text-sky-700 bg-sky-50 border-sky-200',
        text: `มีเมนูใหม่ ${menuComparison.newMenus.length} รายการที่ไม่เคยอยู่ใน Top 20 ช่วงก่อนหน้า`
      });
    }
    return list;
  }, [report, deltas, filteredMenuItems, peakHour, bestWeekday, paretoData, menuComparison]);

  // CSV Export
  const handleExportCSV = () => {
    if (!filteredMenuItems.length) return;
    const headers = ['ลำดับ', 'เมนู', 'Barcode', 'กลุ่ม', 'จำนวน', 'ยอดขาย (บาท)'];
    const rows = filteredMenuItems.map((item, i) => [
      i + 1, item.menu_name, item.barcode, item.group_name || '-',
      Number(item.total_qty || 0).toFixed(2),
      Number(item.total_revenue || 0).toFixed(2)
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // AI Chat
  const reportPayload = useMemo(() => {
    if (!report) return null;
    return {
      start: report.start, end: report.end,
      summary: report.summary, daily: report.daily || [],
      by_branch: report.by_branch || [], by_group: report.by_group || [],
      items: (report.items || []).map(({ menu_name, barcode, total_qty, total_revenue, group_name }) =>
        ({ menu_name, barcode, total_qty, total_revenue, group_name }))
    };
  }, [report]);

  const handleChatSubmit = async () => {
    if (!reportPayload) { alert('กรุณาโหลดรายงานก่อน'); return; }
    const question = chatInput.trim();
    if (!question) return;
    const next = [...chatMessages, { role: 'user', content: question }];
    setChatMessages(next); setChatInput(''); setChatLoading(true);
    try {
      const r = await aiAPI.chatSalesReport({ question, report: reportPayload });
      setChatMessages([...next, { role: 'assistant', content: r?.answer || 'ไม่พบข้อมูล' }]);
    } catch (e) {
      alert(e.response?.data?.message || 'ไม่สามารถเรียก AI ได้');
    } finally { setChatLoading(false); }
  };

  const suggestions = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return allProducts.filter((p) => p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q))).slice(0, 10);
  }, [search, allProducts]);

  const columns = [
    { header: 'เมนู', accessor: 'menu_name', wrap: true },
    { header: 'Barcode', accessor: 'barcode' },
    { header: 'จำนวน', accessor: 'total_qty', render: (r) => fmt(r.total_qty, { maximumFractionDigits: 2 }) },
    { header: 'ยอดขาย', accessor: 'total_revenue', render: (r) => fmt(r.total_revenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
  ];
  const groupColumns = [
    { header: 'กลุ่มสินค้า', accessor: 'group_name', wrap: true },
    { header: 'จำนวน', accessor: 'total_qty', render: (r) => fmt(r.total_qty, { maximumFractionDigits: 2 }) },
    { header: 'ยอดขาย', accessor: 'total_revenue', render: (r) => fmt(r.total_revenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
  ];

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-3"><BackToSettings /></div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">รายงานยอดขาย</h1>
          <p className="text-sm text-gray-500 mt-1">วิเคราะห์ยอดขายเชิงลึก • เมนู • เวลา • แนวโน้ม</p>
        </div>

        {/* ── Filter ── */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Input label="วันที่เริ่มต้น" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input label="วันที่สิ้นสุด" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <Select label="สาขา" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branchOptions} placeholder="รวมทุกสาขา" />
            <div className="relative" ref={searchInputRef}>
              <Input
                label="ค้นหาเมนู" value={search}
                onChange={(e) => { setSearch(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="ชื่อเมนูหรือ barcode" autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                  {suggestions.map((p) => (
                    <div key={p.id} className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                      onClick={() => { setSearch(p.name); setShowSuggestions(false); }}>
                      <div className="font-medium text-gray-900">{p.name}</div>
                      {p.barcode && <div className="text-xs text-gray-500">{p.barcode}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-end">
              <button onClick={handleLoadReport} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                {loading ? 'กำลังโหลด...' : 'โหลดรายงาน'}
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { id: 'today',       label: 'วันนี้' },
              { id: 'yesterday',   label: 'เมื่อวาน' },
              { id: 'week',        label: '7 วัน' },
              { id: 'last30',      label: '30 วัน' },
              { id: 'month',       label: 'เดือนนี้' },
              { id: 'lastmonth',   label: 'เดือนที่แล้ว', highlight: true },
              { id: 'last3months', label: '3 เดือนย้อนหลัง' }
            ].map((s) => (
              <button key={s.id} type="button" onClick={() => applyQuickRange(s.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  s.highlight
                    ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-2 mb-5">
          {[{ id: 'dashboard', label: '📊 แดชบอร์ด' }, { id: 'menu', label: '🍽️ รายการเมนู' }].map((tab) => (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ════════ DASHBOARD TAB ════════ */}
        {activeTab === 'dashboard' && (
          <div className="space-y-5">
            {!report && !loading && (
              <div className="rounded-xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
                <p className="text-4xl mb-3">📊</p>
                <p className="text-sm">โหลดรายงานเพื่อดูแดชบอร์ด</p>
              </div>
            )}
            {loading && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 py-20 text-center">
                <p className="text-blue-500 text-sm animate-pulse">⏳ กำลังโหลดข้อมูล...</p>
              </div>
            )}

            {report && !loading && (
              <>
                {/* ① Auto Insights */}
                {insights.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h2 className="text-sm font-bold text-gray-800 mb-3">💡 สรุปเชิงลึก</h2>
                    <div className="space-y-2">
                      {insights.map((ins, i) => (
                        <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${ins.color}`}>
                          <span className="text-base shrink-0 leading-4">{ins.icon}</span>
                          <p className="leading-5">{ins.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ② KPI Cards with delta */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'ยอดขายรวม', value: fmtBaht(totals.totalRevenue), delta: deltas.rev, color: 'from-blue-500 to-blue-700', icon: '💰', sub: `vs ${fmtBaht(prevTotals.totalRevenue)} ก่อนหน้า` },
                    { label: 'จำนวนบิล', value: fmt(totals.billCount), delta: deltas.bills, color: 'from-emerald-500 to-emerald-700', icon: '🧾', sub: `vs ${fmt(prevTotals.billCount)} บิล ก่อนหน้า` },
                    { label: 'ยอดเฉลี่ย/บิล', value: fmtBaht(avgPerBill), delta: deltas.avg, color: 'from-violet-500 to-violet-700', icon: '📊', sub: 'เฉลี่ยต่อใบเสร็จ' },
                    { label: 'จำนวนเมนู', value: fmt(menuCount), delta: null, color: 'from-amber-500 to-amber-700', icon: '🍽️', sub: 'รายการที่ขายได้' }
                  ].map((card) => (
                    <div key={card.label} className={`rounded-xl bg-gradient-to-br ${card.color} p-4 text-white shadow-sm`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium opacity-75">{card.label}</p>
                          <p className="text-xl font-bold mt-1 leading-tight">{card.value}</p>
                          <div className="mt-1.5 flex items-center gap-1">
                            {card.delta !== null && <DeltaBadge delta={card.delta} />}
                            {card.delta === null && <span className="text-[10px] opacity-60">{card.sub}</span>}
                          </div>
                          {card.delta !== null && <p className="text-[9px] opacity-50 mt-0.5">{card.sub}</p>}
                        </div>
                        <span className="text-2xl opacity-70 shrink-0">{card.icon}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ③ Daily Revenue + Avg/Bill */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h2 className="text-sm font-semibold text-gray-800 mb-4">ยอดขายรายวัน</h2>
                    {dailySeries.length === 0 ? <p className="text-sm text-gray-400">ไม่มีข้อมูล</p> : (
                      <div className="space-y-2">
                        {dailySeries.map((item) => {
                          const rev = Number(item.total_revenue || 0);
                          const bills = Number(item.bill_count || 0);
                          const w = maxDailyRev ? (rev / maxDailyRev) * 100 : 0;
                          return (
                            <div key={item.sale_date} className="flex items-center gap-2">
                              <div className="w-20 text-xs text-gray-500 shrink-0">{item.sale_date}</div>
                              <div className="flex-1">
                                <div className="h-5 rounded-md bg-gray-100 relative overflow-hidden">
                                  <div className="h-5 rounded-md bg-blue-500" style={{ width: `${Math.max(w, 2)}%` }} />
                                  {bills > 0 && <span className="absolute inset-0 flex items-center pl-2 text-[10px] text-white font-medium">{bills} บิล</span>}
                                </div>
                              </div>
                              <div className="text-xs font-semibold text-gray-700 w-24 text-right shrink-0">{fmtBaht(rev)}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-semibold text-gray-800">ยอดเฉลี่ยต่อบิลรายวัน</h2>
                      <span className="text-xs bg-violet-100 text-violet-700 rounded-full px-2 py-0.5 font-semibold">{fmtBaht(avgPerBill)} รวม</span>
                    </div>
                    {dailyAvgPerBill.length === 0 ? <p className="text-sm text-gray-400">ไม่มีข้อมูล</p> : (
                      <div className="space-y-2">
                        {(() => {
                          const maxAvg = Math.max(...dailyAvgPerBill.map((d) => d.avg), 1);
                          return dailyAvgPerBill.map((d, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="w-14 text-[10px] text-gray-500 shrink-0">{d.sale_date}</div>
                              <div className="flex-1">
                                <div className="h-5 rounded-md bg-gray-100 relative overflow-hidden">
                                  <div className="h-5 rounded-md bg-violet-400" style={{ width: `${Math.max((d.avg / maxAvg) * 100, 2)}%` }} />
                                </div>
                              </div>
                              <div className="text-xs font-semibold text-gray-700 w-20 text-right shrink-0">{fmtBaht(d.avg)}</div>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                </div>

                {/* ④ Weekday Performance */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-800">ประสิทธิภาพรายวันในสัปดาห์</h2>
                    {bestWeekday && bestWeekday.total_revenue > 0 && (
                      <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-semibold">
                        วัน{bestWeekday.full} ขายดีสุด 🏆
                      </span>
                    )}
                  </div>
                  {!hasWeekdayData ? (
                    <p className="text-sm text-gray-400">ไม่มีข้อมูล — ลองเลือกช่วงวันที่นานกว่า 1 วัน</p>
                  ) : (
                    <div className="grid grid-cols-7 gap-2">
                      {weekdaySeries.map((d) => {
                        const pct = d.total_revenue / maxWeekdayRev;
                        const isWeekend = d.day_num >= 6;
                        const isBest = bestWeekday && d.day_num === bestWeekday.day_num;
                        const hasData = d.total_revenue > 0;
                        return (
                          <div key={d.day_num} className={`rounded-lg p-2 text-center border transition-colors ${isBest ? 'border-amber-300 bg-amber-50' : isWeekend ? 'border-rose-100 bg-rose-50' : 'border-gray-100 bg-gray-50'}`}>
                            <p className={`text-xs font-bold mb-1 ${isBest ? 'text-amber-700' : isWeekend ? 'text-rose-600' : 'text-gray-500'}`}>{d.label}</p>
                            {/* bar track — always visible */}
                            <div className="h-16 flex items-end justify-center mb-1 relative">
                              {/* grey track */}
                              <div className="absolute bottom-0 w-5 h-full rounded-sm bg-gray-200 opacity-40" />
                              {/* actual bar */}
                              {hasData && (
                                <div
                                  className={`relative z-10 w-5 rounded-sm ${isBest ? 'bg-amber-400' : isWeekend ? 'bg-rose-400' : 'bg-blue-400'}`}
                                  style={{ height: `${Math.max(pct * 100, 6)}%` }}
                                />
                              )}
                            </div>
                            <p className={`text-[9px] leading-tight font-semibold ${hasData ? (isBest ? 'text-amber-700' : 'text-gray-700') : 'text-gray-300'}`}>
                              {hasData ? fmtBaht(d.total_revenue) : '–'}
                            </p>
                            <p className="text-[9px] text-gray-400 mt-0.5">
                              {d.bill_count > 0 ? `${d.bill_count} บิล` : '–'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ⑤ Hourly Chart */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-800">ยอดขายตามช่วงเวลา (24 ชม.)</h2>
                    {peakHour && <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-semibold">{peakHour.label}:00 น. 🔥</span>}
                  </div>
                  {maxHourlyRev === 0 ? <p className="text-sm text-gray-400">ไม่มีข้อมูล</p> : (
                    <>
                      <div className="flex items-end gap-0.5 h-28 w-full mb-1">
                        {hourlySeries.map((h) => {
                          const isPeak = peakHour && h.sale_hour === peakHour.sale_hour;
                          const pct = (h.total_revenue / maxHourlyRev) * 100;
                          return (
                            <div key={h.sale_hour} className="flex-1 flex flex-col items-center group relative">
                              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[9px] rounded px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 z-10 pointer-events-none">
                                {h.label}:00 • {fmtBaht(h.total_revenue)}
                              </div>
                              <div className="w-full flex items-end" style={{ height: '90px' }}>
                                <div
                                  className={`w-full rounded-t-sm ${isPeak ? 'bg-amber-400' : h.total_revenue > 0 ? 'bg-blue-400' : 'bg-gray-100'}`}
                                  style={{ height: `${Math.max(pct, h.total_revenue > 0 ? 3 : 0)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-0.5">
                        {hourlySeries.map((h) => (
                          <div key={h.sale_hour} className="flex-1 text-center text-[8px] text-gray-400">
                            {h.sale_hour % 4 === 0 ? h.label : ''}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[...hourlySeries].filter((h) => h.total_revenue > 0).sort((a, b) => b.total_revenue - a.total_revenue).slice(0, 5).map((h, i) => (
                          <div key={h.sale_hour} className={`rounded-lg px-3 py-1.5 text-xs font-semibold border ${i === 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                            {h.label}:00 น. • {fmtBaht(h.total_revenue)}{i === 0 ? ' 🔥' : ''}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* ⑥ Top Menus */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h2 className="text-sm font-semibold text-gray-800 mb-4">🏆 Top 10 ยอดขายสูงสุด (บาท)</h2>
                    {top10Revenue.length === 0 ? <p className="text-sm text-gray-400">ไม่มีข้อมูล</p> : (
                      <HBar data={top10Revenue} labelKey="menu_name" valueKey="total_revenue" colorClass="bg-blue-500" fmtVal={fmtBaht} />
                    )}
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h2 className="text-sm font-semibold text-gray-800 mb-4">🔢 Top 10 ขายดีสุด (จำนวน)</h2>
                    {top10Qty.length === 0 ? <p className="text-sm text-gray-400">ไม่มีข้อมูล</p> : (
                      <HBar data={top10Qty} labelKey="menu_name" valueKey="total_qty" colorClass="bg-emerald-500"
                        fmtVal={(v) => `${v.toLocaleString('th-TH', { maximumFractionDigits: 1 })} หน่วย`} />
                    )}
                  </div>
                </div>

                {/* ⑦ Pareto Analysis */}
                {paretoData && filteredMenuItems.length >= 3 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-gray-800">การกระจายรายได้ (Pareto)</h2>
                        <p className="text-xs text-gray-500 mt-0.5">เส้นสะสมยอดขายตามอันดับเมนู — เส้นสีเหลืองคือจุด 80%</p>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-xs bg-teal-50 border border-teal-200 text-teal-700 rounded-full px-3 py-1 font-semibold">
                          {paretoData.topCount} เมนู = {paretoData.topRevPct.toFixed(1)}% ของยอดรวม
                        </span>
                        <span className="text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded-full px-3 py-1">
                          {paretoData.topMenuPct.toFixed(1)}% ของเมนูทั้งหมด
                        </span>
                      </div>
                    </div>
                    <ParetoChart data={paretoData.sorted} valueKey="total_revenue" />
                    {/* Top contributors */}
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs text-gray-500 mb-2">เมนูหลักที่สร้าง 80% ของยอด ({paretoData.topCount} รายการแรก):</p>
                      <div className="flex flex-wrap gap-1.5">
                        {paretoData.sorted.slice(0, Math.min(paretoData.topCount, 8)).map((m, i) => {
                          const share = paretoData.totalRev > 0 ? (Number(m.total_revenue || 0) / paretoData.totalRev * 100).toFixed(1) : 0;
                          return (
                            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-2.5 py-1 text-xs text-blue-700">
                              <span className="font-bold">{i + 1}.</span> {m.menu_name} <span className="opacity-60">({share}%)</span>
                            </span>
                          );
                        })}
                        {paretoData.topCount > 8 && (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
                            +{paretoData.topCount - 8} รายการ
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ⑧ New vs Dropped Menus */}
                {(menuComparison.newMenus.length > 0 || menuComparison.dropped.length > 0) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {menuComparison.newMenus.length > 0 && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                        <h2 className="text-sm font-semibold text-emerald-800 mb-3">✨ เมนูใหม่ช่วงนี้</h2>
                        <p className="text-xs text-emerald-600 mb-3">ไม่เคยอยู่ใน Top 20 ของช่วงก่อนหน้า ({report.prev_start} – {report.prev_end})</p>
                        <div className="space-y-1.5">
                          {menuComparison.newMenus.map((m, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-emerald-800 font-medium truncate pr-2">{m.menu_name}</span>
                              <span className="text-emerald-600 shrink-0">{fmtBaht(m.total_revenue)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {menuComparison.dropped.length > 0 && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                        <h2 className="text-sm font-semibold text-rose-800 mb-3">📉 เมนูที่หายไป</h2>
                        <p className="text-xs text-rose-600 mb-3">เคยติด Top 20 ช่วงก่อนหน้า แต่ไม่มีในช่วงนี้</p>
                        <div className="space-y-1.5">
                          {menuComparison.dropped.map((m, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-rose-800 font-medium truncate pr-2">{m.menu_name}</span>
                              <span className="text-rose-500 shrink-0 line-through">{fmtBaht(m.total_revenue)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ⑨ Bill Distribution */}
                {billDist.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h2 className="text-sm font-semibold text-gray-800 mb-4">การกระจายยอดต่อบิล</h2>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                      {billDist.map((item) => {
                        const maxBills = Math.max(...billDist.map((x) => Number(x.bill_count || 0)), 1);
                        const pct = (Number(item.bill_count || 0) / maxBills) * 100;
                        return (
                          <div key={item.range_label} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-center">
                            <p className="text-xs font-semibold text-gray-600 mb-2">{item.range_label}</p>
                            <div className="mx-auto w-12 h-12 relative mb-1">
                              <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
                                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3b82f6" strokeWidth="3"
                                  strokeDasharray={`${pct} ${100 - pct}`} strokeLinecap="round" />
                              </svg>
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[10px] font-bold text-blue-600">{Number(item.bill_count)}</span>
                              </div>
                            </div>
                            <p className="text-[9px] text-gray-500">บิล</p>
                            <p className="text-xs font-semibold text-gray-700 mt-1">{fmtBaht(item.total_revenue)}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ⑩ Group + Branch */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {groupSeries.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white p-4">
                      <h2 className="text-sm font-semibold text-gray-800 mb-4">ยอดขายตามกลุ่มสินค้า</h2>
                      <Donut data={groupSeries} labelKey="group_name" valueKey="total_revenue" />
                    </div>
                  )}
                  {branchSeries.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white p-4">
                      <h2 className="text-sm font-semibold text-gray-800 mb-4">ยอดขายตามสาขา</h2>
                      {(() => {
                        const totalRev = branchSeries.reduce((s, b) => s + Number(b.total_revenue || 0), 0);
                        const maxRev = Math.max(...branchSeries.map((b) => Number(b.total_revenue || 0)), 1);
                        return (
                          <div className="space-y-3">
                            {branchSeries.map((item) => {
                              const rev = Number(item.total_revenue || 0);
                              const share = totalRev > 0 ? ((rev / totalRev) * 100).toFixed(1) : '0.0';
                              return (
                                <div key={item.branch_id}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-medium text-gray-700">{branchMap.get(item.branch_id) || item.branch_id || 'ไม่ระบุ'}</span>
                                    <span className="text-xs text-gray-500">{share}% · {fmt(item.bill_count)} บิล</span>
                                  </div>
                                  <div className="h-3 rounded-full bg-gray-100">
                                    <div className="h-3 rounded-full bg-teal-500" style={{ width: `${Math.max((rev / maxRev) * 100, 2)}%` }} />
                                  </div>
                                  <p className="text-[10px] text-gray-500 mt-0.5 text-right">{fmtBaht(rev)}</p>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ════════ MENU TAB ════════ */}
        {activeTab === 'menu' && (
          <div>
            {report ? (
              <div className="space-y-4">
                {/* Summary strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'ยอดขายรวม', value: `${fmt(totals.totalRevenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿` },
                    { label: 'จำนวนบิล', value: fmt(totals.billCount) },
                    { label: 'จำนวนเมนู', value: fmt(menuCount) },
                    { label: 'ยอดเฉลี่ย/บิล', value: `${fmt(avgPerBill, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿` }
                  ].map((c) => (
                    <div key={c.label} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">{c.label}</p>
                      <p className="text-lg font-semibold text-gray-900">{c.value}</p>
                    </div>
                  ))}
                </div>

                {/* Export + filter row */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex gap-2 flex-wrap">
                    {selectedGroup && (
                      <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-sm text-blue-700">
                        กลุ่ม: <span className="font-semibold">{selectedGroup}</span>
                        <button type="button" onClick={() => setSelectedGroup('')} className="text-xs underline">ล้าง</button>
                      </div>
                    )}
                    {groupedMenuItems.length === 0 && menuItems.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
                        ไม่มีกลุ่มสินค้า จึงแสดงเมนูทั้งหมด
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    disabled={filteredMenuItems.length === 0}
                    className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                  >
                    ⬇️ Export CSV ({fmt(filteredMenuItems.length)} รายการ)
                  </button>
                </div>

                {/* Group table */}
                {groupSeries.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h2 className="text-sm font-semibold text-gray-900 mb-3">ยอดขายตามกลุ่มสินค้า</h2>
                    <DataTable columns={groupColumns} data={groupSeries} rowKey="group_name"
                      renderActions={(row) => (
                        <button type="button" onClick={() => setSelectedGroup(row.group_name)} className="text-sm text-blue-600 hover:text-blue-900">ดูรายการ</button>
                      )}
                    />
                  </div>
                )}

                {/* Menu table */}
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <DataTable columns={columns} data={filteredMenuItems} rowKey="barcode"
                    renderActions={() => <span className="text-xs text-gray-300">–</span>}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
                <p className="text-4xl mb-3">🍽️</p>
                <p className="text-sm">โหลดรายงานเพื่อดูรายการเมนู</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AI Chat ── */}
      <div className="fixed bottom-4 right-4 z-40">
        {chatOpen ? (
          <div className="w-80 rounded-2xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">🤖 AI วิเคราะห์ยอดขาย</p>
                <p className="text-xs text-gray-500">ใช้ข้อมูลจากรายงานที่โหลด</p>
              </div>
              <button type="button" onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>
            <div className="px-4 py-3 text-xs">
              {!reportPayload && (
                <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">โหลดรายงานก่อนใช้งาน</div>
              )}
              <div className="mb-2 flex flex-wrap gap-1.5">
                {['เมนูขายดี 5 อันดับ', 'ยอดขายรวมเท่าไร', 'วิเคราะห์แนวโน้ม'].map((ex) => (
                  <button key={ex} type="button" onClick={() => setChatInput(ex)} disabled={!reportPayload}
                    className="rounded-full border border-gray-200 px-2.5 py-1 text-gray-600 hover:border-blue-200 hover:text-blue-700 disabled:opacity-40">
                    {ex}
                  </button>
                ))}
              </div>
              <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                {chatMessages.length === 0 ? <p className="text-gray-400">ลองถามคำถามเกี่ยวกับยอดขาย...</p> :
                  chatMessages.map((m, i) => (
                    <div key={i} className={`rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800 border border-gray-200'}`}>
                      {m.content}
                    </div>
                  ))}
                {chatLoading && <p className="text-xs text-gray-400 animate-pulse">กำลังคิด...</p>}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                  placeholder="พิมพ์คำถาม" disabled={!reportPayload}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSubmit(); } }}
                />
                <button type="button" onClick={handleChatSubmit} disabled={!reportPayload || chatLoading}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300">
                  ส่งคำถาม
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setChatOpen(true)}
            className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-blue-700">
            🤖 ถาม AI
          </button>
        )}
      </div>
    </Layout>
  );
};
