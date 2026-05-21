import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
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

const formatQty = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  if (Number.isInteger(num)) return String(num);
  return String(num.toFixed(4)).replace(/\.?0+$/, '');
};

const normalizeProducts = (payload) => {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  return list
    .map((product) => ({
      id: Number(product?.id),
      name: String(product?.name || '').trim(),
      code: String(product?.code || '').trim(),
      unit_abbr: String(product?.unit_abbr || product?.unit_name || '').trim(),
      base_unit_abbr: String(product?.unit_abbr || product?.unit_name || '').trim(),
      supplier_master_id: Number(product?.supplier_master_id),
      supplier_master_name: String(product?.supplier_master_name || '').trim(),
      purchase_unit_id: Number(
        product?.supplier_purchase_unit_id ??
          product?.primary_supplier_purchase_unit_id
      ),
      purchase_unit_abbr: String(
        product?.supplier_purchase_unit_abbr ||
          product?.primary_supplier_purchase_unit_abbr ||
          product?.supplier_purchase_unit_name ||
          product?.primary_supplier_purchase_unit_name ||
          ''
      ).trim(),
      purchase_to_base_multiplier: Number(
        product?.supplier_purchase_to_base_multiplier ??
          product?.primary_supplier_purchase_to_base_multiplier
      )
    }))
    .filter((product) => Number.isFinite(product.id) && product.name)
    .map((product) => {
      const purchaseUnitId = Number(product.purchase_unit_id);
      const purchaseMultiplier = Number(product.purchase_to_base_multiplier);
      const hasPurchaseUnit =
        Number.isFinite(purchaseUnitId) &&
        purchaseUnitId > 0 &&
        Number.isFinite(purchaseMultiplier) &&
        purchaseMultiplier > 0;
      return {
        ...product,
        order_unit_abbr: hasPurchaseUnit
          ? (product.purchase_unit_abbr || product.base_unit_abbr)
          : product.base_unit_abbr,
        order_to_base_multiplier: hasPurchaseUnit ? purchaseMultiplier : 1
      };
    });
};

export const PurchaseOrderCreate = () => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentProducts, setCurrentProducts] = useState([]);

  const [poDate, setPoDate] = useState(toLocalDateString());
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [viewMode, setViewMode] = useState('grid');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth < 768) setViewMode('row');
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const productRes = await productsAPI.getProducts({
          bypassScope: true
        });
        const normalized = normalizeProducts(productRes?.data ?? productRes);
        setCurrentProducts(normalized);
      } catch (error) {
        console.error('Error loading products:', error);
        alert('ไม่สามารถโหลดข้อมูลสินค้าได้');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const getItem = (productId) =>
    items.find((item) => Number(item.product_id) === Number(productId));

  const setItemQuantity = (product, quantityValue) => {
    const quantity = toNumber(quantityValue, 0);
    const productId = Number(product.id);
    if (!Number.isFinite(productId)) return;

    if (quantity <= 0) {
      setItems((prev) => prev.filter((item) => Number(item.product_id) !== productId));
      return;
    }

    setItems((prev) => {
      const found = prev.find((item) => Number(item.product_id) === productId);
      if (found) {
        return prev.map((item) =>
          Number(item.product_id) === productId ? { ...item, quantity } : item
        );
      }

      return [
        ...prev,
        {
          product_id: productId,
          product_name: product.name,
          product_code: product.code,
          unit_abbr: product.order_unit_abbr || product.unit_abbr,
          base_unit_abbr: product.base_unit_abbr || product.unit_abbr,
          order_to_base_multiplier: Number(product.order_to_base_multiplier || 1),
          supplier_master_id: Number.isFinite(product.supplier_master_id)
            ? Number(product.supplier_master_id)
            : null,
          supplier_master_name: product.supplier_master_name || 'ยังไม่ระบุ',
          quantity
        }
      ];
    });
  };

  const updateItemField = (productId, field, value) => {
    setItems((prev) =>
      prev.map((item) =>
        Number(item.product_id) === Number(productId) ? { ...item, [field]: value } : item
      )
    );
  };

  const removeItem = (productId) => {
    setItems((prev) => prev.filter((item) => Number(item.product_id) !== Number(productId)));
  };

  const filteredProducts = useMemo(() => {
    const keyword = String(search || '').trim().toLowerCase();
    if (!keyword) return currentProducts;
    return currentProducts.filter((product) => {
      const haystack = `${product.name} ${product.code}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [currentProducts, search]);

  const isRowView = viewMode === 'row';
  const isSupplierView = viewMode === 'supplier';

  const supplierGroups = useMemo(() => {
    const groups = new Map();
    filteredProducts.slice(0, 400).forEach((product) => {
      const key = product.supplier_master_id || 'none';
      const name = product.supplier_master_name || 'ยังไม่ระบุซัพพลายเออร์';
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name,
          products: []
        });
      }
      groups.get(key).products.push(product);
    });

    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === 'none') return 1;
      if (b.key === 'none') return -1;
      return a.name.localeCompare(b.name, 'th');
    });
  }, [filteredProducts]);

  const selectedItems = useMemo(
    () => items.filter((item) => toNumber(item.quantity, 0) > 0),
    [items]
  );

  const selectedQtyTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + toNumber(item.quantity, 0), 0),
    [selectedItems]
  );

  const handleCardClick = (product) => {
    const currentQty = toNumber(getItem(product.id)?.quantity, 0);
    const nextQty = currentQty > 0 ? currentQty + 1 : 1;
    setItemQuantity(product, nextQty);
  };

  const handleSave = async () => {
    if (!poDate) {
      alert('กรุณาเลือกวันที่สั่งซื้อ');
      return;
    }

    if (selectedItems.length === 0) {
      alert('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        supplierMasterId: null,
        poDate,
        expectedDate: expectedDate || undefined,
        notes: notes || undefined,
        items: selectedItems.map((item) => ({
          product_id: Number(item.product_id),
          quantity_ordered: Number(
            (
              toNumber(item.quantity, 0) *
              toNumber(item.order_to_base_multiplier, 1)
            ).toFixed(4)
          )
        }))
      };

      const result = await purchaseOrderAPI.create(payload);
      const poNumber = result?.data?.po_number || result?.po_number || '-';
      alert(`สร้างใบสั่งซื้อสำเร็จ\n${poNumber}`);

      setItems([]);
      setSearch('');
      setIsCartOpen(false);
      navigate('/purchase-orders/history');
    } catch (error) {
      console.error('Error saving purchase orders:', error);
      alert(error?.response?.data?.message || 'บันทึกใบสั่งซื้อไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Loading fullScreen />;
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">สั่งซื้อจากซัพพลายเออร์</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              เลือกสินค้าและจำนวนก่อน แล้วค่อยเลือกซัพพลายเออร์ตอนรับสินค้า
            </p>
          </div>
          <div>
            <Button variant="secondary" onClick={() => navigate('/function-select')}>
              ← ย้อนกลับ
            </Button>
          </div>
        </div>

        <Card className="p-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => navigate('/purchase-orders')}
              className="rounded-lg px-3 py-2 text-sm font-semibold bg-purple-600 text-white"
            >
              สั่งซื้อ
            </button>
            <button
              type="button"
              onClick={() => navigate('/purchase-orders/history')}
              className="rounded-lg px-3 py-2 text-sm font-semibold border border-gray-300 text-gray-700 bg-white hover:border-purple-300"
            >
              คำสั่งซื้อของฉัน
            </button>
          </div>
        </Card>

        {/* PO metadata */}
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">วันที่สั่งซื้อ</label>
              <input
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">คาดรับสินค้า (ถ้ามี)</label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">หมายเหตุ</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="หมายเหตุรวมของใบสั่งซื้อ"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
            />
          </div>
        </Card>

        <div className="sticky top-2 z-30">
            <Card className="shadow-md">
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="block text-xs font-medium text-gray-600">ค้นหาสินค้า</label>
                <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={`px-2.5 py-1 text-xs font-semibold ${
                      viewMode === 'grid' ? 'bg-purple-600 text-white' : 'bg-white text-gray-600'
                    }`}
                  >
                    การ์ด
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('row')}
                    className={`px-2.5 py-1 text-xs font-semibold border-l border-gray-300 ${
                      isRowView ? 'bg-purple-600 text-white' : 'bg-white text-gray-600'
                    }`}
                  >
                    แถว
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('supplier')}
                    className={`px-2.5 py-1 text-xs font-semibold border-l border-gray-300 ${
                      isSupplierView ? 'bg-purple-600 text-white' : 'bg-white text-gray-600'
                    }`}
                  >
                    ตามซัพ
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ชื่อสินค้า / รหัส"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                แสดง {Math.min(filteredProducts.length, 400).toLocaleString('th-TH')} รายการ
              </p>
            </Card>
          </div>

        {/* Products area */}
        {filteredProducts.length === 0 ? (
          <Card>
            <div className="text-center py-10 text-gray-400">ไม่พบสินค้า</div>
          </Card>
        ) : (
          isSupplierView ? (
            <div className="space-y-4">
              {supplierGroups.map((group) => {
                const selectedInGroup = group.products.filter(
                  (product) => toNumber(getItem(product.id)?.quantity, 0) > 0
                ).length;
                return (
                  <Card key={group.key} className="border border-purple-100 p-3 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3 border-b border-purple-100 pb-2">
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-bold text-purple-900">{group.name}</h2>
                        <p className="text-[11px] text-gray-500">
                          {group.products.length} รายการ
                          {selectedInGroup > 0 ? ` • เลือกแล้ว ${selectedInGroup} รายการ` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-bold text-purple-700">
                        ซัพ
                      </span>
                    </div>

                    <div className="space-y-2">
                      {group.products.map((product) => {
                        const item = getItem(product.id);
                        const selected = toNumber(item?.quantity, 0) > 0;
                        return (
                          <div
                            key={product.id}
                            onClick={() => handleCardClick(product)}
                            className={`relative cursor-pointer rounded-xl border p-3 transition-all ${
                              selected
                                ? 'border-purple-300 bg-purple-50 shadow-sm'
                                : 'border-gray-200 bg-white hover:border-purple-200'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold leading-tight text-gray-900">
                                  {product.name}
                                  {product.order_unit_abbr ? (
                                    <span className="ml-1 text-xs font-medium text-gray-500">
                                      {product.order_unit_abbr}
                                    </span>
                                  ) : null}
                                </p>
                                {toNumber(product.order_to_base_multiplier, 1) !== 1 ? (
                                  <p className="mt-0.5 truncate text-[11px] text-gray-500">
                                    1 {product.order_unit_abbr || '-'} = {formatQty(product.order_to_base_multiplier)} {product.base_unit_abbr || '-'}
                                  </p>
                                ) : null}
                              </div>
                              <div className="w-28" onClick={(event) => event.stopPropagation()}>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={item?.quantity ?? ''}
                                  placeholder="จำนวน"
                                  onChange={(e) => setItemQuantity(product, e.target.value)}
                                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-purple-400"
                                />
                              </div>
                            </div>
                            {selected ? (
                              <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                                ✓
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : isRowView ? (
            <div className="space-y-2">
              {filteredProducts.slice(0, 400).map((product) => {
                const item = getItem(product.id);
                const selected = toNumber(item?.quantity, 0) > 0;
                return (
                  <Card
                    key={product.id}
                    onClick={() => handleCardClick(product)}
                    className={`relative border p-3 cursor-pointer transition-all ${
                      selected
                        ? 'border-purple-300 shadow-md'
                        : 'border-gray-200 shadow-sm hover:shadow-md hover:border-purple-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-bold leading-tight text-gray-900 whitespace-normal break-words">
                          {product.name}
                          {product.order_unit_abbr ? (
                            <span className="ml-1 text-xs font-medium text-gray-500">
                              {product.order_unit_abbr}
                            </span>
                          ) : null}
                        </p>
                        {toNumber(product.order_to_base_multiplier, 1) !== 1 ? (
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">
                            1 {product.order_unit_abbr || '-'} = {formatQty(product.order_to_base_multiplier)} {product.base_unit_abbr || '-'}
                          </p>
                        ) : null}
                        <p className="text-[11px] text-gray-500 truncate mt-0.5">{product.supplier_master_name || 'ยังไม่ระบุซัพพลายเออร์'}</p>
                      </div>
                      <div className="w-28" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item?.quantity ?? ''}
                          placeholder="จำนวน"
                          onChange={(e) => setItemQuantity(product, e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-purple-400"
                        />
                      </div>
                    </div>
                    {selected ? (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center">
                        ✓
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredProducts.slice(0, 400).map((product) => {
                const item = getItem(product.id);
                const selected = toNumber(item?.quantity, 0) > 0;

                return (
                  <Card
                    key={product.id}
                    onClick={() => handleCardClick(product)}
                    className={`relative border p-3 cursor-pointer transition-all ${
                      selected
                        ? 'border-purple-300 shadow-md'
                        : 'border-gray-200 shadow-sm hover:shadow-md hover:border-purple-200'
                    }`}
                  >
                    <div className="space-y-1">
                      <p className="text-lg font-bold leading-tight text-gray-900 line-clamp-2 break-words min-h-[3rem]">
                        {product.name}
                      </p>
                      {toNumber(product.order_to_base_multiplier, 1) !== 1 ? (
                        <p className="text-[11px] text-gray-500 truncate">
                          1 {product.order_unit_abbr || '-'} = {formatQty(product.order_to_base_multiplier)} {product.base_unit_abbr || '-'}
                        </p>
                      ) : null}
                      <p className="text-[11px] text-gray-500 truncate">{product.supplier_master_name || 'ยังไม่ระบุซัพพลายเออร์'}</p>
                      <div className="flex items-center justify-end text-[11px] text-gray-500">
                        <span>{product.order_unit_abbr || '-'}</span>
                      </div>
                    </div>

                    <div
                      className="mt-2 pt-2 border-t space-y-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item?.quantity ?? ''}
                        placeholder="จำนวน"
                        onChange={(e) => setItemQuantity(product, e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                    </div>

                    {selected ? (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center">
                        ✓
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )
        )}

        {/* Floating cart bar */}
        {selectedItems.length > 0 ? (
          <div className="fixed bottom-4 left-4 right-4 z-40 md:left-auto md:right-8 md:w-[420px]">
            <div className="rounded-2xl bg-purple-700 text-white shadow-lg px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{selectedItems.length} รายการ</p>
                <p className="text-xs text-purple-200">รวมจำนวน {formatQty(selectedQtyTotal)}</p>
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
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-white text-purple-700 hover:bg-purple-50 rounded-xl px-3 py-1.5 text-sm font-bold transition-colors disabled:bg-gray-200 disabled:text-gray-500"
                >
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        title={`รายการที่สั่ง (${selectedItems.length})`}
        size="large"
      >
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {selectedItems.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">ยังไม่มีรายการ</p>
          ) : (
            selectedItems.map((item) => (
              <div key={item.product_id} className="rounded-lg border border-gray-200 px-3 py-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm text-gray-900 truncate">{item.product_name}</p>
                    <p className="text-[11px] text-purple-700 truncate">{item.supplier_master_name}</p>
                    {toNumber(item.order_to_base_multiplier, 1) !== 1 ? (
                      <p className="text-[11px] text-gray-500 truncate">
                        เข้าสต๊อก {formatQty(toNumber(item.quantity, 0) * toNumber(item.order_to_base_multiplier, 1))}{' '}
                        {item.base_unit_abbr || '-'}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.quantity}
                      onChange={(e) => updateItemField(item.product_id, 'quantity', e.target.value)}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm text-right"
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
          <Button variant="primary" onClick={handleSave} disabled={saving || selectedItems.length === 0}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกใบสั่งซื้อ'}
          </Button>
        </div>
      </Modal>
    </Layout>
  );
};
