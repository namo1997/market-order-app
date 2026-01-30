import { useEffect, useState } from 'react';
import { adminAPI } from '../../api/admin';
import { ordersAPI } from '../../api/orders';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';

const toLocalDateString = (date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().split('T')[0];
};

const getTomorrowString = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return toLocalDateString(tomorrow);
};

const groupPurchaseItems = (items) => {
  const suppliersMap = new Map();

  items.forEach((item) => {
    const supplierId = item.supplier_id || 'none';
    const supplierName = item.supplier_name || 'ไม่ระบุซัพพลายเออร์';

    if (!suppliersMap.has(supplierId)) {
      suppliersMap.set(supplierId, {
        id: supplierId,
        name: supplierName,
        products: []
      });
    }

    const supplier = suppliersMap.get(supplierId);
    const existing = supplier.products.find(
      (product) => product.product_id === item.product_id
    );

    if (!existing) {
      const unitPrice =
        item.actual_price ??
        item.yesterday_actual_price ??
        item.last_actual_price ??
        item.last_requested_price ??
        item.requested_price ??
        null;

      supplier.products.push({
        product_id: item.product_id,
        product_name: item.product_name,
        unit_abbr: item.unit_abbr,
        total_quantity: 0,
        actual_quantity: 0,
        actual_price: null,
        unit_price: unitPrice,
        purchase_reason: item.purchase_reason || null,
        latest_price:
          item.last_actual_price ??
          item.last_requested_price ??
          item.requested_price ??
          item.yesterday_actual_price ??
          item.actual_price ??
          null,
        is_purchased: true,
        hasActualQuantity: false
      });
    }

    const product = supplier.products.find(
      (entry) => entry.product_id === item.product_id
    );
    product.total_quantity += Number(item.quantity || 0);

    if (item.actual_quantity !== null && item.actual_quantity !== undefined) {
      product.actual_quantity += Number(item.actual_quantity || 0);
      product.hasActualQuantity = true;
    }

    if (item.actual_price !== null && item.actual_price !== undefined) {
      product.unit_price = item.actual_price;
    }

    if (!item.is_purchased) {
      product.is_purchased = false;
    }

    if (!product.purchase_reason && item.purchase_reason) {
      product.purchase_reason = item.purchase_reason;
    }
  });

  const suppliers = Array.from(suppliersMap.values()).map((supplier) => ({
    ...supplier,
    products: supplier.products.map((product) => {
      const actualQuantity = product.hasActualQuantity
        ? product.actual_quantity
        : product.total_quantity;
      const unitPrice =
        product.unit_price === null || product.unit_price === undefined
          ? null
          : Number(product.unit_price || 0);
      const totalPrice =
        unitPrice === null ? null : Number(actualQuantity || 0) * unitPrice;

      return {
        ...product,
        actual_quantity: actualQuantity,
        actual_price: totalPrice
      };
    })
  }));

  return suppliers;
};

export const PurchaseWalk = () => {
  const [selectedDate, setSelectedDate] = useState(getTomorrowString());
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orderStatus, setOrderStatus] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [editingMap, setEditingMap] = useState({});
  const [editingBackup, setEditingBackup] = useState({});
  const [completing, setCompleting] = useState(false);
  const [activeTab, setActiveTab] = useState('walk');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [reasonModal, setReasonModal] = useState({
    open: false,
    supplierId: null,
    productId: null,
    productName: ''
  });
  const [reasonChoice, setReasonChoice] = useState('');
  const [reasonCustom, setReasonCustom] = useState('');
  const [summaryModal, setSummaryModal] = useState({
    open: false,
    supplier: null
  });
  const [incompleteModal, setIncompleteModal] = useState({
    open: false,
    supplierName: '',
    items: []
  });
  const [searchQuery, setSearchQuery] = useState('');
  const todayString = toLocalDateString(new Date());
  const isTodaySelected = selectedDate === todayString;
  const isOrderOpen = orderStatus?.is_open === true || orderStatus?.is_open === 1;

  const shortageReasons = [
    { id: 'expensive', label: 'สินค้าแพง' },
    { id: 'out_of_stock', label: 'สินค้าขาดตลาด' },
    { id: 'buy_later', label: 'มาซื้ออีกครั้ง' },
    { id: 'other', label: 'อื่นๆ (พิมพ์เอง)' }
  ];

  useEffect(() => {
    fetchData();
  }, [selectedDate]);

  useEffect(() => {
    if (suppliers.length === 0) {
      setSelectedSupplierId('');
      return;
    }
    const exists = suppliers.some(
      (supplier) => String(supplier.id) === String(selectedSupplierId)
    );
    if (!exists) {
      setSelectedSupplierId(String(suppliers[0].id));
    }
  }, [suppliers, selectedSupplierId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const statusRes = await ordersAPI.getOrderStatus(selectedDate);
      const statusData = statusRes?.data ?? statusRes;
      setOrderStatus(statusData);

      if (statusData?.is_open) {
        setSuppliers([]);
        setEditingMap({});
        setEditingBackup({});
        return;
      }

      const response = await adminAPI.getOrderItems(selectedDate);
      const items = Array.isArray(response.data) ? response.data : [];
      setSuppliers(groupPurchaseItems(items));
      setEditingMap({});
      setEditingBackup({});
    } catch (error) {
      console.error('Error fetching purchase data:', error);
      setSuppliers([]);
      setOrderStatus(null);
    } finally {
      setLoading(false);
    }
  };

  const updateProduct = (supplierId, productId, updates) => {
    setSuppliers((prev) =>
      prev.map((supplier) => {
        if (supplier.id !== supplierId) return supplier;
        return {
          ...supplier,
          products: supplier.products.map((product) =>
            product.product_id === productId ? { ...product, ...updates } : product
          )
        };
      })
    );
  };

  const makeEditKey = (supplierId, productId) => `${supplierId}-${productId}`;

  const startEdit = (supplierId, product) => {
    const key = makeEditKey(supplierId, product.product_id);
    setEditingMap((prev) => ({ ...prev, [key]: true }));
    setEditingBackup((prev) => ({
      ...prev,
      [key]: {
        actual_quantity: product.actual_quantity,
        actual_price: product.actual_price
      }
    }));
  };

  const ensureEditing = (supplierId, product) => {
    const key = makeEditKey(supplierId, product.product_id);
    if (!product.is_purchased) return;
    if (editingMap[key]) return;
    startEdit(supplierId, product);
  };

  const cancelEdit = (supplierId, product) => {
    const key = makeEditKey(supplierId, product.product_id);
    const backup = editingBackup[key];
    if (backup) {
      updateProduct(supplierId, product.product_id, {
        actual_quantity: backup.actual_quantity,
        actual_price: backup.actual_price
      });
    }
    setEditingMap((prev) => ({ ...prev, [key]: false }));
  };

  const handleMarkPurchased = async (supplierId, product, overrideReason) => {
    const key = makeEditKey(supplierId, product.product_id);
    const actualPrice =
      product.actual_price === '' || product.actual_price === null
        ? null
        : Number(product.actual_price);
    const actualQuantity =
      product.actual_quantity === '' || product.actual_quantity === null
        ? null
        : Number(product.actual_quantity);
    const totalQuantity = Number(product.total_quantity || 0);
    const normalizedActualQuantity =
      actualQuantity === null || actualQuantity === undefined
        ? totalQuantity
        : Number(actualQuantity || 0);
    const isEnough = normalizedActualQuantity >= totalQuantity;
    const reasonValue =
      overrideReason !== undefined ? overrideReason : product.purchase_reason;

    if (!isEnough && (!reasonValue || String(reasonValue).trim() === '')) {
      setReasonChoice('');
      setReasonCustom('');
      setReasonModal({
        open: true,
        supplierId,
        productId: product.product_id,
        productName: product.product_name || ''
      });
      return;
    }
    const normalizedReason = isEnough ? null : reasonValue;
    const shouldMarkPurchased = isEnough || Boolean(normalizedReason);

    try {
      setSavingId(product.product_id);
      await adminAPI.recordPurchaseByProduct({
        date: selectedDate,
        product_id: product.product_id,
        actual_price: actualPrice,
        actual_quantity: actualQuantity,
        is_purchased: shouldMarkPurchased,
        purchase_reason: normalizedReason
      });
      updateProduct(supplierId, product.product_id, {
        is_purchased: shouldMarkPurchased,
        purchase_reason: normalizedReason
      });
      setEditingMap((prev) => ({ ...prev, [key]: false }));
    } catch (error) {
      console.error('Error recording purchase:', error);
      alert('เกิดข้อผิดพลาดในการบันทึกการซื้อ');
    } finally {
      setSavingId(null);
    }
  };

  const handleResetPurchase = async (supplierId, product) => {
    const confirmed = window.confirm(
      `ยกเลิกการบันทึก "${product.product_name}" แล้วกลับไปสั่งซื้อใหม่ใช่หรือไม่?`
    );
    if (!confirmed) return;

    try {
      setSavingId(product.product_id);
      await adminAPI.recordPurchaseByProduct({
        date: selectedDate,
        product_id: product.product_id,
        actual_price: null,
        actual_quantity: null,
        is_purchased: false,
        purchase_reason: null
      });
      await fetchData();
    } catch (error) {
      console.error('Error resetting purchase:', error);
      alert('เกิดข้อผิดพลาดในการยกเลิกการบันทึก');
    } finally {
      setSavingId(null);
    }
  };

  const selectedSupplier = suppliers.find(
    (supplier) => String(supplier.id) === String(selectedSupplierId)
  );
  const hasItems = suppliers.some((supplier) => supplier.products.length > 0);

  const handleCompletePurchases = async () => {
    if (!selectedSupplier) return;
    const missing = selectedSupplier.products.filter((product) => !product.is_purchased);
    if (missing.length > 0) {
      setIncompleteModal({
        open: true,
        supplierName: selectedSupplier.name || '',
        items: missing
      });
      return;
    }
    const confirmed = window.confirm(
      `ยืนยันซื้อของเสร็จสำหรับซัพพลายเออร์ \"${selectedSupplier.name}\"?\nระบบจะอัปเดตคำสั่งซื้อที่ซื้อครบเป็นสถานะซื้อเรียบร้อย`
    );
    if (!confirmed) return;

    try {
      setCompleting(true);
      const response = await adminAPI.completePurchasesBySupplier(
        selectedDate,
        selectedSupplier.id
      );
      const updated = response?.data?.updated ?? response?.data?.data?.updated ?? response?.updated ?? 0;
      alert(`อัปเดตคำสั่งซื้อสำเร็จ ${updated} รายการ`);
      await fetchData();
      setActiveTab('mine');
    } catch (error) {
      console.error('Error completing purchases:', error);
      alert(error.response?.data?.message || 'เกิดข้อผิดพลาดในการอัปเดตสถานะคำสั่งซื้อ');
    } finally {
      setCompleting(false);
    }
  };

  const openSummaryModal = (supplier) => {
    setSummaryModal({ open: true, supplier });
  };

  const openReasonModal = (supplierId, product) => {
    const matched = shortageReasons.find(
      (reason) => reason.label === product.purchase_reason
    );
    if (matched) {
      setReasonChoice(matched.id);
      setReasonCustom('');
    } else if (product.purchase_reason) {
      setReasonChoice('other');
      setReasonCustom(product.purchase_reason);
    } else {
      setReasonChoice('');
      setReasonCustom('');
    }
    setReasonModal({
      open: true,
      supplierId,
      productId: product.product_id,
      productName: product.product_name || ''
    });
  };

  const handleConfirmReason = async () => {
    const selected = shortageReasons.find((reason) => reason.id === reasonChoice);
    const reasonText =
      reasonChoice === 'other'
        ? reasonCustom.trim()
        : selected?.label || '';

    if (!reasonText) {
      alert('โปรดระบุเหตุผล');
      return;
    }

    const supplier = suppliers.find(
      (entry) => String(entry.id) === String(reasonModal.supplierId)
    );
    const product = supplier?.products.find(
      (entry) => entry.product_id === reasonModal.productId
    );

    if (!product) {
      setReasonModal({ open: false, supplierId: null, productId: null, productName: '' });
      return;
    }

    setReasonModal({ open: false, supplierId: null, productId: null, productName: '' });
    await handleMarkPurchased(supplier.id, product, reasonText);
  };

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">เดินซื้อของตามซัพพลายเออร์</h1>
            <p className="text-sm text-gray-500">รวมสินค้าเพื่อซื้อให้ครบในวันเดียว</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">วันที่</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
              />
            </div>
            {isTodaySelected && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ⚠️ คุณกำลังสั่งของเมื่อวาน (ปกติสั่งวันนี้ซื้อพรุ่งนี้)
              </div>
            )}
            {activeTab === 'walk' && suppliers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suppliers.map((supplier) => (
                  <button
                    key={supplier.id}
                    onClick={() => setSelectedSupplierId(String(supplier.id))}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border transition shadow-sm ${
                      String(selectedSupplierId) === String(supplier.id)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {supplier.name}
                  </button>
                ))}
              </div>
            )}
            <Button
              onClick={handleCompletePurchases}
              disabled={!hasItems || completing}
              variant="success"
            >
              {completing ? 'กำลังอัปเดต...' : 'ยืนยันซื้อของเสร็จแล้ว'}
            </Button>
          </div>
        </div>

        {isOrderOpen && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            ยังไม่สามารถเดินซื้อของได้จนกว่าจะ “ปิดรับออเดอร์” ของวันที่เลือก
          </div>
        )}

        {isOrderOpen ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
            กรุณาปิดรับออเดอร์ก่อนเพื่อเริ่มเดินซื้อของ
          </div>
        ) : suppliers.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
            ไม่มีรายการที่ต้องซื้อ
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setActiveTab('walk')}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                  activeTab === 'walk'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                เดินซื้อของ
              </button>
              <button
                onClick={() => setActiveTab('mine')}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                  activeTab === 'mine'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                การซื้อของฉัน
              </button>
            </div>

            {activeTab === 'walk' ? (
              <div className="space-y-6">
                {!selectedSupplier ? (
                  <div className="text-center py-10 text-gray-500 bg-white rounded-lg shadow-sm">
                    กรุณาเลือกซัพพลายเออร์ก่อน
                  </div>
                ) : (
                  (() => {
                    const supplier = selectedSupplier;
                    const pending = supplier.products.filter((p) => !p.is_purchased);
                    const done = supplier.products.filter((p) => p.is_purchased);

                    return (
                      <Card key={supplier.id}>
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <h2 className="text-xl font-bold text-gray-900">{supplier.name}</h2>
                          <button
                            type="button"
                            onClick={() => openSummaryModal(supplier)}
                            className="px-3 py-1.5 text-xs font-semibold border rounded-lg text-gray-700 hover:bg-gray-50"
                          >
                            ดูออเดอร์ทั้งหมด
                          </button>
                        </div>

                        {pending.length === 0 && done.length > 0 && (
                          <div className="text-sm text-green-600 mb-4">ซื้อครบแล้ว</div>
                        )}

                        <div className="mb-4">
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="ค้นหาสินค้า..."
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div className="space-y-4">
                          {[...pending, ...done]
                            .filter((product) => {
                              if (!searchQuery) return true;
                              return String(product.product_name || '')
                                .toLowerCase()
                                .includes(searchQuery.toLowerCase());
                            })
                            .map((product) => {
                            const editKey = makeEditKey(supplier.id, product.product_id);
                            const isEditing = Boolean(editingMap[editKey]);
                            const orderedQty = Number(product.total_quantity || 0);
                            const actualQty = Number(product.actual_quantity || 0);
                            const diff = Number((actualQty - orderedQty).toFixed(2));
                            const diffAbs = Math.abs(diff);
                            const unitLabel = product.unit_abbr || '';
                            const quantityText =
                              product.actual_quantity === null || product.actual_quantity === undefined
                                ? ''
                                : String(product.actual_quantity);
                            const baseQuantityWidth = Math.max(
                              4,
                              Math.ceil((quantityText.length + 1) * 1.33)
                            );
                            const quantityWidth = Math.ceil(baseQuantityWidth * 4 / 3);
                            const statusText =
                              diff === 0 ? '0' : diff > 0 ? `+${diffAbs}` : `-${diffAbs}`;
                            const statusColor =
                              diff === 0
                                ? 'text-emerald-600'
                                : diff > 0
                                  ? 'text-amber-600'
                                  : 'text-red-600';
                            const totalAmount =
                              product.actual_price !== null && product.actual_price !== ''
                                ? Number(product.actual_price || 0)
                                : null;
                            const isDone = product.is_purchased;
                            const canSave = !isDone || isEditing;

                            return (
                              <div
                                key={product.product_id}
                                className={`border-b py-2 last:border-b-0 ${
                                  isDone ? 'opacity-60' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-gray-900 whitespace-normal break-words">
                                      {product.product_name}
                                      {unitLabel && (
                                        <span className="ml-2 text-[10px] text-gray-400">
                                          {unitLabel}
                                        </span>
                                      )}
                                    </p>
                                    {diff < 0 && (
                                      <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-2">
                                        <span>เหตุผล: {product.purchase_reason || '-'}</span>
                                        <button
                                          type="button"
                                          onClick={() => openReasonModal(supplier.id, product)}
                                          className="text-xs text-blue-600 hover:text-blue-700"
                                        >
                                          แก้ไขเหตุผล
                                        </button>
                                      </p>
                                    )}
                                  </div>
                                  <span
                                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor} bg-gray-50`}
                                  >
                                    {statusText}
                                  </span>
                                  <div
                                    className="flex-shrink-0"
                                    style={{ width: `${quantityWidth}ch` }}
                                  >
                                    <Input
                                      type="number"
                                      value={product.actual_quantity}
                                      onChange={(e) => {
                                        ensureEditing(supplier.id, product);
                                        updateProduct(supplier.id, product.product_id, {
                                          actual_quantity: e.target.value
                                        });
                                      }}
                                      onFocus={(e) => {
                                        ensureEditing(supplier.id, product);
                                        e.target.select();
                                      }}
                                      min="0"
                                      step="0.1"
                                      placeholder="จำนวน"
                                      style={{ textAlign: 'right' }}
                                      disabled={isDone && !isEditing}
                                    />
                                  </div>
                                  <div className="w-16">
                                    <Input
                                      type="number"
                                      value={product.actual_price ?? ''}
                                      onChange={(e) => {
                                        ensureEditing(supplier.id, product);
                                        updateProduct(supplier.id, product.product_id, {
                                          actual_price: e.target.value
                                        });
                                      }}
                                      onFocus={(e) => {
                                        ensureEditing(supplier.id, product);
                                        e.target.select();
                                      }}
                                      min="0"
                                      step="0.01"
                                      placeholder="ราคา"
                                      style={{ textAlign: 'right' }}
                                      disabled={isDone && !isEditing}
                                    />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {isEditing && (
                                      <Button
                                        onClick={() => cancelEdit(supplier.id, product)}
                                        variant="secondary"
                                        size="sm"
                                        disabled={savingId === product.product_id}
                                      >
                                        ยกเลิก
                                      </Button>
                                    )}
                                    {!isEditing && isDone && (
                                      <>
                                        <Button
                                          onClick={() => handleResetPurchase(supplier.id, product)}
                                          variant="secondary"
                                          size="sm"
                                          disabled={savingId === product.product_id}
                                        >
                                          ยกเลิก
                                        </Button>
                                        <Button
                                          onClick={() => startEdit(supplier.id, product)}
                                          variant="secondary"
                                          size="sm"
                                          disabled={savingId === product.product_id}
                                          aria-label="แก้ไข"
                                        >
                                          <svg
                                            className="w-4 h-4"
                                            viewBox="0 0 20 20"
                                            fill="none"
                                            stroke="currentColor"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth="1.5"
                                              d="M4 13.5V16h2.5l7.1-7.1-2.5-2.5L4 13.5zM12.6 5.4l2 2"
                                            />
                                          </svg>
                                        </Button>
                                      </>
                                    )}
                                    {canSave && (
                                      <Button
                                        onClick={() => handleMarkPurchased(supplier.id, product)}
                                        variant="success"
                                        size="sm"
                                        disabled={savingId === product.product_id}
                                        aria-label="บันทึก"
                                      >
                                        ✓
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    );
                  })()
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {suppliers.map((supplier) => (
                  <Card key={supplier.id}>
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <h2 className="text-xl font-bold text-gray-900">{supplier.name}</h2>
                      <button
                        type="button"
                        onClick={() => openSummaryModal(supplier)}
                        className="px-3 py-1.5 text-xs font-semibold border rounded-lg text-gray-700 hover:bg-gray-50"
                      >
                        ดูออเดอร์ทั้งหมด
                      </button>
                    </div>
                    <div className="space-y-3">
                      {supplier.products.map((product) => {
                        const orderedQty = Number(product.total_quantity || 0);
                        const actualQty = Number(product.actual_quantity || 0);
                        const diff = Number((actualQty - orderedQty).toFixed(2));
                        const diffAbs = Math.abs(diff);
                        const unitLabel = product.unit_abbr || '';
                        const statusText =
                          diff === 0 ? '0' : diff > 0 ? `+${diffAbs}` : `-${diffAbs}`;
                        const statusColor =
                          diff === 0
                            ? 'text-emerald-600'
                            : diff > 0
                              ? 'text-amber-600'
                              : 'text-red-600';
                        const totalAmount =
                          product.actual_price !== null && product.actual_price !== ''
                            ? Number(product.actual_price || 0)
                            : null;

                        return (
                          <div
                            key={product.product_id}
                            className="border-b py-2 last:border-b-0"
                          >
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-gray-900 whitespace-normal break-words">
                                  {product.product_name}
                                </p>
                                {diff < 0 && (
                                  <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-2">
                                    <span>เหตุผล: {product.purchase_reason || '-'}</span>
                                    <button
                                      type="button"
                                      onClick={() => openReasonModal(supplier.id, product)}
                                      className="text-xs text-blue-600 hover:text-blue-700"
                                    >
                                      แก้ไขเหตุผล
                                    </button>
                                  </p>
                                )}
                              </div>
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor} bg-gray-50`}
                              >
                                {statusText}
                              </span>
                              <span className="text-xs text-gray-600">
                                รับจริง {actualQty} {unitLabel}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={reasonModal.open}
        onClose={() =>
          setReasonModal({ open: false, supplierId: null, productId: null, productName: '' })
        }
        title="โปรดระบุเหตุผลที่ได้ของไม่ครบ"
        size="medium"
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            รายการ: {reasonModal.productName || '-'}
          </div>
          <div className="space-y-2">
            {shortageReasons.map((reason) => (
              <label
                key={reason.id}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="radio"
                  name="shortage-reason"
                  value={reason.id}
                  checked={reasonChoice === reason.id}
                  onChange={(e) => setReasonChoice(e.target.value)}
                />
                <span>{reason.label}</span>
              </label>
            ))}
          </div>
          {reasonChoice === 'other' && (
            <div>
              <Input
                label="ระบุเหตุผลเพิ่มเติม"
                value={reasonCustom}
                onChange={(e) => setReasonCustom(e.target.value)}
                placeholder="พิมพ์เหตุผลเอง"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setReasonModal({
                  open: false,
                  supplierId: null,
                  productId: null,
                  productName: ''
                })
              }
            >
              ยกเลิก
            </Button>
            <Button variant="success" onClick={handleConfirmReason}>
              บันทึกเหตุผล
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={summaryModal.open}
        onClose={() => setSummaryModal({ open: false, supplier: null })}
        title={
          summaryModal.supplier
            ? `ออเดอร์ทั้งหมด: ${summaryModal.supplier.name}`
            : 'ออเดอร์ทั้งหมด'
        }
        size="medium"
      >
        {summaryModal.supplier ? (
          <div className="space-y-1 text-sm leading-tight max-h-[60vh] overflow-y-auto pr-1">
            {summaryModal.supplier.products.map((product) => (
              <div
                key={product.product_id}
                className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-gray-100 py-1 last:border-b-0"
              >
                <span className="truncate text-gray-800">{product.product_name}</span>
                <span className="font-semibold text-gray-700">
                  {Number(product.total_quantity || 0).toFixed(2)}{' '}
                  {product.unit_abbr || ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">ไม่มีข้อมูล</div>
        )}
      </Modal>

      <Modal
        isOpen={incompleteModal.open}
        onClose={() =>
          setIncompleteModal({ open: false, supplierName: '', items: [] })
        }
        title="ยังไม่ได้บันทึกสินค้าบางรายการ"
        size="medium"
      >
        <div className="space-y-3 text-sm">
          <div className="text-gray-600">
            ซัพพลายเออร์: {incompleteModal.supplierName || '-'}
          </div>
          <div className="text-gray-700">
            โปรดบันทึกรายการต่อไปนี้ก่อนยืนยันซื้อของเสร็จ:
          </div>
          <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
            {incompleteModal.items.map((product) => (
              <div
                key={product.product_id}
                className="grid grid-cols-[1fr_auto] items-center gap-2"
              >
                <span className="truncate">{product.product_name}</span>
                <span className="font-semibold text-gray-700">
                  {Number(product.total_quantity || 0).toFixed(2)}{' '}
                  {product.unit_abbr || ''}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() =>
                setIncompleteModal({ open: false, supplierName: '', items: [] })
              }
            >
              ปิด
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
};
