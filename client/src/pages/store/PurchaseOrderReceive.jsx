import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { purchaseOrderAPI } from '../../api/purchase-orders';
import { masterAPI } from '../../api/master';

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

const formatQty = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(n.toFixed(4)).replace(/\.?0+$/, '');
};

const getItemMultiplier = (item) => {
  const multiplier = Number(item?.purchase_to_base_multiplier);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
};

const getItemDisplayUnit = (item) =>
  item?.purchase_unit_abbr || item?.purchase_unit_name || item?.unit_abbr || '-';

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
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

  // qty inputs: { [po_item_id]: number }
  const [receiveQty, setReceiveQty] = useState({});
  const [receiveTotal, setReceiveTotal] = useState({});
  const [selectedItemIds, setSelectedItemIds] = useState(new Set());
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
      // Start empty. Staff must explicitly choose products before confirming receipt.
      const initial = {};
      const initialTotal = {};
      (data?.items || []).forEach((item) => {
        initial[item.id] = 0;
        initialTotal[item.id] = '';
      });
      setReceiveQty(initial);
      setReceiveTotal(initialTotal);
      setSelectedItemIds(new Set());
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

  useEffect(() => {
    const loadSuppliers = async () => {
      try {
        const res = await masterAPI.getSupplierMasters();
        const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        setSuppliers(
          list
            .map((s) => ({ id: Number(s?.id), name: String(s?.name || '').trim() }))
            .filter((s) => Number.isFinite(s.id) && s.name)
        );
      } catch (error) {
        console.error('Error loading suppliers:', error);
      }
    };
    loadSuppliers();
  }, []);

  useEffect(() => {
    const poSupplierId = Number(po?.supplier_master_id);
    if (Number.isFinite(poSupplierId) && poSupplierId > 0) {
      setSelectedSupplierId(String(poSupplierId));
    } else {
      setSelectedSupplierId('');
    }
  }, [po?.supplier_master_id]);

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
      const multiplier = getItemMultiplier(item);
      const orderedBase = toNumber(item.quantity_ordered, 0);
      const alreadyReceivedBase = toNumber(item.quantity_received, 0);
      const alreadyInputDisplay = toNumber(receiveQty[item.id], 0);
      const remainingBase = Math.max(0, orderedBase - alreadyReceivedBase);
      const alreadyInputBase = alreadyInputDisplay * multiplier;
      const roomBase = Math.max(0, remainingBase - alreadyInputBase);
      if (roomBase <= 0) return false;

      const candidates = [item.barcode, item.qr_code, item.product_code];
      return candidates.some((code) => normalizeScanToken(code) === token);
    });

    if (!matched) {
      setScanError('ไม่พบสินค้าที่รับเพิ่มได้จากโค้ดนี้');
      setScanMessage('');
      return;
    }

    const multiplier = getItemMultiplier(matched);
    const orderedBase = toNumber(matched.quantity_ordered, 0);
    const alreadyReceivedBase = toNumber(matched.quantity_received, 0);
    const remainingBase = Math.max(0, orderedBase - alreadyReceivedBase);
    const remainingDisplay = remainingBase / multiplier;
    const unitLabel = getItemDisplayUnit(matched);

    setReceiveQty((prev) => {
      const current = toNumber(prev[matched.id], 0);
      return {
        ...prev,
        [matched.id]: Math.min(remainingDisplay, current + 1)
      };
    });
    setSelectedItemIds((prev) => new Set([...prev, matched.id]));
    setScanMessage(`เพิ่ม ${matched.product_name} +1 ${unitLabel}`);
    setScanError('');
    setScanCode('');
  };

  const handleFillAll = () => {
    const next = {};
    const nextTotal = {};
    const nextSelected = new Set();
    (po?.items || []).forEach((item) => {
      const multiplier = getItemMultiplier(item);
      const remainingBase =
        toNumber(item.quantity_ordered, 0) - toNumber(item.quantity_received, 0);
      const remaining = Math.max(0, remainingBase);
      next[item.id] = remaining / multiplier;
      nextTotal[item.id] =
        remaining > 0 && item.unit_price != null
          ? String((toNumber(item.unit_price, 0) * remaining).toFixed(2))
          : '';
      if (remaining > 0) nextSelected.add(item.id);
    });
    setReceiveQty(next);
    setReceiveTotal(nextTotal);
    setSelectedItemIds(nextSelected);
    setScanMessage('');
    setScanError('');
  };

  const handleClearAll = () => {
    const next = {};
    const nextTotal = {};
    (po?.items || []).forEach((item) => { next[item.id] = 0; });
    (po?.items || []).forEach((item) => { nextTotal[item.id] = ''; });
    setReceiveQty(next);
    setReceiveTotal(nextTotal);
    setSelectedItemIds(new Set());
    setScanMessage('');
    setScanError('');
  };

  const toggleReceiveItem = (item) => {
    if (!selectedSupplierId) return;
    const orderedBase = toNumber(item.quantity_ordered, 0);
    const receivedBase = toNumber(item.quantity_received, 0);
    const remainingBase = Math.max(0, orderedBase - receivedBase);
    if (remainingBase <= 0) return;

    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
        setReceiveQty((qtyPrev) => ({ ...qtyPrev, [item.id]: 0 }));
        setReceiveTotal((totalPrev) => ({ ...totalPrev, [item.id]: '' }));
      } else {
        const multiplier = getItemMultiplier(item);
        next.add(item.id);
        setReceiveQty((qtyPrev) => ({
          ...qtyPrev,
          [item.id]: remainingBase / multiplier
        }));
        setReceiveTotal((totalPrev) => ({
          ...totalPrev,
          [item.id]: item.unit_price != null
            ? String((toNumber(item.unit_price, 0) * remainingBase).toFixed(2))
            : ''
        }));
      }
      return next;
    });
  };

  const handleReceive = async () => {
    const items = (po?.items || [])
      .filter((item) => selectedItemIds.has(item.id))
      .map((item) => {
        const multiplier = getItemMultiplier(item);
        const quantityReceivedDisplay = toNumber(receiveQty[item.id], 0);
        const quantityReceived = Number((quantityReceivedDisplay * multiplier).toFixed(4));
        const payload = {
          po_item_id: item.id,
          quantity_received: quantityReceived
        };
        const rawTotal = receiveTotal[item.id];
        if (rawTotal !== '' && rawTotal != null) {
          const parsedTotal = Number(rawTotal);
          if (Number.isFinite(parsedTotal) && parsedTotal >= 0 && quantityReceived > 0) {
            payload.unit_price = parsedTotal / quantityReceived;
          }
        }
        return payload;
      })
      .filter((i) => i.quantity_received > 0);

    if (items.length === 0) {
      alert('กรุณาเลือกสินค้าและกรอกจำนวนรับอย่างน้อย 1 รายการ');
      return;
    }

    const selectedSupplierNumber = Number(selectedSupplierId);
    const poSupplierNumber = Number(po?.supplier_master_id);
    const effectiveSupplierId =
      Number.isFinite(poSupplierNumber) && poSupplierNumber > 0
        ? poSupplierNumber
        : selectedSupplierNumber;
    if (!Number.isFinite(effectiveSupplierId) || effectiveSupplierId <= 0) {
      alert('กรุณาเลือกซัพพลายเออร์ก่อนบันทึกรับสินค้า');
      return;
    }

    try {
      setSaving(true);
      await purchaseOrderAPI.receive(id, items, effectiveSupplierId);
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
      navigate('/purchase-orders/history');
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
          <Button variant="secondary" onClick={() => navigate('/purchase-orders/history')}>← ย้อนกลับ</Button>
        </div>
      </div>
    </Layout>
  );

  const st = STATUS_MAP[po.status] || STATUS_MAP.draft;
  const poSupplierId = Number(po?.supplier_master_id);
  const supplierOptions =
    Number.isFinite(poSupplierId) && poSupplierId > 0
      ? [{
          id: poSupplierId,
          name: po.supplier_name || suppliers.find((s) => Number(s.id) === poSupplierId)?.name || `ซัพ #${poSupplierId}`
        }]
      : suppliers;
  const selectedSupplier = supplierOptions.find(
    (supplier) => String(supplier.id) === String(selectedSupplierId)
  );
  const selectableItems = Array.isArray(po.items) ? po.items : [];
  const selectedItems = selectableItems.filter((item) => selectedItemIds.has(item.id));
  const selectedLineCount = selectedItems.length;
  const selectedReceiveTotal = selectedItems.reduce((sum, item) => {
    const value = Number(receiveTotal[item.id]);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

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
            <Button variant="secondary" onClick={() => navigate('/purchase-orders/history')}>← ย้อนกลับ</Button>
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
          {!po?.supplier_master_id && (
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                เลือกซัพพลายเออร์ก่อนรับสินค้า <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full md:w-96 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              >
                <option value="">-- เลือกซัพพลายเออร์ --</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
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
            <div className="print:hidden space-y-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-purple-600">ขั้นตอนที่ 1</p>
                  <h2 className="text-lg font-bold text-gray-900">เลือกซัพพลายเออร์</h2>
                  <p className="text-xs text-gray-500">เลือกซัพก่อน แล้วค่อยเลือกสินค้าที่รับเข้าจริง</p>
                </div>
                {isEditable && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleFillAll}
                      disabled={!selectedSupplierId}
                      className="rounded-xl border border-purple-200 px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      เลือกรับทั้งหมด
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50"
                    >
                      ล้างทั้งหมด
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {supplierOptions.length === 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    ยังไม่มีข้อมูลซัพพลายเออร์ให้เลือก
                  </div>
                ) : (
                  supplierOptions.map((supplier) => {
                    const active = String(selectedSupplierId) === String(supplier.id);
                    return (
                      <button
                        key={supplier.id}
                        type="button"
                        onClick={() => setSelectedSupplierId(String(supplier.id))}
                        disabled={!isEditable && !active}
                        className={`shrink-0 rounded-2xl border px-4 py-3 text-left transition ${
                          active
                            ? 'border-purple-600 bg-purple-600 text-white shadow-lg shadow-purple-100'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-purple-300 hover:bg-purple-50'
                        }`}
                      >
                        <span className="block text-xs opacity-80">ซัพพลายเออร์</span>
                        <span className="block max-w-[220px] truncate text-sm font-bold">{supplier.name}</span>
                      </button>
                    );
                  })
                )}
              </div>

              {isEditable && selectedSupplierId && (
                <div className="rounded-2xl border border-purple-100 bg-purple-50/60 p-3">
                  <label className="mb-1 block text-xs font-semibold text-purple-700">
                    ยิงบาร์โค้ด/QR เพื่อเลือกสินค้าและเพิ่มจำนวนรับทีละ 1
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
                      className="w-full rounded-xl border border-purple-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                    <Button variant="secondary" onClick={handleScanReceive}>เพิ่ม</Button>
                  </div>
                  {scanMessage ? <p className="mt-2 text-xs text-emerald-700">{scanMessage}</p> : null}
                  {scanError ? <p className="mt-2 text-xs text-red-600">{scanError}</p> : null}
                </div>
              )}

              <div className="rounded-3xl border border-gray-200 bg-gray-50 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-purple-600">ขั้นตอนที่ 2</p>
                    <h3 className="font-bold text-gray-900">เลือกสินค้า</h3>
                    <p className="text-xs text-gray-500">
                      {selectedSupplier
                        ? `กำลังรับจาก ${selectedSupplier.name}`
                        : 'กรุณาเลือกซัพพลายเออร์ก่อน'}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white px-3 py-2 text-right shadow-sm">
                    <p className="text-[11px] text-gray-400">เลือกแล้ว</p>
                    <p className="text-lg font-bold text-purple-700">{selectedLineCount} รายการ</p>
                  </div>
                </div>

                {!selectedSupplierId && (
                  <div className="mb-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-3 text-center text-sm font-semibold text-amber-700">
                    แสดงรายการไว้ก่อน แต่ต้องเลือกซัพพลายเออร์ก่อนถึงจะกดเลือกสินค้าได้
                  </div>
                )}

                <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="w-12 px-2 py-2 text-center">เลือก</th>
                        <th className="px-2 py-2 text-left">สินค้า</th>
                        <th className="w-20 px-2 py-2 text-center">สั่ง</th>
                        <th className="w-20 px-2 py-2 text-center">รับแล้ว</th>
                        <th className="w-20 px-2 py-2 text-center">คงเหลือ</th>
                        <th className="w-24 px-2 py-2 text-center">รับครั้งนี้</th>
                        <th className="w-24 px-2 py-2 text-center">ราคารวม</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectableItems.map((item) => {
                        const multiplier = getItemMultiplier(item);
                        const unitLabel = getItemDisplayUnit(item);
                        const orderedBase = toNumber(item.quantity_ordered, 0);
                        const receivedBase = toNumber(item.quantity_received, 0);
                        const remainingBase = Math.max(0, orderedBase - receivedBase);
                        const ordered = orderedBase / multiplier;
                        const received = receivedBase / multiplier;
                        const remaining = remainingBase / multiplier;
                        const isDone = remainingBase === 0;
                        const isSelected = selectedItemIds.has(item.id);

                        return (
                          <tr
                            key={item.id}
                            className={`h-12 ${
                              isSelected
                                ? 'bg-purple-50'
                                : isDone
                                  ? 'bg-green-50/50 text-gray-400'
                                  : 'bg-white'
                            }`}
                          >
                            <td className="px-2 py-1 text-center">
                              <button
                                type="button"
                                onClick={() => toggleReceiveItem(item)}
                                disabled={!isEditable || isDone || !selectedSupplierId}
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold disabled:cursor-not-allowed ${
                                  isSelected
                                    ? 'border-purple-600 bg-purple-600 text-white'
                                    : isDone
                                      ? 'border-green-200 bg-green-50 text-green-600'
                                      : selectedSupplierId
                                        ? 'border-gray-300 bg-white text-gray-500 hover:border-purple-400 hover:text-purple-600'
                                        : 'border-gray-200 bg-gray-50 text-gray-300'
                                }`}
                              >
                                {isDone ? '✓' : isSelected ? '✓' : '+'}
                              </button>
                            </td>
                            <td className="px-2 py-1">
                              <div className="max-w-[280px] truncate font-semibold text-gray-900">
                                {item.product_name}
                              </div>
                              <div className="truncate text-[11px] text-gray-400">
                                {[item.product_code, item.barcode].filter(Boolean).join(' • ')}
                                {getItemMultiplier(item) !== 1
                                  ? `${item.product_code || item.barcode ? ' • ' : ''}1 ${unitLabel} = ${formatQty(getItemMultiplier(item))} ${item.unit_abbr || '-'}`
                                  : ''}
                              </div>
                            </td>
                            <td className="px-2 py-1 text-center font-semibold text-gray-700">
                              {formatQty(ordered)} <span className="text-[11px] font-normal text-gray-400">{unitLabel}</span>
                            </td>
                            <td className="px-2 py-1 text-center font-semibold text-green-700">
                              {formatQty(received)}
                            </td>
                            <td className="px-2 py-1 text-center font-semibold text-orange-700">
                              {isDone ? 'ครบ' : formatQty(remaining)}
                            </td>
                            <td className="px-2 py-1 text-center">
                              {isSelected && !isDone && selectedSupplierId ? (
                                <input
                                  type="number"
                                  min="0"
                                  max={remaining}
                                  step="0.01"
                                  value={receiveQty[item.id] ?? 0}
                                  onChange={(e) =>
                                    setReceiveQty((prev) => ({
                                      ...prev,
                                      [item.id]: toNumber(e.target.value, 0)
                                    }))
                                  }
                                  className="w-20 rounded-lg border border-purple-200 bg-white px-2 py-1 text-center text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-400"
                                />
                              ) : (
                                <span className="text-xs text-gray-300">-</span>
                              )}
                            </td>
                            <td className="px-2 py-1 text-center">
                              {isSelected && !isDone && selectedSupplierId ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={receiveTotal[item.id] ?? ''}
                                  placeholder="-"
                                  onChange={(e) =>
                                    setReceiveTotal((prev) => ({
                                      ...prev,
                                      [item.id]: e.target.value
                                    }))
                                  }
                                  className="w-20 rounded-lg border border-purple-200 bg-white px-2 py-1 text-center text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-400"
                                />
                              ) : (
                                <span className="text-xs text-gray-300">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>              </div>

              {isEditable && (
                <div className="sticky bottom-3 z-10 rounded-3xl border border-gray-200 bg-white/95 p-3 shadow-xl backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold text-purple-600">ขั้นตอนที่ 3</p>
                      <p className="text-sm font-bold text-gray-900">
                        ยืนยันรับ {selectedLineCount} รายการ
                        {selectedReceiveTotal > 0 ? ` • รวม ฿${selectedReceiveTotal.toLocaleString('th-TH', { maximumFractionDigits: 2 })}` : ''}
                      </p>
                      <p className="text-xs text-gray-500">เมื่อยืนยันแล้วระบบจะอัปเดตสต็อกทันที</p>
                    </div>
                    <Button
                      variant="primary"
                      onClick={handleReceive}
                      disabled={saving || !selectedSupplierId || selectedLineCount === 0}
                      className="w-full sm:w-auto px-6"
                    >
                      {saving ? 'กำลังบันทึก...' : 'ยืนยันการรับ'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="hidden print:block">
              <h2 className="text-base font-semibold text-gray-800 mb-3">
                รายการสินค้า ({po.items?.length || 0} รายการ)
              </h2>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">#</th>
                    <th className="text-left px-3 py-2">สินค้า</th>
                    <th className="text-center px-3 py-2">สั่ง</th>
                    <th className="text-center px-3 py-2">รับมาแล้ว</th>
                    <th className="text-center px-3 py-2">คงเหลือ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(po.items || []).map((item, idx) => {
                    const multiplier = getItemMultiplier(item);
                    const unitLabel = getItemDisplayUnit(item);
                    const orderedBase = toNumber(item.quantity_ordered, 0);
                    const receivedBase = toNumber(item.quantity_received, 0);
                    const remainingBase = Math.max(0, orderedBase - receivedBase);
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                        <td className="px-3 py-2.5 font-medium text-gray-900">{item.product_name}</td>
                        <td className="px-3 py-2.5 text-center">{formatQty(orderedBase / multiplier)} {unitLabel}</td>
                        <td className="px-3 py-2.5 text-center">{formatQty(receivedBase / multiplier)} {unitLabel}</td>
                        <td className="px-3 py-2.5 text-center">{formatQty(remainingBase / multiplier)} {unitLabel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {po.status === 'completed' && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 text-center">
                ✓ รับสินค้าครบแล้ว สต็อกได้รับการอัปเดตแล้ว
              </div>
            )}

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
                            (() => {
                              const relatedItem = (po.items || []).find(
                                (item) => Number(item.id) === Number(r.po_item_id)
                              );
                              const multiplier = getItemMultiplier(relatedItem);
                              const unitLabel = getItemDisplayUnit(relatedItem || {});
                              const displayQty = toNumber(r.quantity_received, 0) / multiplier;
                              return (
                                <tr key={r.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 font-medium text-gray-900">{r.product_name}</td>
                                  <td className="px-3 py-2 text-right text-green-600 font-semibold">
                                    +{formatQty(displayQty)}{' '}
                                    <span className="text-xs text-gray-400">{unitLabel}</span>
                                  </td>
                                  {r.notes && (
                                    <td className="px-3 py-2 text-xs text-gray-500">{r.notes}</td>
                                  )}
                                </tr>
                              );
                            })()
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
          ออกโดยระบบสั่งซื้อ SOLAO — พิมพ์เมื่อ {new Date().toLocaleDateString('th-TH')}
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
