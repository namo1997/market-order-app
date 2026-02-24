import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { masterAPI } from '../../api/master';
import { productsAPI } from '../../api/products';
import { purchaseOrderAPI } from '../../api/purchase-orders';

const toLocalDateString = (date = new Date()) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().split('T')[0];
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const PurchaseOrderCreate = () => {
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // 1 = setup, 2 = products, 3 = summary

  // Step 1 state
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [poDate, setPoDate] = useState(toLocalDateString());
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');

  // Step 2 state
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [items, setItems] = useState([]); // [{ product_id, product_name, unit_abbr, quantity, unit_price }]
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Loading / saving
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);

  // Step 3 print ref
  const selectedSupplier = useMemo(
    () => suppliers.find((s) => String(s.id) === String(selectedSupplierId)) || null,
    [suppliers, selectedSupplierId]
  );

  /* ── Load suppliers on mount ─────────────────────────────────────────── */
  useEffect(() => {
    const fetch = async () => {
      try {
        setLoadingSuppliers(true);
        const data = await masterAPI.getSupplierMasters();
        setSuppliers(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
        alert('โหลดข้อมูลซัพพลายเออร์ไม่สำเร็จ');
      } finally {
        setLoadingSuppliers(false);
      }
    };
    fetch();
  }, []);

  /* ── Load products when supplier changes (step 2) ──────────────────── */
  useEffect(() => {
    if (step !== 2) return;
    const fetch = async () => {
      try {
        setLoadingProducts(true);
        // Load products linked to this supplier, fallback to all products
        const res = await productsAPI.getProducts({
          supplierMasterId: selectedSupplierId || undefined,
          bypassScope: true
        });
        const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        setProducts(rows);
      } catch (e) {
        console.error(e);
        // Fallback: load all products
        try {
          const res2 = await productsAPI.getProducts({ bypassScope: true });
          const rows2 = Array.isArray(res2?.data) ? res2.data : Array.isArray(res2) ? res2 : [];
          setProducts(rows2);
        } catch (e2) {
          console.error(e2);
          alert('โหลดสินค้าไม่สำเร็จ');
        }
      } finally {
        setLoadingProducts(false);
      }
    };
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedSupplierId]);

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  const filteredProducts = useMemo(() => {
    const kw = productSearch.trim().toLowerCase();
    if (!kw) return products;
    return products.filter(
      (p) =>
        String(p.name || '').toLowerCase().includes(kw) ||
        String(p.code || '').toLowerCase().includes(kw)
    );
  }, [products, productSearch]);

  const getItem = (productId) =>
    items.find((i) => Number(i.product_id) === Number(productId));

  const setItemQuantity = (product, quantityValue) => {
    const quantity = toNumber(quantityValue, 0);
    const productId = Number(product.id);
    if (!Number.isFinite(productId)) return;

    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => Number(i.product_id) !== productId));
      return;
    }
    setItems((prev) => {
      const idx = prev.findIndex((i) => Number(i.product_id) === productId);
      if (idx >= 0) {
        return prev.map((item, i) => (i === idx ? { ...item, quantity } : item));
      }
      return [
        ...prev,
        {
          product_id: productId,
          product_name: product.name,
          product_code: product.code || '',
          unit_abbr: product.unit_abbr || product.unit_name || '',
          quantity,
          unit_price: ''
        }
      ];
    });
  };

  const adjustQuantity = (product, delta) => {
    const current = toNumber(getItem(product.id)?.quantity, 0);
    setItemQuantity(product, Math.max(0, current + delta));
  };

  const updateItemField = (productId, field, value) => {
    setItems((prev) =>
      prev.map((item) =>
        Number(item.product_id) === Number(productId) ? { ...item, [field]: value } : item
      )
    );
  };

  const removeItem = (productId) => {
    setItems((prev) => prev.filter((i) => Number(i.product_id) !== Number(productId)));
  };

  /* ── Step navigation ─────────────────────────────────────────────────── */
  const goStep1 = () => setStep(1);

  const goStep2 = () => {
    if (!selectedSupplierId) {
      alert('กรุณาเลือกซัพพลายเออร์');
      return;
    }
    if (!poDate) {
      alert('กรุณาระบุวันที่สั่งซื้อ');
      return;
    }
    setStep(2);
  };

  const goStep3 = () => {
    if (items.length === 0) {
      alert('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ');
      return;
    }
    setIsCartOpen(false);
    setStep(3);
  };

  /* ── Save PO ─────────────────────────────────────────────────────────── */
  const handleSave = async () => {
    try {
      setSaving(true);
      const payload = {
        supplierMasterId: Number(selectedSupplierId),
        poDate,
        expectedDate: expectedDate || undefined,
        notes: notes || undefined,
        items: items.map((i) => ({
          product_id: i.product_id,
          quantity_ordered: toNumber(i.quantity, 0),
          unit_price: toNumber(i.unit_price, 0) || null
        }))
      };
      const result = await purchaseOrderAPI.create(payload);
      const poNumber = result?.data?.po_number || result?.po_number || '-';
      alert(`สร้างใบสั่งซื้อ ${poNumber} เรียบร้อย`);
      navigate('/purchase-orders');
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  /* ── Print ───────────────────────────────────────────────────────────── */
  const handlePrint = () => window.print();

  /* ── Render ──────────────────────────────────────────────────────────── */
  if (loadingSuppliers) return <Loading fullScreen />;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4 print:px-0 print:py-0">

        {/* Header — hidden on print */}
        <div className="print:hidden flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">สร้างใบสั่งซื้อ (PO)</h1>
            <p className="text-sm text-gray-500 mt-0.5">สั่งซื้อสินค้าจากผู้จำหน่ายภายนอก</p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/purchase-orders')}>← ย้อนกลับ</Button>
        </div>

        {/* Step indicator — hidden on print */}
        <div className="print:hidden flex items-center gap-2 text-sm">
          {[
            { n: 1, label: 'ข้อมูลซัพ & วันที่' },
            { n: 2, label: 'เลือกสินค้า' },
            { n: 3, label: 'สรุป & บันทึก' }
          ].map(({ n, label }, idx) => (
            <div key={n} className="flex items-center gap-2">
              {idx > 0 && <span className="text-gray-300">›</span>}
              <span
                className={`flex items-center gap-1.5 font-medium ${
                  step === n ? 'text-purple-700' : step > n ? 'text-green-600' : 'text-gray-400'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    step === n
                      ? 'bg-purple-600 text-white'
                      : step > n
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {step > n ? '✓' : n}
                </span>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* ═══ STEP 1: Supplier & date ════════════════════════════════════ */}
        {step === 1 && (
          <Card>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">ข้อมูลซัพพลายเออร์และวันที่</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ซัพพลายเออร์ <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                >
                  <option value="">-- เลือกซัพพลายเออร์ --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.short_name ? ` (${s.short_name})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    วันที่สั่งซื้อ <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={poDate}
                    onChange={(e) => setPoDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    วันที่คาดว่าจะได้รับ (ถ้ามี)
                  </label>
                  <input
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ (ถ้ามี)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="เช่น สั่งรอบเช้า, ต้องการพรุ่งนี้เช้า"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
                />
              </div>

              <div className="flex justify-end">
                <Button variant="primary" onClick={goStep2}>
                  ถัดไป: เลือกสินค้า →
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* ═══ STEP 2: Product selection ══════════════════════════════════ */}
        {step === 2 && (
          <>
            {/* Supplier info bar */}
            <Card>
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-gray-500">ซัพพลายเออร์: </span>
                  <span className="font-semibold text-purple-700">{selectedSupplier?.name || '-'}</span>
                  <span className="mx-3 text-gray-300">|</span>
                  <span className="text-gray-500">วันที่: </span>
                  <span className="font-medium">{poDate}</span>
                </div>
                <Button variant="secondary" size="sm" onClick={goStep1}>แก้ไข</Button>
              </div>
            </Card>

            {/* Search */}
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold text-gray-800 flex-1">เพิ่มรายการสินค้า</h2>
                {loadingProducts && (
                  <span className="text-xs text-gray-400">กำลังโหลด...</span>
                )}
              </div>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                placeholder="ค้นหาชื่อหรือรหัสสินค้า..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </Card>

            {/* Product grid */}
            {loadingProducts ? (
              <div className="text-center py-10 text-gray-400">กำลังโหลดสินค้า...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-10 text-gray-400">ไม่พบสินค้า</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.slice(0, 300).map((product) => {
                  const item = getItem(product.id);
                  return (
                    <Card
                      key={product.id}
                      onClick={() => adjustQuantity(product, 1)}
                      className="relative border border-gray-200 shadow-sm p-3 cursor-pointer hover:shadow-md hover:border-purple-300 transition-all"
                    >
                      <div className="flex flex-col h-full">
                        <div className="flex-1">
                          <h3 className="font-bold text-sm text-gray-900 line-clamp-2 mb-1">
                            {product.name}
                          </h3>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500 truncate">{product.code || '-'}</span>
                            <span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded">
                              {product.unit_abbr || product.unit_name || '-'}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
                          {/* Qty control */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => adjustQuantity(product, -1)}
                              className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-lg font-bold hover:bg-gray-200 transition-colors flex-shrink-0"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="w-full text-center border border-gray-300 rounded-lg px-1 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400"
                              placeholder="จำนวน"
                              value={item?.quantity ?? 0}
                              onChange={(e) => setItemQuantity(product, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              type="button"
                              onClick={() => adjustQuantity(product, 1)}
                              className="w-8 h-8 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center text-lg font-bold hover:bg-purple-100 transition-colors flex-shrink-0"
                            >
                              +
                            </button>
                          </div>
                          {/* Unit price */}
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="mt-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-300"
                            placeholder="ราคา/หน่วย (ถ้ามี)"
                            value={item?.unit_price ?? ''}
                            onChange={(e) => {
                              // Ensure item exists first
                              if (!item && Number(e.target.value) > 0) {
                                // item not in list yet — add it with qty 0 first then update price
                                setItems((prev) => [
                                  ...prev,
                                  {
                                    product_id: Number(product.id),
                                    product_name: product.name,
                                    product_code: product.code || '',
                                    unit_abbr: product.unit_abbr || product.unit_name || '',
                                    quantity: 0,
                                    unit_price: e.target.value
                                  }
                                ]);
                              } else {
                                updateItemField(product.id, 'unit_price', e.target.value);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>

                      {/* Selected indicator */}
                      {item && item.quantity > 0 && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                          ✓
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Fixed bottom bar when items selected */}
            {items.filter((i) => i.quantity > 0).length > 0 && (
              <div className="fixed bottom-4 left-4 right-4 z-40 md:left-auto md:right-8 md:w-96">
                <div className="rounded-2xl bg-purple-700 text-white shadow-lg px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {items.filter((i) => i.quantity > 0).length} รายการที่เลือก
                    </p>
                    <p className="text-xs text-purple-200">กดเพื่อดูรายการที่เลือก</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsCartOpen(true)}
                      className="bg-purple-500 hover:bg-purple-400 rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors"
                    >
                      ดูรายการ
                    </button>
                    <button
                      type="button"
                      onClick={goStep3}
                      className="bg-white text-purple-700 hover:bg-purple-50 rounded-xl px-3 py-1.5 text-sm font-bold transition-colors"
                    >
                      สรุป →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ STEP 3: Summary ════════════════════════════════════════════ */}
        {step === 3 && (
          <>
            {/* Print header */}
            <div className="hidden print:block mb-4">
              <h1 className="text-2xl font-bold text-center">ใบสั่งซื้อสินค้า</h1>
            </div>

            <Card>
              <div className="flex items-start justify-between mb-4 print:mb-2">
                <div>
                  <p className="text-sm text-gray-500">ซัพพลายเออร์</p>
                  <p className="font-bold text-lg text-purple-700">{selectedSupplier?.name || '-'}</p>
                  {selectedSupplier?.phone && (
                    <p className="text-sm text-gray-600">โทร: {selectedSupplier.phone}</p>
                  )}
                </div>
                <div className="text-right text-sm">
                  <p className="text-gray-500">วันที่สั่ง</p>
                  <p className="font-semibold">{poDate}</p>
                  {expectedDate && (
                    <>
                      <p className="text-gray-500 mt-1">คาดรับวันที่</p>
                      <p className="font-semibold">{expectedDate}</p>
                    </>
                  )}
                </div>
              </div>
              {notes && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 mb-4">
                  หมายเหตุ: {notes}
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2">#</th>
                      <th className="text-left px-3 py-2">สินค้า</th>
                      <th className="text-center px-3 py-2">จำนวน</th>
                      <th className="text-center px-3 py-2">หน่วย</th>
                      <th className="text-right px-3 py-2">ราคา/หน่วย</th>
                      <th className="text-right px-3 py-2">รวม</th>
                      <th className="text-center px-3 py-2 print:hidden">ลบ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items
                      .filter((i) => i.quantity > 0)
                      .map((item, idx) => {
                        const unitPrice = toNumber(item.unit_price, 0);
                        const total = unitPrice > 0 ? unitPrice * toNumber(item.quantity, 0) : null;
                        return (
                          <tr key={item.product_id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                            <td className="px-3 py-2">
                              <p className="font-medium">{item.product_name}</p>
                              {item.product_code && (
                                <p className="text-xs text-gray-400">{item.product_code}</p>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="w-20 text-center border border-gray-300 rounded px-2 py-1 text-sm print:border-none print:w-auto"
                                value={item.quantity}
                                onChange={(e) =>
                                  updateItemField(item.product_id, 'quantity', toNumber(e.target.value, 0))
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-center text-gray-600">{item.unit_abbr || '-'}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="w-24 text-right border border-gray-300 rounded px-2 py-1 text-sm print:border-none print:w-auto"
                                placeholder="-"
                                value={item.unit_price ?? ''}
                                onChange={(e) =>
                                  updateItemField(item.product_id, 'unit_price', e.target.value)
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700">
                              {total !== null ? total.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-'}
                            </td>
                            <td className="px-3 py-2 text-center print:hidden">
                              <button
                                type="button"
                                onClick={() => removeItem(item.product_id)}
                                className="text-red-500 hover:text-red-700 text-xs font-medium"
                              >
                                ลบ
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold">
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-right text-gray-700">รวมทั้งหมด</td>
                      <td className="px-3 py-2 text-center">
                        {items.filter((i) => i.quantity > 0).reduce((s, i) => s + toNumber(i.quantity, 0), 0).toFixed(2)}
                      </td>
                      <td />
                      <td />
                      <td className="px-3 py-2 text-right">
                        {(() => {
                          const grandTotal = items
                            .filter((i) => i.quantity > 0)
                            .reduce((s, i) => {
                              const up = toNumber(i.unit_price, 0);
                              return up > 0 ? s + up * toNumber(i.quantity, 0) : s;
                            }, 0);
                          return grandTotal > 0
                            ? grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })
                            : '-';
                        })()}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Action buttons */}
              <div className="mt-4 flex flex-wrap gap-2 justify-between print:hidden">
                <Button variant="secondary" onClick={() => setStep(2)}>← แก้ไขรายการ</Button>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={handlePrint}>🖨 พิมพ์ใบสั่งซื้อ</Button>
                  <Button variant="primary" onClick={handleSave} disabled={saving}>
                    {saving ? 'กำลังบันทึก...' : '✔ บันทึก PO'}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Print footer */}
            <div className="hidden print:block mt-8 text-xs text-gray-500 text-center">
              ออกโดยระบบสั่งของตลาดสด — {new Date().toLocaleDateString('th-TH')}
            </div>
          </>
        )}
      </div>

      {/* ── Cart modal (step 2) ─────────────────────────────────────────── */}
      <Modal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        title={`รายการที่เลือก (${items.filter((i) => i.quantity > 0).length})`}
        size="large"
      >
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {items.filter((i) => i.quantity > 0).length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">ยังไม่มีรายการ</p>
          ) : (
            items
              .filter((i) => i.quantity > 0)
              .map((item) => (
                <div key={item.product_id} className="border border-gray-200 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 font-medium text-gray-900 truncate text-sm">
                      {item.product_name}
                    </p>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                        value={item.quantity}
                        onChange={(e) =>
                          updateItemField(item.product_id, 'quantity', toNumber(e.target.value, 0))
                        }
                      />
                      <span className="text-sm text-gray-600">{item.unit_abbr || '-'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(item.product_id)}
                      className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 border border-red-200 rounded"
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setIsCartOpen(false)}>ปิด</Button>
          <Button variant="primary" onClick={goStep3}>
            ถัดไป: สรุป →
          </Button>
        </div>
      </Modal>

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
