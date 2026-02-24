import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { purchaseOrderAPI } from '../../api/purchase-orders';

const STATUS_MAP = {
  draft:      { label: 'ร่าง',          color: 'bg-gray-100 text-gray-600' },
  confirmed:  { label: 'ยืนยันแล้ว',    color: 'bg-blue-100 text-blue-700' },
  partial:    { label: 'รับบางส่วน',    color: 'bg-yellow-100 text-yellow-700' },
  completed:  { label: 'รับครบแล้ว',    color: 'bg-green-100 text-green-700' },
  cancelled:  { label: 'ยกเลิก',        color: 'bg-red-100 text-red-700' }
};

const toNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const formatDate = (d) =>
  d
    ? new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
    : '-';

const formatDateTime = (d) =>
  d
    ? new Date(d).toLocaleString('th-TH', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    : '-';

export const PurchaseOrderReceive = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // qty inputs: { [po_item_id]: number }
  const [receiveQty, setReceiveQty] = useState({});
  const [activeTab, setActiveTab] = useState('receive'); // 'receive' | 'receipts'
  const [scanCode, setScanCode] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [scanError, setScanError] = useState('');

  /* ── Load PO ─────────────────────────────────────────────────────────── */
  const loadPo = async () => {
    try {
      setLoading(true);
      const result = await purchaseOrderAPI.getById(id);
      const data = result?.data || result;
      setPo(data);
      // Pre-fill remaining qty
      const initial = {};
      (data?.items || []).forEach((item) => {
        const remaining = toNumber(item.quantity_ordered, 0) - toNumber(item.quantity_received, 0);
        initial[item.id] = Math.max(0, remaining);
      });
      setReceiveQty(initial);
      setScanCode('');
      setScanMessage('');
      setScanError('');
    } catch (e) {
      console.error(e);
      alert('โหลดข้อมูล PO ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  const isEditable = po && ['draft', 'confirmed', 'partial'].includes(po.status);
  const normalizeScanToken = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');

  const handleScanReceive = () => {
    const token = normalizeScanToken(scanCode);
    if (!token) return;
    if (!isEditable) {
      setScanError('ใบนี้ไม่สามารถรับสินค้าเพิ่มได้');
      setScanMessage('');
      return;
    }

    const items = Array.isArray(po?.items) ? po.items : [];
    const matched = items.find((item) => {
      const ordered = toNumber(item.quantity_ordered, 0);
      const alreadyReceived = toNumber(item.quantity_received, 0);
      const alreadyInput = toNumber(receiveQty[item.id], 0);
      const remaining = Math.max(0, ordered - alreadyReceived);
      const room = Math.max(0, remaining - alreadyInput);
      if (room <= 0) return false;

      const candidates = [item.barcode, item.qr_code, item.product_code];
      return candidates.some((code) => normalizeScanToken(code) === token);
    });

    if (!matched) {
      setScanError('ไม่พบสินค้าที่รับเพิ่มได้จากโค้ดนี้');
      setScanMessage('');
      return;
    }

    const ordered = toNumber(matched.quantity_ordered, 0);
    const alreadyReceived = toNumber(matched.quantity_received, 0);
    const remaining = Math.max(0, ordered - alreadyReceived);

    setReceiveQty((prev) => {
      const current = toNumber(prev[matched.id], 0);
      return {
        ...prev,
        [matched.id]: Math.min(remaining, current + 1)
      };
    });
    setScanMessage(`เพิ่ม ${matched.product_name} +1`);
    setScanError('');
    setScanCode('');
  };

  const handleFillAll = () => {
    const next = {};
    (po?.items || []).forEach((item) => {
      const remaining = toNumber(item.quantity_ordered, 0) - toNumber(item.quantity_received, 0);
      next[item.id] = Math.max(0, remaining);
    });
    setReceiveQty(next);
    setScanMessage('');
    setScanError('');
  };

  const handleClearAll = () => {
    const next = {};
    (po?.items || []).forEach((item) => { next[item.id] = 0; });
    setReceiveQty(next);
    setScanMessage('');
    setScanError('');
  };

  const handleReceive = async () => {
    const items = (po?.items || [])
      .map((item) => ({
        po_item_id: item.id,
        quantity_received: toNumber(receiveQty[item.id], 0)
      }))
      .filter((i) => i.quantity_received > 0);

    if (items.length === 0) {
      alert('กรุณากรอกจำนวนที่ต้องการรับอย่างน้อย 1 รายการ');
      return;
    }

    try {
      setSaving(true);
      await purchaseOrderAPI.receive(id, items);
      alert('บันทึกการรับสินค้าเรียบร้อย สต็อกได้รับการอัปเดตแล้ว');
      await loadPo();
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('ยืนยันยกเลิกใบสั่งซื้อนี้?')) return;
    try {
      setCancelling(true);
      await purchaseOrderAPI.cancel(id);
      alert('ยกเลิกใบสั่งซื้อเรียบร้อย');
      navigate('/purchase-orders');
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.message || 'ยกเลิกไม่สำเร็จ');
    } finally {
      setCancelling(false);
    }
  };

  const handlePrint = () => window.print();

  /* ── Render ──────────────────────────────────────────────────────────── */
  if (loading) return <Loading fullScreen />;
  if (!po) return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-10 text-center text-gray-500">
        ไม่พบข้อมูล PO
        <div className="mt-4">
          <Button variant="secondary" onClick={() => navigate('/purchase-orders')}>← ย้อนกลับ</Button>
        </div>
      </div>
    </Layout>
  );

  const st = STATUS_MAP[po.status] || STATUS_MAP.draft;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4 print:px-0 print:py-0">

        {/* Header — hidden on print */}
        <div className="print:hidden flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 font-mono">{po.po_number}</h1>
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${st.color}`}>
                {st.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">ใบสั่งซื้อจากซัพพลายเออร์ภายนอก</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/purchase-orders')}>← ย้อนกลับ</Button>
            <Button variant="secondary" onClick={handlePrint}>🖨 พิมพ์</Button>
            {isEditable && (
              <Button variant="danger" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? 'กำลังยกเลิก...' : 'ยกเลิก PO'}
              </Button>
            )}
          </div>
        </div>

        {/* PO Info card */}
        <Card>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs">ซัพพลายเออร์</p>
              <p className="font-semibold text-gray-900">{po.supplier_name || '-'}</p>
              {po.supplier_phone && <p className="text-xs text-gray-400">{po.supplier_phone}</p>}
            </div>
            <div>
              <p className="text-gray-500 text-xs">วันที่สั่ง</p>
              <p className="font-semibold">{formatDate(po.po_date)}</p>
            </div>
            {po.expected_date && (
              <div>
                <p className="text-gray-500 text-xs">คาดรับวันที่</p>
                <p className="font-semibold">{formatDate(po.expected_date)}</p>
              </div>
            )}
            <div>
              <p className="text-gray-500 text-xs">สถานะ</p>
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${st.color}`}>
                {st.label}
              </span>
            </div>
          </div>
          {po.notes && (
            <div className="mt-3 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
              หมายเหตุ: {po.notes}
            </div>
          )}
        </Card>

        {/* Tabs — hidden on print */}
        {po.receipts?.length > 0 && (
          <div className="print:hidden flex gap-2">
            {[
              { key: 'receive', label: isEditable ? 'รับสินค้า' : 'รายการสินค้า' },
              { key: 'receipts', label: `ประวัติการรับ (${po.receipts.length})` }
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === key
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* ── Tab: Receive items ────────────────────────────────────────── */}
        {(activeTab === 'receive' || !po.receipts?.length) && (
          <Card>
            <div className="flex items-center justify-between mb-3 print:hidden">
              <h2 className="text-base font-semibold text-gray-800">
                รายการสินค้า ({po.items?.length || 0} รายการ)
              </h2>
              {isEditable && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleFillAll}
                    className="text-xs text-purple-600 hover:text-purple-800 font-medium border border-purple-200 rounded-lg px-3 py-1.5"
                  >
                    รับครบทุกรายการ
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-xs text-gray-500 hover:text-gray-700 font-medium border border-gray-200 rounded-lg px-3 py-1.5"
                  >
                    ล้างทั้งหมด
                  </button>
                </div>
              )}
            </div>

            {isEditable && (
              <div className="mb-3 rounded-lg border border-purple-100 bg-purple-50/50 p-3 print:hidden">
                <label className="mb-1 block text-xs font-semibold text-purple-700">
                  ยิงบาร์โค้ด/QR เพื่อเพิ่มจำนวนรับทีละ 1
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleScanReceive();
                      }
                    }}
                    placeholder="ยิงโค้ดแล้วกด Enter"
                    autoComplete="off"
                    className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  <Button variant="secondary" onClick={handleScanReceive}>
                    เพิ่ม
                  </Button>
                </div>
                {scanMessage ? (
                  <p className="mt-2 text-xs text-emerald-700">{scanMessage}</p>
                ) : null}
                {scanError ? (
                  <p className="mt-2 text-xs text-red-600">{scanError}</p>
                ) : null}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">#</th>
                    <th className="text-left px-3 py-2">สินค้า</th>
                    <th className="text-center px-3 py-2">สั่ง</th>
                    <th className="text-center px-3 py-2">รับมาแล้ว</th>
                    <th className="text-center px-3 py-2">คงเหลือ</th>
                    {isEditable && (
                      <th className="text-center px-3 py-2 print:hidden">รับครั้งนี้</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(po.items || []).map((item, idx) => {
                    const ordered = toNumber(item.quantity_ordered, 0);
                    const received = toNumber(item.quantity_received, 0);
                    const remaining = Math.max(0, ordered - received);
                    const thisQty = toNumber(receiveQty[item.id], 0);
                    const isDone = remaining === 0;

                    return (
                      <tr key={item.id} className={`hover:bg-gray-50 ${isDone ? 'opacity-60' : ''}`}>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-gray-900">{item.product_name}</p>
                          {item.product_code && (
                            <p className="text-xs text-gray-400">{item.product_code}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-700">
                          {ordered.toFixed(2)}
                          <span className="text-xs text-gray-400 ml-1">{item.unit_abbr}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={received > 0 ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                            {received.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {isDone ? (
                            <span className="text-green-600 font-semibold text-xs">✓ ครบ</span>
                          ) : (
                            <span className="text-orange-600 font-semibold">{remaining.toFixed(2)}</span>
                          )}
                        </td>
                        {isEditable && (
                          <td className="px-3 py-2.5 text-center print:hidden">
                            {isDone ? (
                              <span className="text-xs text-green-500">รับครบ</span>
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setReceiveQty((prev) => ({
                                      ...prev,
                                      [item.id]: Math.max(0, toNumber(prev[item.id], 0) - 1)
                                    }))
                                  }
                                  className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-base font-bold hover:bg-gray-200"
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  max={remaining}
                                  step="0.01"
                                  className="w-20 text-center border border-purple-300 rounded-lg px-1 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                                  value={receiveQty[item.id] ?? 0}
                                  onChange={(e) =>
                                    setReceiveQty((prev) => ({
                                      ...prev,
                                      [item.id]: toNumber(e.target.value, 0)
                                    }))
                                  }
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setReceiveQty((prev) => ({
                                      ...prev,
                                      [item.id]: Math.min(
                                        remaining,
                                        toNumber(prev[item.id], 0) + 1
                                      )
                                    }))
                                  }
                                  className="w-7 h-7 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center text-base font-bold hover:bg-purple-100"
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Receive button */}
            {isEditable && (
              <div className="mt-4 flex justify-end print:hidden">
                <Button
                  variant="primary"
                  onClick={handleReceive}
                  disabled={saving}
                  className="px-6"
                >
                  {saving ? 'กำลังบันทึก...' : '✔ บันทึกการรับสินค้า'}
                </Button>
              </div>
            )}

            {/* Completed notice */}
            {po.status === 'completed' && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 text-center">
                ✓ รับสินค้าครบแล้ว สต็อกได้รับการอัปเดตแล้ว
              </div>
            )}

            {/* Cancelled notice */}
            {po.status === 'cancelled' && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 text-center">
                ✕ ใบสั่งซื้อนี้ถูกยกเลิกแล้ว
              </div>
            )}
          </Card>
        )}

        {/* ── Tab: Receipts history ─────────────────────────────────────── */}
        {activeTab === 'receipts' && po.receipts?.length > 0 && (
          <Card>
            <h2 className="text-base font-semibold text-gray-800 mb-3">
              ประวัติการรับสินค้า ({po.receipts.length} รายการ)
            </h2>

            {/* Group receipts by received_at date */}
            <div className="space-y-3">
              {(() => {
                // Group by received_at (truncated to minute)
                const groups = {};
                (po.receipts || []).forEach((r) => {
                  const key = r.received_at ? new Date(r.received_at).toISOString().slice(0, 16) : 'unknown';
                  if (!groups[key]) groups[key] = [];
                  groups[key].push(r);
                });
                return Object.entries(groups)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .map(([key, rows]) => (
                    <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 flex items-center justify-between">
                        <span>{formatDateTime(rows[0].received_at)}</span>
                        <span className="text-gray-400">โดย: {rows[0].received_by_name || rows[0].received_by || '-'}</span>
                      </div>
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-gray-100">
                          {rows.map((r) => (
                            <tr key={r.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-medium text-gray-900">{r.product_name}</td>
                              <td className="px-3 py-2 text-right text-green-600 font-semibold">
                                +{toNumber(r.quantity_received, 0).toFixed(2)}{' '}
                                <span className="text-xs text-gray-400">{r.unit_abbr}</span>
                              </td>
                              {r.notes && (
                                <td className="px-3 py-2 text-xs text-gray-500">{r.notes}</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ));
              })()}
            </div>
          </Card>
        )}

        {/* Print footer */}
        <div className="hidden print:block mt-8 text-xs text-gray-400 text-center border-t pt-4">
          ออกโดยระบบสั่งของตลาดสด — พิมพ์เมื่อ {new Date().toLocaleDateString('th-TH')}
        </div>
      </div>

      {/* Print CSS */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .max-w-5xl, .max-w-5xl * { visibility: visible; }
          .max-w-5xl { position: absolute; left: 0; top: 0; width: 100%; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </Layout>
  );
};
