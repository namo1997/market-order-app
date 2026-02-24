import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Input } from '../../components/common/Input';
import { inventoryAPI } from '../../api/inventory';
import { useAuth } from '../../contexts/AuthContext';
import { StockCardModal } from '../../components/inventory/StockCardModal';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // auto-refresh ทุก 5 นาที

export const MyStockBalance = () => {
  const navigate  = useNavigate();
  const { user }  = useAuth();

  const [balances, setBalances]     = useState([]);
  const [meta, setMeta]             = useState({});   // { clickhouse_available, already_synced, as_of_date }
  const [loading, setLoading]       = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [search, setSearch]         = useState('');
  const [modalProductId, setModalProductId] = useState(null); // เปิด StockCardModal
  const [showAll, setShowAll]       = useState(false);        // false = เฉพาะผูกสูตร, true = ทั้งหมด

  const departmentId   = user?.department_id;
  const departmentName = user?.department || '';
  const branchName     = user?.branch || '';

  // ─────────────────────────────────────────────────────
  // โหลดข้อมูล — ใช้ realtime-balance endpoint
  // ─────────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    if (!departmentId) return;
    try {
      setLoading(true);
      const result = await inventoryAPI.getRealtimeBalance(departmentId);
      const items  = result?.data ?? [];
      setBalances(Array.isArray(items) ? items : []);
      setMeta(result?.meta ?? {});
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error loading realtime balances:', err);
    } finally {
      setLoading(false);
    }
  }, [departmentId]);

  // โหลดครั้งแรก + auto-refresh
  useEffect(() => {
    loadBalances();
    const timer = setInterval(loadBalances, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadBalances]);

  // ─────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────

  // qty ที่ใช้แสดงผล: ถ้ามีประมาณการจาก ClickHouse → estimated_qty  มิเช่นนั้น → quantity
  const displayQty = (item) =>
    meta.clickhouse_available && !meta.already_synced
      ? parseFloat(item.estimated_qty ?? item.quantity ?? 0)
      : parseFloat(item.quantity ?? 0);

  const getQtyColor = (qty) => {
    if (qty <= 0) return 'text-red-600 font-bold';
    if (qty <= 5) return 'text-orange-500 font-semibold';
    return 'text-green-700 font-semibold';
  };

  const getQtyBg = (qty) => {
    if (qty <= 0) return 'bg-red-50 border-red-200';
    if (qty <= 5) return 'bg-orange-50 border-orange-200';
    return 'bg-white border-gray-200';
  };

  const formatQty = (n) => {
    const v = Number(n ?? 0);
    return v % 1 === 0 ? v.toFixed(0) : v.toFixed(2);
  };

  const formatTime = (date) => {
    if (!date) return '-';
    return date.toLocaleString('th-TH', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  };

  // filter: ผูกสูตร vs ทั้งหมด + search
  const recipeLinked = balances.filter((b) => Number(b.has_recipe) === 1);
  const viewPool     = showAll ? balances : recipeLinked;
  const filtered     = viewPool.filter((b) =>
    !search || b.product_name?.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [
    ...filtered.filter((b) => displayQty(b) <= 0),
    ...filtered.filter((b) => displayQty(b) > 0 && displayQty(b) <= 5),
    ...filtered.filter((b) => displayQty(b) > 5),
  ];

  // สถานะ ClickHouse สำหรับ badge/footer
  const isRealtime    = meta.clickhouse_available && !meta.already_synced;
  const isSynced      = meta.already_synced;
  const noClickHouse  = !meta.clickhouse_available;

  // ─────────────────────────────────────────────────────
  // Guard
  // ─────────────────────────────────────────────────────
  if (!departmentId) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <p className="text-gray-500 text-lg">ไม่พบข้อมูลแผนกของคุณ กรุณาเข้าสู่ระบบใหม่</p>
        </div>
      </Layout>
    );
  }

  // ─────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* ── Header ───────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-start gap-3">
            <button
              onClick={() => navigate('/')}
              className="mt-1 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title="ย้อนกลับ"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">📦 ยอดคงเหลือแผนกฉัน</h1>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className="text-sm text-gray-500">
                  {departmentName}{branchName ? ` · ${branchName}` : ''}
                </span>
                <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-medium">
                  สินค้ามูลค่าสูง
                </span>
                {/* Badge สถานะ ClickHouse */}
                {isRealtime && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5">
                    ⚡ ประมาณการ realtime
                  </span>
                )}
                {isSynced && (
                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                    ✅ ซิงค์แล้ววันนี้
                  </span>
                )}
                {noClickHouse && balances.length > 0 && (
                  <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                    ยอดระบบ
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ปุ่ม refresh */}
          <button
            onClick={loadBalances}
            disabled={loading}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-40 mt-1 shrink-0"
          >
            <span className={loading ? 'animate-spin' : ''}>🔄</span>
            {loading ? 'กำลังโหลด...' : 'รีเฟรช'}
          </button>
        </div>

        {/* ── View toggle: ผูกสูตร / ทั้งหมด ─────────────── */}
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setShowAll(false)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              !showAll
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
          >
            ผูกสูตรแล้ว
            <span className={`ml-1.5 text-xs font-normal ${!showAll ? 'text-blue-200' : 'text-gray-400'}`}>
              ({recipeLinked.length})
            </span>
          </button>
          <button
            onClick={() => setShowAll(true)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              showAll
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
          >
            ทั้งหมด
            <span className={`ml-1.5 text-xs font-normal ${showAll ? 'text-blue-200' : 'text-gray-400'}`}>
              ({balances.length})
            </span>
          </button>
        </div>

        {/* ── Stats Bar ─────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <Card className="text-center py-3">
            <div className="text-2xl font-bold text-gray-800">{filtered.length}</div>
            <div className="text-xs text-gray-500 mt-1">รายการทั้งหมด</div>
          </Card>
          <Card className="text-center py-3 bg-orange-50">
            <div className="text-2xl font-bold text-orange-600">
              {filtered.filter((b) => displayQty(b) > 0 && displayQty(b) <= 5).length}
            </div>
            <div className="text-xs text-gray-500 mt-1">เหลือน้อย (≤5)</div>
          </Card>
          <Card className="text-center py-3 bg-red-50">
            <div className="text-2xl font-bold text-red-600">
              {filtered.filter((b) => displayQty(b) <= 0).length}
            </div>
            <div className="text-xs text-gray-500 mt-1">หมดสต็อก</div>
          </Card>
        </div>

        {/* ── Search ────────────────────────────────────── */}
        <div className="mb-4">
          <Input
            type="text"
            placeholder="🔍 ค้นหาชื่อสินค้า..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* ── Last Updated ──────────────────────────────── */}
        {lastUpdated && (
          <p className="text-xs text-gray-400 mb-3 text-right">
            อัปเดตล่าสุด: {formatTime(lastUpdated)}
            {meta.as_of_date ? ` · ข้อมูลวันที่ ${meta.as_of_date}` : ''}
          </p>
        )}

        {/* ── ข้อความอธิบาย realtime ────────────────────── */}
        {isRealtime && (
          <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 flex items-start gap-1.5">
            <span className="mt-0.5">⚡</span>
            <span>
              ยอด <strong>ประมาณการ</strong> — หักยอดขายวันนี้จาก POS แล้ว แต่ยังไม่ได้ sync เข้าระบบ
              อาจคลาดเคลื่อนเล็กน้อย
            </span>
          </div>
        )}

        {/* ── Product List ──────────────────────────────── */}
        {loading && balances.length === 0 ? (
          <div className="text-center py-16 text-gray-400">กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            {search ? `ไม่พบสินค้า "${search}"` : 'ยังไม่มีสินค้าในแผนกนี้'}
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((item) => {
              const qty     = displayQty(item);
              const rawQty  = parseFloat(item.quantity ?? 0);
              const hasDeduction = item.is_estimated && item.ch_deduction > 0;

              return (
                <div
                  key={item.product_id}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg border cursor-pointer hover:shadow-sm transition-shadow ${getQtyBg(qty)}`}
                  onClick={() => setModalProductId(item.product_id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate">{item.product_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">{item.unit_name || ''}</span>
                      {/* แสดงยอดระบบเล็กๆ ถ้ามีการหัก */}
                      {hasDeduction && (
                        <span className="text-xs text-gray-400">
                          ยอดระบบ {formatQty(rawQty)} − ขายวันนี้ {formatQty(item.ch_deduction)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <div className="text-right">
                      {/* ตัวเลขหลัก */}
                      <div className="flex items-baseline gap-1">
                        {item.is_estimated && (
                          <span className="text-xs text-blue-500 font-medium">⚡</span>
                        )}
                        <span className={`text-xl ${getQtyColor(qty)}`}>
                          {formatQty(qty)}
                        </span>
                        <span className="text-xs text-gray-400">{item.unit_name || ''}</span>
                      </div>
                    </div>

                    {/* Status badge */}
                    {qty <= 0 && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">หมด</span>
                    )}
                    {qty > 0 && qty <= 5 && (
                      <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">น้อย</span>
                    )}

                    <span className="text-gray-300">›</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Footer ────────────────────────────────────── */}
        <div className="mt-6 text-center space-y-1">
          <p className="text-xs text-gray-400">
            {showAll ? 'สินค้ามูลค่าสูงทั้งหมด' : 'สินค้าที่ผูกสูตรเมนู'} · auto-refresh ทุก 5 นาที
          </p>
          {isRealtime && (
            <p className="text-xs text-blue-400">
              ⚡ ยอด realtime จาก POS (ประมาณการ ยังไม่ sync)
            </p>
          )}
          {isSynced && (
            <p className="text-xs text-green-500">
              ✅ ซิงค์ยอดขายเข้าระบบแล้ววันนี้ — ยอดแสดงเป็นข้อมูลจริง
            </p>
          )}
        </div>

      </div>

      {/* Stock Card Modal */}
      {modalProductId && (
        <StockCardModal
          productId={modalProductId}
          departmentId={departmentId}
          onClose={() => setModalProductId(null)}
        />
      )}
    </Layout>
  );
};
