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
      supplier.products.push({
        product_id: item.product_id,
        product_name: item.product_name,
        unit_abbr: item.unit_abbr,
        total_quantity: 0,
        actual_quantity: 0,
        actual_price:
          item.actual_price ??
          item.yesterday_actual_price ??
          item.last_actual_price ??
          item.last_requested_price ??
          item.requested_price ??
          null,
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
      product.actual_price = item.actual_price;
    }

    if (!item.is_purchased) {
      product.is_purchased = false;
    }
  });

  const suppliers = Array.from(suppliersMap.values()).map((supplier) => ({
    ...supplier,
    products: supplier.products.map((product) => ({
      ...product,
      actual_quantity: product.hasActualQuantity
        ? product.actual_quantity
        : product.total_quantity
    }))
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

  useEffect(() => {
    fetchData();
  }, [selectedDate]);

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

    try {
      setSavingId(product.product_id);
      await adminAPI.recordPurchaseByProduct({
        date: selectedDate,
        product_id: product.product_id,
        actual_price: actualPrice,
        actual_quantity: actualQuantity,
        is_purchased: true
      });
      updateProduct(supplierId, product.product_id, { is_purchased: true });
      setEditingMap((prev) => ({ ...prev, [key]: false }));
    } catch (error) {
      console.error('Error recording purchase:', error);
      alert('เกิดข้อผิดพลาดในการบันทึกการซื้อ');
    } finally {
      setSavingId(null);
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
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {suppliers.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
            ไม่มีรายการที่ต้องซื้อ
          </div>
        ) : (
          <div className="space-y-6">
            {suppliers.map((supplier) => {
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
                      const totalAmount =
                        product.actual_price !== null && product.actual_price !== ''
                          ? Number(product.actual_price || 0) * Number(product.actual_quantity || 0)
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
                              <p className="font-semibold text-gray-900 truncate">
                                {product.product_name}
                              </p>
                              <p className="text-xs text-gray-500">
                                สั่ง {product.total_quantity} {product.unit_abbr}
                                {product.latest_price !== null && product.latest_price !== undefined
                                  ? ` ราคา ${Number(product.latest_price || 0).toFixed(2)}`
                                  : ''}
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
                                placeholder="ราคา"
                                disabled={isDone && !isEditing}
                              />
                            </div>
                            {totalAmount !== null && (
                              <div className="hidden sm:block text-right text-xs sm:text-sm text-blue-600 w-16 sm:w-20">
                                ฿{totalAmount.toFixed(2)}
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              <Button
                                onClick={() =>
                                  isEditing
                                    ? cancelEdit(supplier.id, product)
                                    : startEdit(supplier.id, product)
                                }
                                variant="secondary"
                                size="sm"
                                disabled={savingId === product.product_id}
                              >
                                {isEditing ? 'ยกเลิก' : 'แก้ไข'}
                              </Button>
                              <Button
                                onClick={() => handleMarkPurchased(supplier.id, product)}
                                variant={isDone && !isEditing ? 'secondary' : 'success'}
                                size="sm"
                                disabled={!canSave || savingId === product.product_id}
                              >
                                {isDone && !isEditing ? 'ซื้อแล้ว' : 'บันทึก'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
};
