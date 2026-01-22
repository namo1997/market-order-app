import { useEffect, useState } from 'react';
import { adminAPI } from '../../api/admin';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Loading } from '../../components/common/Loading';

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
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [editingMap, setEditingMap] = useState({});
  const [editingBackup, setEditingBackup] = useState({});
  const [completing, setCompleting] = useState(false);
  const [activeTab, setActiveTab] = useState('walk');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

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
      const response = await adminAPI.getOrderItems(selectedDate);
      const items = Array.isArray(response.data) ? response.data : [];
      setSuppliers(groupPurchaseItems(items));
      setEditingMap({});
      setEditingBackup({});
    } catch (error) {
      console.error('Error fetching purchase data:', error);
      setSuppliers([]);
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

  const handleMarkPurchased = async (supplierId, product) => {
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

    try {
      setSavingId(product.product_id);
      await adminAPI.recordPurchaseByProduct({
        date: selectedDate,
        product_id: product.product_id,
        actual_price: actualPrice,
        actual_quantity: actualQuantity,
        is_purchased: isEnough
      });
      updateProduct(supplierId, product.product_id, { is_purchased: isEnough });
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
        is_purchased: false
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
  const isSelectedSupplierPurchased = Boolean(
    selectedSupplier &&
    selectedSupplier.products.length > 0 &&
    selectedSupplier.products.every((product) => product.is_purchased)
  );

  const handleCompletePurchases = async () => {
    if (!selectedSupplier) return;
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
              disabled={!hasItems || !isSelectedSupplierPurchased || completing}
              variant="success"
            >
              {completing ? 'กำลังอัปเดต...' : 'ยืนยันซื้อของเสร็จแล้ว'}
            </Button>
          </div>
        </div>

        {suppliers.length === 0 ? (
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
                        <h2 className="text-xl font-bold text-gray-900 mb-4">{supplier.name}</h2>

                        {pending.length === 0 && done.length > 0 && (
                          <div className="text-sm text-green-600 mb-4">ซื้อครบแล้ว</div>
                        )}

                        <div className="space-y-4">
                          {[...pending, ...done].map((product) => {
                            const editKey = makeEditKey(supplier.id, product.product_id);
                            const isEditing = Boolean(editingMap[editKey]);
                            const orderedQty = Number(product.total_quantity || 0);
                            const actualQty = Number(product.actual_quantity || 0);
                            const diff = Number((actualQty - orderedQty).toFixed(2));
                            const diffAbs = Math.abs(diff);
                            const unitLabel = product.unit_abbr || '';
                            const statusText =
                              diff === 0
                                ? `ได้ครบตามจำนวน (สั่ง ${orderedQty} ${unitLabel}, รับจริง ${actualQty} ${unitLabel})`
                                : diff > 0
                                  ? `ได้เกิน ${diffAbs} ${unitLabel} (สั่ง ${orderedQty} ${unitLabel}, รับจริง ${actualQty} ${unitLabel})`
                                  : `ไม่ได้ครบ ขาด ${diffAbs} ${unitLabel} (สั่ง ${orderedQty} ${unitLabel}, รับจริง ${actualQty} ${unitLabel})`;
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
                                className={`border-b py-3 last:border-b-0 ${
                                  isDone ? 'opacity-60' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2 sm:gap-3 flex-nowrap">
                                  <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-gray-900 whitespace-normal break-words">
                                      {product.product_name}
                                    </p>
                                    <p className={`text-xs mt-1 ${statusColor}`}>
                                      {statusText}
                                    </p>
                                  </div>
                                  <div className="w-20 sm:w-24">
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
                                      disabled={isDone && !isEditing}
                                    />
                                  </div>
                                  <div className="w-20 sm:w-24">
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
                                      placeholder="ราคารวม"
                                      disabled={isDone && !isEditing}
                                    />
                                  </div>
                                  {totalAmount !== null && (
                                    <div className="hidden sm:block text-right text-xs sm:text-sm text-blue-600 w-16 sm:w-20">
                                      ฿{totalAmount.toFixed(2)}
                                    </div>
                                  )}
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
                                      >
                                        บันทึก
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
                    <h2 className="text-xl font-bold text-gray-900 mb-4">{supplier.name}</h2>
                    <div className="space-y-3">
                      {supplier.products.map((product) => {
                        const orderedQty = Number(product.total_quantity || 0);
                        const actualQty = Number(product.actual_quantity || 0);
                        const diff = Number((actualQty - orderedQty).toFixed(2));
                        const diffAbs = Math.abs(diff);
                        const unitLabel = product.unit_abbr || '';
                        const statusText =
                          diff === 0
                            ? `ได้ครบตามจำนวน (สั่ง ${orderedQty} ${unitLabel}, รับจริง ${actualQty} ${unitLabel})`
                            : diff > 0
                              ? `ได้เกิน ${diffAbs} ${unitLabel} (สั่ง ${orderedQty} ${unitLabel}, รับจริง ${actualQty} ${unitLabel})`
                              : `ไม่ได้ครบ ขาด ${diffAbs} ${unitLabel} (สั่ง ${orderedQty} ${unitLabel}, รับจริง ${actualQty} ${unitLabel})`;
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
                            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b pb-3 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900 whitespace-normal break-words">
                                {product.product_name}
                              </p>
                              <p className={`text-xs mt-1 ${statusColor}`}>
                                {statusText}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 text-sm text-gray-600">
                              <span>รับจริง {actualQty} {unitLabel}</span>
                              {product.actual_price !== null && product.actual_price !== '' && (
                                <span>ราคารวม ฿{Number(product.actual_price || 0).toFixed(2)}</span>
                              )}
                              {totalAmount !== null && (
                                <span className="font-semibold text-blue-600">
                                  รวม ฿{totalAmount.toFixed(2)}
                                </span>
                              )}
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
    </Layout>
  );
};
