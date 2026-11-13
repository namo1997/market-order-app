import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { productionPackingAPI } from '../../api/productionPacking';
import { bangkokDate } from '../../utils/salesReportDates';
import { CameraScanner } from '../../components/scan/CameraScanner';
import { ScanToast } from '../../components/scan/ScanResult';
import { playScanFeedback, unlockScanAudio } from '../../components/scan/scanFeedback';
import { useWedgeScanner } from '../../components/scan/useWedgeScanner';

// จัดของส่งสาขา: เลือกวัน → เลือกสาขา → สแกนสติกเกอร์เทียบใบส่งสินค้า
// รุ่นแรกตรวจหยิบถูก/ครบและเก็บว่าดวงไหนไปสาขาไหน ยังไม่เปลี่ยนการตัดสต็อก

const fmt = (value) => {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(3)));
};
const formatCode = (code) => String(code || '').replace(/(\d{4})(?=\d)/g, '$1 ');

const ProgressBar = ({ value, total, className = '' }) => {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className={`h-2.5 w-full overflow-hidden rounded-full bg-slate-200 ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-300 ${percent >= 100 ? 'bg-emerald-500' : 'bg-blue-600'}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
};

const BranchList = ({ branches, onOpen }) => {
  if (branches.length === 0) {
    return <p className="rounded-xl bg-white p-6 text-center text-gray-500">ไม่มีใบสั่งวันนี้</p>;
  }
  return (
    <div className="space-y-3">
      {branches.map((branch) => {
        const done = branch.line_count > 0 && branch.complete_lines >= branch.line_count;
        return (
          <button
            key={branch.branch_id}
            type="button"
            onClick={() => onOpen(branch.branch_id)}
            className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm active:scale-[0.99]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-lg font-bold text-gray-900">{branch.branch_name}</span>
              {branch.packed_at ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">จัดเสร็จ</span>
              ) : (
                <span className={`text-base font-bold tabular-nums ${done ? 'text-emerald-700' : 'text-gray-700'}`}>
                  {branch.complete_lines}/{branch.line_count}
                </span>
              )}
            </div>
            <ProgressBar value={branch.complete_lines} total={branch.line_count} className="mt-3" />
          </button>
        );
      })}
    </div>
  );
};

const LineRow = ({ line, highlighted, onAdjust, rowRef }) => {
  const done = line.ordered > 0 && line.packed >= line.ordered;
  const over = line.packed > line.ordered;
  return (
    <li
      ref={rowRef}
      className={`flex items-center gap-3 px-3 py-3 ${done ? 'bg-emerald-50' : ''} ${highlighted ? 'scan-row-new' : ''}`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          done ? 'bg-emerald-600 text-white' : 'border-2 border-slate-300 text-transparent'
        }`}
        aria-hidden="true"
      >
        ✓
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-base font-semibold leading-snug ${done ? 'text-emerald-900' : 'text-gray-900'}`}>
          {line.product_name}
        </p>
        <p className={`text-sm tabular-nums ${over ? 'font-bold text-amber-700' : 'text-gray-600'}`}>
          {fmt(line.packed)} / {fmt(line.ordered)} {line.unit}
          {line.pack_size > 0 && (
            <span className="ml-1 text-gray-500">
              · {fmt(Math.floor(line.packed / line.pack_size + 1e-9))}/{fmt(Math.ceil(line.ordered / line.pack_size - 1e-9))} {line.pack_unit_label || 'ถุง'}
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onAdjust(line, -1)}
          disabled={line.packed <= 0}
          className="h-11 w-11 touch-manipulation select-none rounded-full bg-slate-100 text-xl font-bold text-gray-700 transition-transform active:scale-90 active:bg-slate-200 disabled:opacity-30"
          aria-label={`ลด ${line.product_name}`}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => onAdjust(line, 1)}
          className="h-11 w-11 touch-manipulation select-none rounded-full bg-blue-50 text-xl font-bold text-blue-700 transition-transform active:scale-90 active:bg-blue-100"
          aria-label={`เพิ่ม ${line.product_name}`}
        >
          +
        </button>
      </div>
    </li>
  );
};

export const ProductionPacking = () => {
  const navigate = useNavigate();
  const [date, setDate] = useState(() => bangkokDate());
  // { date, branches } — กำลังโหลดเมื่อ date ยังไม่ตรงกับที่โหลดมา
  const [overview, setOverview] = useState(null);
  const [branchId, setBranchId] = useState(null);
  const [branch, setBranch] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [lastProductId, setLastProductId] = useState(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [showEntries, setShowEntries] = useState(false);
  const scanInputRef = useRef(null);
  const resultSeqRef = useRef(0);
  const pendingRef = useRef(new Set());
  const rowRefs = useRef(new Map());
  // กด +/− รัว ๆ: เปลี่ยนตัวเลขทันที รวมยอดต่อสินค้าแล้วส่งทีเดียวหลังหยุดแตะ
  const pendingDeltaRef = useRef(new Map());
  const flushTimersRef = useRef(new Map());
  const inFlightRef = useRef(new Set());
  const refreshTimerRef = useRef(null);
  const localEntrySeqRef = useRef(0);
  const ctxRef = useRef({ date, branchId: null });
  const [scrollTarget, setScrollTarget] = useState(null);

  const loadBranch = useCallback(async (targetDate, targetBranchId) => {
    const response = await productionPackingAPI.getBranch(targetDate, targetBranchId);
    setBranch(response?.data || null);
    return response?.data || null;
  }, []);

  const showResult = (tone, title, detail = '') => {
    resultSeqRef.current += 1;
    setScanResult({ id: resultSeqRef.current, tone, title, detail });
    playScanFeedback(tone);
  };

  useEffect(() => {
    ctxRef.current = { date, branchId };
  });

  const bumpLine = (productId, delta) => setBranch((prev) => (prev ? {
    ...prev,
    lines: prev.lines.map((row) => (row.product_id === productId
      ? { ...row, packed: Math.round((Number(row.packed || 0) + delta) * 1000) / 1000 }
      : row))
  } : prev));

  const setLinePacked = (productId, packed) => setBranch((prev) => (prev ? {
    ...prev,
    lines: prev.lines.map((row) => (row.product_id === productId ? { ...row, packed } : row))
  } : prev));

  const hasPendingWork = () => pendingDeltaRef.current.size > 0 || inFlightRef.current.size > 0;

  // โหลดรายการที่จัด (ประวัติ) ตามหลังเมื่อหยุดใช้งานสักครู่ ไม่โหลดทั้งหน้าทุกครั้งที่กด
  const scheduleRefresh = () => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(async () => {
      if (hasPendingWork()) {
        scheduleRefresh();
        return;
      }
      const { date: d, branchId: b } = ctxRef.current;
      if (!b) return;
      try {
        const response = await productionPackingAPI.getBranch(d, b);
        if (!hasPendingWork() && ctxRef.current.branchId === b && ctxRef.current.date === d) {
          setBranch(response?.data || null);
        }
      } catch {
        // ลองใหม่รอบหน้า
      }
    }, 1500);
  };

  const flushProduct = (productId) => {
    clearTimeout(flushTimersRef.current.get(productId));
    flushTimersRef.current.delete(productId);
    const delta = pendingDeltaRef.current.get(productId) || 0;
    pendingDeltaRef.current.delete(productId);
    if (!delta) return Promise.resolve();
    const { date: d, branchId: b } = ctxRef.current;
    const task = (async () => {
      try {
        const response = await productionPackingAPI.adjust(d, b, productId, delta);
        const result = response?.data;
        if (result?.status !== 'ok') {
          showResult('error', 'แก้จำนวนไม่ได้', result?.line?.product_name || '');
          const reload = await productionPackingAPI.getBranch(d, b);
          if (ctxRef.current.branchId === b) setBranch(reload?.data || null);
        } else if (!pendingDeltaRef.current.has(productId) && inFlightRef.current.size === 1) {
          setLinePacked(productId, result.line.packed);
        }
      } catch (error) {
        showResult('error', error?.response?.data?.message || 'บันทึกไม่สำเร็จ', 'ลองกดใหม่');
        try {
          const reload = await productionPackingAPI.getBranch(d, b);
          if (ctxRef.current.branchId === b) setBranch(reload?.data || null);
        } catch {
          // ignore
        }
      }
    })();
    inFlightRef.current.add(task);
    task.finally(() => {
      inFlightRef.current.delete(task);
      scheduleRefresh();
    });
    return task;
  };

  const flushAll = async () => {
    const productIds = [...pendingDeltaRef.current.keys()];
    await Promise.allSettled([...productIds.map((id) => flushProduct(id)), ...inFlightRef.current]);
  };

  // ออกจากหน้า: ส่งที่ค้างให้หมด
  useEffect(() => () => {
    clearTimeout(refreshTimerRef.current);
    for (const id of [...pendingDeltaRef.current.keys()]) flushProduct(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [overviewReload, setOverviewReload] = useState(0);
  useEffect(() => {
    if (branchId) return undefined;
    let cancelled = false;
    productionPackingAPI.getOverview(date)
      .then((response) => {
        if (!cancelled) setOverview({ date, branches: Array.isArray(response?.data) ? response.data : [] });
      })
      .catch((error) => {
        if (cancelled) return;
        setOverview({ date, branches: [] });
        alert(error?.response?.data?.message || 'โหลดใบสั่งไม่สำเร็จ');
      });
    return () => {
      cancelled = true;
    };
  }, [date, branchId, overviewReload]);

  useEffect(() => {
    if (!branchId) return undefined;
    let cancelled = false;
    productionPackingAPI.getBranch(date, branchId)
      .then((response) => {
        if (!cancelled) setBranch(response?.data || null);
      })
      .catch((error) => {
        if (cancelled) return;
        alert(error?.response?.data?.message || 'โหลดใบสั่งสาขาไม่สำเร็จ');
        setBranchId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [date, branchId]);

  const backToBranches = async () => {
    await flushAll();
    clearTimeout(refreshTimerRef.current);
    setBranchId(null);
    setBranch(null);
    setScanResult(null);
    setOverviewReload((value) => value + 1);
  };

  const handleScan = async (rawCode) => {
    const code = String(rawCode || '').replace(/\D/g, '');
    if (!code || !branchId) return;
    if (pendingRef.current.has(code)) return;
    pendingRef.current.add(code);
    try {
      const response = await productionPackingAPI.scan(date, branchId, code);
      const result = response?.data || {};
      const name = result.line?.product_name || result.sticker?.product_name || '';
      const unit = result.line?.unit || result.sticker?.unit_abbr || '';
      switch (result.status) {
        case 'ok': {
          const complete = result.line.packed >= result.line.ordered;
          showResult(
            'ok',
            name,
            `${fmt(result.line.packed)} / ${fmt(result.line.ordered)} ${unit}${complete ? ' · ครบ' : ''}`
          );
          bumpLine(result.line.product_id, Number(result.quantity) || 0);
          localEntrySeqRef.current += 1;
          setBranch((prev) => (prev ? {
            ...prev,
            entries: [{
              id: `local-${localEntrySeqRef.current}`,
              product_id: result.line.product_id,
              product_name: result.line.product_name,
              unit: result.line.unit,
              quantity: Number(result.quantity) || 0,
              source: 'scan',
              sticker_code: result.sticker?.code || code,
              created_at: new Date().toISOString()
            }, ...(prev.entries || [])]
          } : prev));
          setLastProductId(result.line.product_id);
          setScrollTarget({ productId: result.line.product_id, seq: resultSeqRef.current });
          break;
        }
        case 'over':
          showResult('warn', 'เกินที่สั่ง', `${name} สั่ง ${fmt(result.line?.ordered)} ${unit}`);
          setLastProductId(result.line?.product_id ?? null);
          if (result.line?.product_id) setScrollTarget({ productId: result.line.product_id, seq: resultSeqRef.current });
          break;
        case 'duplicate':
          showResult('warn', 'สแกนดวงนี้แล้ว', result.packed_to ? `อยู่ใน${result.packed_to}` : name);
          break;
        case 'not_in_order':
          showResult('error', 'ไม่มีในใบสั่ง', name);
          break;
        case 'not_found':
          showResult('error', 'ไม่พบสติกเกอร์', formatCode(code));
          break;
        default:
          showResult('error', 'ไม่ใช่สติกเกอร์แปรรูป', formatCode(code));
      }
      scheduleRefresh();
    } catch (error) {
      showResult('error', error?.response?.data?.message || 'สแกนไม่สำเร็จ', formatCode(code));
    } finally {
      pendingRef.current.delete(code);
    }
  };

  const handleScanRef = useRef(handleScan);
  useEffect(() => {
    handleScanRef.current = handleScan;
  });

  useWedgeScanner({
    enabled: Boolean(branchId) && !isCameraOpen,
    onCode: (code) => handleScanRef.current(code),
    ownInputRef: scanInputRef
  });

  // เลื่อนไปบรรทัดที่เพิ่งสแกน ให้เห็นว่าบวกตรงไหน
  // (เลื่อนเฉพาะตอนสแกน ไม่เลื่อนตอนกด +/− เพราะนิ้วอยู่ที่บรรทัดนั้นแล้ว)
  useEffect(() => {
    if (!scrollTarget) return;
    rowRefs.current.get(scrollTarget.productId)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [scrollTarget]);

  const handleAdjust = (line, delta) => {
    if (Number(line.packed || 0) + delta < 0) return;
    bumpLine(line.product_id, delta);
    setLastProductId(line.product_id);
    const productId = line.product_id;
    pendingDeltaRef.current.set(productId, (pendingDeltaRef.current.get(productId) || 0) + delta);
    clearTimeout(flushTimersRef.current.get(productId));
    flushTimersRef.current.set(productId, setTimeout(() => flushProduct(productId), 350));
  };

  const handleRemoveEntry = async (entry) => {
    if (String(entry.id).startsWith('local-')) return;
    try {
      setBusy(true);
      await flushAll();
      await productionPackingAPI.removeEntry(date, branchId, entry.id);
      await loadBranch(date, branchId);
    } catch (error) {
      alert(error?.response?.data?.message || 'ลบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleSetPacked = async (packed) => {
    if (packed) {
      const missing = (branch?.lines || []).filter((line) => line.ordered > 0 && line.packed < line.ordered).length;
      if (missing > 0 && !window.confirm(`ยังขาด ${missing} รายการ จัดเสร็จเลยไหม?`)) return;
    }
    try {
      setBusy(true);
      await flushAll();
      await productionPackingAPI.setPacked(date, branchId, packed);
      if (packed) {
        await backToBranches();
      } else {
        await loadBranch(date, branchId);
      }
    } catch (error) {
      alert(error?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleScanSubmit = async (event) => {
    event.preventDefault();
    const code = scanCode;
    setScanCode('');
    await handleScan(code);
  };

  // เรียงคงที่ตามใบส่งสินค้า (เรียงตามชื่อจาก server) ไม่ย้ายบรรทัดที่ครบ ให้เห็นว่าบวกตรงไหน
  const sortedLines = branch?.lines || [];

  const scanEvents = useMemo(() => (branch?.entries || [])
    .filter((entry) => entry.source === 'scan')
    .map((entry) => ({
      code: entry.sticker_code,
      product_id: entry.product_id,
      name: entry.product_name,
      unit: entry.unit,
      quantity: entry.quantity,
      at: new Date(entry.created_at).getTime() || entry.id
    })), [branch]);

  if (!branchId) {
    return (
      <Layout>
        <div className="mx-auto max-w-lg space-y-4">
          <button type="button" onClick={() => navigate('/')} className="text-sm text-gray-600">
            ← กลับ
          </button>
          <div className="flex items-end justify-between gap-3">
            <h1 className="text-2xl font-bold text-gray-900">จัดของส่งสาขา</h1>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-base"
              aria-label="วันที่ใบสั่ง"
            />
          </div>
          {overview?.date !== date ? (
            <p className="py-10 text-center text-gray-500">กำลังโหลด…</p>
          ) : (
            <BranchList
              branches={overview.branches}
              onOpen={(id) => {
                unlockScanAudio();
                setBranchId(id);
              }}
            />
          )}
        </div>
      </Layout>
    );
  }

  const countedLines = (branch?.lines || []).filter((line) => line.ordered > 0);
  const lineCount = countedLines.length;
  const completeLines = countedLines.filter((line) => line.packed >= line.ordered).length;
  const entries = branch?.entries || [];

  return (
    <Layout>
      <div className="mx-auto max-w-lg pb-28">
        <div className="sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={backToBranches}
              className="text-base font-semibold text-blue-700"
            >
              ← สาขา
            </button>
            <span className="text-sm text-gray-500">{date}</span>
          </div>
          <div className="mt-1 flex items-end justify-between gap-3">
            <h1 className="truncate text-xl font-bold text-gray-900">{branch?.branch_name || '…'}</h1>
            <span className={`text-lg font-bold tabular-nums ${lineCount > 0 && completeLines >= lineCount ? 'text-emerald-700' : 'text-gray-800'}`}>
              {completeLines}/{lineCount}
            </span>
          </div>
          <ProgressBar value={completeLines} total={lineCount} className="mt-2" />
          <form className="mt-3 flex gap-2" onSubmit={handleScanSubmit}>
            <input
              ref={scanInputRef}
              className="min-w-0 flex-1 rounded-lg border-2 border-blue-400 px-3 py-3 text-lg tracking-wider focus:border-blue-600 focus:outline-none"
              placeholder="สแกนสติกเกอร์"
              inputMode="numeric"
              autoComplete="off"
              value={scanCode}
              onChange={(event) => setScanCode(event.target.value)}
              onFocus={unlockScanAudio}
              aria-label="สแกนสติกเกอร์"
            />
            <button
              type="button"
              onClick={() => {
                unlockScanAudio();
                setIsCameraOpen(true);
              }}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 font-semibold text-white"
              aria-label="สแกนด้วยกล้อง"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" strokeLinecap="round" />
                <path d="M7 12h10" strokeLinecap="round" />
              </svg>
              กล้อง
            </button>
          </form>
        </div>

        {branch?.packed_at && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3">
            <span className="font-semibold text-emerald-800">จัดเสร็จแล้ว</span>
            <button type="button" onClick={() => handleSetPacked(false)} disabled={busy} className="text-sm font-semibold text-emerald-700 underline">
              แก้ไข
            </button>
          </div>
        )}

        <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {sortedLines.map((line) => (
            <LineRow
              key={line.product_id}
              line={line}
              highlighted={line.product_id === lastProductId}
              onAdjust={handleAdjust}
              rowRef={(node) => {
                if (node) rowRefs.current.set(line.product_id, node);
                else rowRefs.current.delete(line.product_id);
              }}
            />
          ))}
        </ul>

        {entries.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowEntries((value) => !value)}
              className="text-sm font-semibold text-gray-600"
            >
              {showEntries ? '▾' : '▸'} ที่จัดไปแล้ว {entries.length} ครั้ง
            </button>
            {showEntries && (
              <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{entry.product_name}</p>
                      <p className="text-xs text-gray-500 tabular-nums">
                        {entry.quantity > 0 ? '+' : ''}{fmt(entry.quantity)} {entry.unit}
                        {entry.sticker_code ? ` · ${formatCode(entry.sticker_code)}` : ' · กดเอง'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveEntry(entry)}
                      disabled={busy}
                      className="h-9 rounded-lg px-3 text-sm font-semibold text-red-700 disabled:opacity-30"
                    >
                      ลบ
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!branch?.packed_at && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <button
              type="button"
              onClick={() => handleSetPacked(true)}
              disabled={busy || !branch}
              className={`mx-auto block w-full max-w-lg rounded-xl py-3.5 text-lg font-bold text-white ${
                lineCount > 0 && completeLines >= lineCount ? 'bg-emerald-600' : 'bg-slate-700'
              } disabled:opacity-50`}
            >
              จัดเสร็จ
            </button>
          </div>
        )}
      </div>

      {!isCameraOpen && <ScanToast result={scanResult} />}
      {isCameraOpen && (
        <CameraScanner
          onClose={() => {
            setIsCameraOpen(false);
            setScanResult(null);
          }}
          onDetected={(code) => handleScanRef.current(code)}
          result={scanResult}
          events={scanEvents}
        />
      )}
    </Layout>
  );
};
