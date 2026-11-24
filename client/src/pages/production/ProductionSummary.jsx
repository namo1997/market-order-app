import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { productionPackingAPI } from '../../api/productionPacking';
import { bangkokDate } from '../../utils/salesReportDates';

// สรุปการผลิตของวัน: ต่อสินค้า สั่ง / ผลิต / ขาด / จัดแล้ว + วัตถุดิบที่ใช้ (เจ้าของขอ 24 พ.ย. 2569)
const fmt = (value) => Number(value || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const REFRESH_MS = 60_000;

const SummaryTable = ({ lines }) => (
  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-xs text-gray-500 whitespace-nowrap">
        <tr>
          <th className="px-3 py-2 text-left font-medium">สินค้า</th>
          <th className="px-2 py-2 text-right font-medium">สั่ง</th>
          <th className="px-2 py-2 text-right font-medium">ผลิต</th>
          <th className="px-2 py-2 text-right font-medium">ขาด</th>
          <th className="px-3 py-2 text-right font-medium">จัดแล้ว</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 tabular-nums">
        {lines.map((line) => {
          const packedDone = line.ordered > 0 && line.packed >= line.ordered;
          return (
            <tr key={line.product_id} className={line.short > 0 ? 'bg-red-50/40' : ''}>
              <td className="px-3 py-2">
                <div className="font-medium text-gray-900">{line.product_name}</div>
                {line.unit && <div className="text-xs text-gray-400">{line.unit}</div>}
              </td>
              <td className="px-2 py-2 text-right text-gray-700">{line.ordered > 0 ? fmt(line.ordered) : '–'}</td>
              <td className="px-2 py-2 text-right font-semibold text-gray-900">{line.produced > 0 ? fmt(line.produced) : '0'}</td>
              <td className={`px-2 py-2 text-right ${line.short > 0 ? 'font-bold text-red-600' : 'text-gray-300'}`}>
                {line.short > 0 ? fmt(line.short) : '–'}
              </td>
              <td className={`px-3 py-2 text-right ${packedDone ? 'font-semibold text-green-600' : 'text-gray-700'}`}>
                {line.packed > 0 ? fmt(line.packed) : '0'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export const ProductionSummary = () => {
  const navigate = useNavigate();
  const [date, setDate] = useState(() => bangkokDate());
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    productionPackingAPI.getSummary(date)
      .then((response) => {
        if (cancelled) return;
        setSummary(response?.data || null);
        setError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.message || 'โหลดไม่สำเร็จ');
      });
    return () => { cancelled = true; };
  }, [date, reloadKey]);

  // ผลิต/จัดของเกิดตลอดวัน: โหลดใหม่ทุกนาที และเมื่อกลับมาที่หน้านี้
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  const loaded = summary?.date === date;
  const lines = loaded ? summary.lines : [];
  const ingredients = loaded ? summary.ingredients : [];

  return (
    <Layout>
      <div className="mx-auto max-w-lg space-y-4">
        <button type="button" onClick={() => navigate('/')} className="text-sm text-gray-600">
          ← กลับ
        </button>
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">สรุปการผลิต</h1>
          <input
            type="date"
            value={date}
            max={bangkokDate()}
            onChange={(event) => event.target.value && setDate(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-base"
            aria-label="วันที่"
          />
        </div>

        {error && !loaded && <p className="py-10 text-center text-red-600">{error}</p>}
        {!error && !loaded && <p className="py-10 text-center text-gray-500">กำลังโหลด…</p>}

        {loaded && (
          <>
            <div className="flex items-center justify-between">
              {summary.short_count > 0 ? (
                <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
                  ขาด {summary.short_count} รายการ
                </span>
              ) : lines.length > 0 ? (
                <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">ผลิตครบ</span>
              ) : <span />}
              <button type="button" onClick={reload} className="text-sm text-blue-600">
                รีเฟรช
              </button>
            </div>

            {lines.length === 0 ? (
              <p className="py-10 text-center text-gray-500">ยังไม่มีใบสั่งหรือการผลิตวันนี้</p>
            ) : (
              <SummaryTable lines={lines} />
            )}

            {ingredients.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700">วัตถุดิบที่ใช้</h2>
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white text-sm">
                  {ingredients.map((row) => (
                    <li key={row.product_id} className="flex items-center justify-between px-3 py-2">
                      <span className="text-gray-800">{row.product_name}</span>
                      <span className="tabular-nums font-medium text-gray-900">
                        {fmt(row.used)} <span className="text-xs font-normal text-gray-400">{row.unit}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  );
};
