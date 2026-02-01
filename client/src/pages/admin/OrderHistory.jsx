import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminAPI } from '../../api/admin';
import { ordersAPI } from '../../api/orders';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';

const aggregateProducts = (items) => {
  const map = new Map();

  items.forEach((item) => {
    const key = item.product_id;
    if (!map.has(key)) {
      map.set(key, {
        product_id: item.product_id,
        product_name: item.product_name,
        unit_abbr: item.unit_abbr,
        unit_name: item.unit_name,
        purchase_sort_order: item.purchase_sort_order ?? null,
        unit_price:
          item.actual_price ??
          item.requested_price ??
          item.last_actual_price ??
          null,
        total_quantity: 0
      });
    }
    const entry = map.get(key);
    entry.total_quantity += Number(item.quantity || 0);
    if (
      entry.purchase_sort_order === null &&
      item.purchase_sort_order !== null &&
      item.purchase_sort_order !== undefined
    ) {
      entry.purchase_sort_order = item.purchase_sort_order;
    }
  });

  return Array.from(map.values()).map((product) => ({
    ...product,
    total_amount:
      product.unit_price !== null
        ? Number(product.total_quantity || 0) * Number(product.unit_price || 0)
        : null
  }));
};

const formatQuantity = (value) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '';
  const rounded = Math.round(num * 10) / 10;
  const text = rounded.toFixed(1);
  return text.endsWith('.0') ? text.slice(0, -2) : text;
};

const groupItems = (items, type, sortByWalk = false) => {
  const groups = new Map();

  items.forEach((item) => {
    let key = '';
    let name = '';

    if (type === 'supplier') {
      key = item.supplier_id || 'none';
      name = item.supplier_name || 'ไม่ระบุซัพพลายเออร์';
    } else if (type === 'branch') {
      key = item.branch_id || 'none';
      name = item.branch_name || 'ไม่ระบุสาขา';
    } else {
      key = item.department_id || 'none';
      name = item.department_name || 'ไม่ระบุแผนก';
      if (item.branch_name) {
        name = `${name} (${item.branch_name})`;
      }
    }

    if (!groups.has(key)) {
      groups.set(key, { id: key, name, items: [] });
    }
    groups.get(key).items.push(item);
  });

  return Array.from(groups.values()).map((group) => {
    const products = aggregateProducts(group.items);
    const orderedProducts = sortByWalk
      ? [...products].sort((a, b) => {
          const orderA = a.purchase_sort_order ?? 999999;
          const orderB = b.purchase_sort_order ?? 999999;
          if (orderA !== orderB) return orderA - orderB;
          return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th');
        })
      : products;

    return {
      ...group,
      products: orderedProducts
    };
  });
};

const groupItemsByBranchSupplier = (items, sortByWalk = false) => {
  const branches = new Map();

  items.forEach((item) => {
    const key = item.branch_id || 'none';
    const name = item.branch_name || 'ไม่ระบุสาขา';
    if (!branches.has(key)) {
      branches.set(key, { id: key, name, items: [] });
    }
    branches.get(key).items.push(item);
  });

  return Array.from(branches.values())
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      suppliers: groupSuppliers(branch.items, sortByWalk)
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
};
const groupSuppliers = (items, sortByWalk = false) => {
  const suppliers = new Map();

  items.forEach((item) => {
    const key = item.supplier_id || 'none';
    const name = item.supplier_name || 'ไม่ระบุซัพพลายเออร์';
    if (!suppliers.has(key)) {
      suppliers.set(key, { id: key, name, items: [] });
    }
    suppliers.get(key).items.push(item);
  });

  return Array.from(suppliers.values())
    .map((supplier) => {
      const products = aggregateProducts(supplier.items);
      const orderedProducts = sortByWalk
        ? [...products].sort((a, b) => {
            const orderA = a.purchase_sort_order ?? 999999;
            const orderB = b.purchase_sort_order ?? 999999;
            if (orderA !== orderB) return orderA - orderB;
            return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th');
          })
        : products;
      const totalAmount = products.reduce(
        (sum, product) => sum + Number(product.total_amount || 0),
        0
      );
      return {
        id: supplier.id,
        name: supplier.name,
        products: orderedProducts,
        total_amount: totalAmount
      };
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
};

const buildBranchSupplierMatrix = (branchGroups, sortByWalk = false) => {
  const normalizeBranchName = (name) =>
    String(name || '')
      .replace(/\s+/g, '')
      .trim();
  const getBaseKey = (name) => {
    const normalized = normalizeBranchName(name);
    return normalized
      .replace(/^สาขาผลิต/, '')
      .replace(/^ผลิตสาขา/, '')
      .replace(/^สาขา/, '')
      .replace(/^ผลิต/, '')
      .replace(/สาขา/g, '')
      .replace(/ผลิต/g, '')
      .trim();
  };
  const isProductionBranch = (name) => normalizeBranchName(name).includes('ผลิต');
  const walkBasePriority = ['คันคลอง', 'สันกำแพง'];
  const priorityBases = walkBasePriority;
  const getWalkRank = (name) => {
    const base = getBaseKey(name);
    const baseIndex = walkBasePriority.indexOf(base);
    if (baseIndex === -1) return null;
    const prodRank = isProductionBranch(name) ? 0 : 1;
    return baseIndex * 2 + prodRank;
  };

  const branchList = branchGroups
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      base: getBaseKey(branch.name),
      isProduction: isProductionBranch(branch.name),
      walkRank: getWalkRank(branch.name)
    }))
    .sort((a, b) => {
      if (sortByWalk) {
        const hasRankA = a.walkRank !== null && a.walkRank !== undefined;
        const hasRankB = b.walkRank !== null && b.walkRank !== undefined;
        if (hasRankA || hasRankB) {
          if (!hasRankA) return 1;
          if (!hasRankB) return -1;
          if (a.walkRank !== b.walkRank) return a.walkRank - b.walkRank;
        }
        return String(a.name || '').localeCompare(String(b.name || ''), 'th');
      }

      const indexA = priorityBases.indexOf(a.base);
      const indexB = priorityBases.indexOf(b.base);
      const isPriorityA = indexA !== -1;
      const isPriorityB = indexB !== -1;

      if (isPriorityA || isPriorityB) {
        if (!isPriorityA) return 1;
        if (!isPriorityB) return -1;
        const prodGroupA = a.isProduction ? 0 : 1;
        const prodGroupB = b.isProduction ? 0 : 1;
        if (prodGroupA !== prodGroupB) return prodGroupA - prodGroupB;
        if (indexA !== indexB) return indexA - indexB;
        return String(a.name || '').localeCompare(String(b.name || ''), 'th');
      }

      if (a.base !== b.base) {
        return a.base.localeCompare(b.base, 'th');
      }
      const prodA = a.isProduction ? 1 : 0;
      const prodB = b.isProduction ? 1 : 0;
      if (prodA !== prodB) {
        return prodA - prodB;
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'th');
    })
    .map(({ id, name }) => ({ id, name }));
  const supplierMap = new Map();

  branchGroups.forEach((branch) => {
    branch.suppliers.forEach((supplier) => {
      if (!supplierMap.has(supplier.id)) {
        supplierMap.set(supplier.id, {
          id: supplier.id,
          name: supplier.name,
          products: new Map()
        });
      }
      const supplierEntry = supplierMap.get(supplier.id);

      supplier.products.forEach((product) => {
        if (!supplierEntry.products.has(product.product_id)) {
          supplierEntry.products.set(product.product_id, {
            product_id: product.product_id,
            product_name: product.product_name,
            unit_abbr: product.unit_abbr,
            purchase_sort_order: product.purchase_sort_order ?? null,
            quantities: {},
            total_quantity: 0
          });
        }
        const productEntry = supplierEntry.products.get(product.product_id);
        const qty = Number(product.total_quantity || 0);
        if (
          productEntry.purchase_sort_order === null &&
          product.purchase_sort_order !== null &&
          product.purchase_sort_order !== undefined
        ) {
          productEntry.purchase_sort_order = product.purchase_sort_order;
        }
        productEntry.quantities[branch.id] =
          (productEntry.quantities[branch.id] || 0) + qty;
        productEntry.total_quantity += qty;
      });
    });
  });

  const suppliers = Array.from(supplierMap.values()).map((supplier) => {
    const products = Array.from(supplier.products.values());
    const orderedProducts = sortByWalk
      ? [...products].sort((a, b) => {
          const orderA = a.purchase_sort_order ?? 999999;
          const orderB = b.purchase_sort_order ?? 999999;
          if (orderA !== orderB) return orderA - orderB;
          return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th');
        })
      : products.sort((a, b) =>
          String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th')
        );
    return {
      ...supplier,
      products: orderedProducts
    };
  });

  return { branches: branchList, suppliers };
};

const formatBranchHeader = (name) => {
  if (!name) return [''];
  let label = String(name);
  label = label.replace(/สาขาผลิต/g, 'สาขาผลิต\n');
  label = label.replace(/สาขา(?!ผลิต)/g, 'สาขา\n');
  label = label.replace(/\s+/g, '\n');
  return label
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const buildSummaryGroups = (items, mode) => {
  if (mode === 'all') {
    return [
      {
        id: 'all',
        name: 'รวมทุกสาขา',
        suppliers: groupSuppliers(items)
      }
    ];
  }

  const groups = new Map();

  items.forEach((item) => {
    let key = '';
    let name = '';

    if (mode === 'branch') {
      key = item.branch_id || 'none';
      name = item.branch_name || 'ไม่ระบุสาขา';
    } else {
      key = item.department_id || 'none';
      name = item.department_name || 'ไม่ระบุแผนก';
      if (item.branch_name) {
        name = `${name} (${item.branch_name})`;
      }
    }

    if (!groups.has(key)) {
      groups.set(key, { id: key, name, items: [] });
    }
    groups.get(key).items.push(item);
  });

  return Array.from(groups.values())
    .map((group) => ({
      id: group.id,
      name: group.name,
      suppliers: groupSuppliers(group.items)
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
};

export const OrderHistory = () => {
  const [searchParams] = useSearchParams();
  const initialDate =
    searchParams.get('date') || new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summaryItems, setSummaryItems] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryView, setSummaryView] = useState('all');
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printDate, setPrintDate] = useState(initialDate);
  const [printType, setPrintType] = useState('supplier');
  const [printSortByWalk, setPrintSortByWalk] = useState(false);
  const [printData, setPrintData] = useState(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const printOptions = [
    { id: 'all', label: 'ทุกรูปแบบ' },
    { id: 'branch', label: 'ตามสาขา' },
    { id: 'department', label: 'ตามแผนก' },
    { id: 'supplier', label: 'ตามซัพพลายเออร์' },
    { id: 'branch_supplier', label: 'ตามสาขา/ซัพพลายเออร์' }
  ];

  useEffect(() => {
    fetchHistory();
    fetchSummaryItems();
  }, [selectedDate]);

  useEffect(() => {
    setPrintDate(selectedDate);
  }, [selectedDate]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getAllOrders({ date: selectedDate });
      const data = Array.isArray(response.data) ? response.data : [];
      setOrders(data.filter((order) => order.status !== 'submitted'));
    } catch (error) {
      console.error('Error fetching order history:', error);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchSummaryItems = async () => {
    try {
      setSummaryLoading(true);
      const response = await adminAPI.getOrderItems(selectedDate);
      const items = Array.isArray(response.data) ? response.data : [];
      setSummaryItems(items);
    } catch (error) {
      console.error('Error fetching order items:', error);
      setSummaryItems([]);
    } finally {
      setSummaryLoading(false);
    }
  };

  const totalAmount = useMemo(
    () => orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
    [orders]
  );

  const formatOrderTime = (value) => {
    if (!value) return '';
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return '';
    return dateValue.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const summaryGroups = useMemo(
    () => buildSummaryGroups(summaryItems, summaryView),
    [summaryItems, summaryView]
  );

  const handlePrint = async () => {
    try {
      setPrintLoading(true);
      const response = await adminAPI.getOrderItems(printDate);
      const items = Array.isArray(response.data) ? response.data : [];
      if (printType === 'all') {
        const sections = ['department', 'branch', 'supplier', 'branch_supplier'].map((type) => ({
          type,
          label: printOptions.find((opt) => opt.id === type)?.label || type,
          groups:
            type === 'branch_supplier'
              ? groupItemsByBranchSupplier(items, printSortByWalk)
              : groupItems(items, type, printSortByWalk)
        }));
        setPrintData({
          date: printDate,
          type: printType,
          sortByWalk: printSortByWalk,
          sections
        });
      } else if (printType === 'branch_supplier') {
        setPrintData({
          date: printDate,
          type: printType,
          sortByWalk: printSortByWalk,
          groups: groupItemsByBranchSupplier(items, printSortByWalk)
        });
      } else {
        const grouped = groupItems(items, printType, printSortByWalk);
        setPrintData({
          date: printDate,
          type: printType,
          sortByWalk: printSortByWalk,
          groups: grouped
        });
      }
      setPrintModalOpen(false);
      setTimeout(() => window.print(), 200);
    } catch (error) {
      console.error('Error preparing print:', error);
      alert('ไม่สามารถเตรียมข้อมูลพิมพ์ได้');
    } finally {
      setPrintLoading(false);
    }
  };

  const openOrderDetail = async (orderId) => {
    try {
      setDetailLoading(true);
      setEditMode(false);
      const response = await ordersAPI.getOrderById(orderId);
      const order = response.data;
      setSelectedOrder(order);
      setEditItems(
        (order?.items || []).map((item) => ({
          id: item.id,
          product_id: item.product_id,
          product_name: item.product_name,
          unit_abbr: item.unit_abbr,
          unit_name: item.unit_name,
          quantity: item.quantity,
          requested_price: item.requested_price,
          notes: item.notes || ''
        }))
      );
    } catch (error) {
      console.error('Error fetching order detail:', error);
      alert('ไม่สามารถโหลดรายละเอียดคำสั่งซื้อได้');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleEditItemChange = (itemId, field, value) => {
    setEditItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item
      )
    );
  };

  const handleRemoveEditItem = (itemId) => {
    setEditItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleSaveEdit = async () => {
    if (!selectedOrder) return;
    if (editItems.length === 0) {
      alert('ไม่พบรายการสินค้าให้บันทึก');
      return;
    }

    try {
      setSavingEdit(true);
      const payload = editItems.map((item) => ({
        product_id: item.product_id,
        quantity: Number(item.quantity || 0),
        requested_price: Number(item.requested_price || 0),
        notes: item.notes || ''
      }));
      await ordersAPI.updateOrder(selectedOrder.id, payload);
      alert('บันทึกการแก้ไขคำสั่งซื้อแล้ว');
      await openOrderDetail(selectedOrder.id);
      fetchHistory();
      fetchSummaryItems();
    } catch (error) {
      console.error('Error updating order:', error);
      alert(error.response?.data?.message || 'บันทึกการแก้ไขไม่สำเร็จ');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditItems(
      (selectedOrder?.items || []).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        unit_abbr: item.unit_abbr,
        unit_name: item.unit_name,
        quantity: item.quantity,
        requested_price: item.requested_price,
        notes: item.notes || ''
      }))
    );
  };

  const editTotal = useMemo(() => {
    return editItems.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0) * Number(item.requested_price || 0),
      0
    );
  }, [editItems]);

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto print:hidden">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ประวัติคำสั่งซื้อ</h1>
            <p className="text-sm text-gray-500">คำสั่งซื้อที่ปิดรับแล้ว</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button onClick={() => setPrintModalOpen(true)} variant="secondary">
              พิมพ์
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="bg-blue-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">จำนวนคำสั่งซื้อ</p>
              <p className="text-3xl font-bold text-blue-600">{orders.length}</p>
            </div>
          </Card>
          <Card className="bg-green-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">ยอดรวมทั้งหมด</p>
              <p className="text-2xl font-bold text-green-600">
                ฿{totalAmount.toFixed(2)}
              </p>
            </div>
          </Card>
        </div>

        <Card className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">สรุปรายการสินค้า</h2>
              <p className="text-sm text-gray-500">
                แยกซัพพลายเออร์และรวมสินค้าในคำสั่งซื้อ
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {[
                { id: 'all', label: 'รวมทุกสาขา' },
                { id: 'branch', label: 'แยกสาขา' },
                { id: 'department', label: 'แยกแผนก+สาขา' }
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => setSummaryView(option.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold transition ${
                    summaryView === option.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {summaryLoading ? (
            <div className="py-6 text-center text-gray-500">กำลังโหลด...</div>
          ) : summaryItems.length === 0 ? (
            <div className="py-6 text-center text-gray-500">ไม่มีรายการสินค้าในวันนี้</div>
          ) : (
            <div className="mt-4 space-y-4">
              {summaryGroups.map((group) => (
                <div key={group.id} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">{group.name}</h3>
                    <span className="text-xs text-gray-500">
                      {group.suppliers.length} ซัพพลายเออร์
                    </span>
                  </div>
                  {group.suppliers.length === 0 ? (
                    <div className="mt-3 text-sm text-gray-500">
                      ไม่มีรายการสินค้า
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {group.suppliers.map((supplier) => (
                        <div key={supplier.id} className="rounded-lg border border-gray-100 p-3">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-gray-900">{supplier.name}</p>
                            <span className="text-sm text-blue-600 font-semibold">
                              ฿{Number(supplier.total_amount || 0).toFixed(2)}
                            </span>
                          </div>
                          <div className="mt-2 space-y-2 text-sm">
                            {supplier.products.map((product) => (
                              <div
                                key={product.product_id}
                                className="flex items-center justify-between text-gray-600"
                              >
                                <span className="truncate pr-3">{product.product_name}</span>
                                <span className="whitespace-nowrap">
                                  {product.total_quantity} {product.unit_abbr}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {orders.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
            ไม่มีคำสั่งซื้อในวันนี้
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <Card
                key={order.id}
                onClick={() => openOrderDetail(order.id)}
                className="cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">
                      {order.branch_name} • {order.department_name}
                    </p>
                    <p className="text-sm text-gray-600">
                      {order.order_number}
                      {formatOrderTime(order.submitted_at || order.created_at || order.order_date)
                        ? ` • เวลา ${formatOrderTime(order.submitted_at || order.created_at || order.order_date)}`
                        : ''}
                    </p>
                  </div>
                  <div className="font-semibold text-blue-600">
                    ฿{Number(order.total_amount || 0).toFixed(2)}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        title="รายละเอียดคำสั่งซื้อ"
        size="large"
      >
        {detailLoading ? (
          <div className="py-8 text-center text-gray-500">กำลังโหลด...</div>
        ) : (
          selectedOrder && (
            <div>
              <div className="mb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">
                    {selectedOrder.branch_name} • {selectedOrder.department_name}
                  </p>
                  <p className="text-sm text-gray-500">
                    {selectedOrder.order_number}
                    {formatOrderTime(selectedOrder.submitted_at || selectedOrder.created_at || selectedOrder.order_date)
                      ? ` • เวลา ${formatOrderTime(selectedOrder.submitted_at || selectedOrder.created_at || selectedOrder.order_date)}`
                      : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  {editMode ? (
                    <>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50"
                        disabled={savingEdit}
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        className="px-3 py-1.5 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300"
                        disabled={savingEdit}
                      >
                        {savingEdit ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditMode(true)}
                      className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50"
                    >
                      แก้ไขคำสั่งซื้อ
                    </button>
                  )}
                </div>
              </div>
              <div className={editMode ? 'space-y-2 overflow-x-auto' : 'space-y-3'}>
                {editMode && (
                  <div className="min-w-[720px] grid grid-cols-[minmax(180px,2fr)_90px_110px_minmax(140px,2fr)_110px_60px] gap-2 text-xs font-semibold text-gray-500">
                    <div>สินค้า</div>
                    <div className="text-center">จำนวน</div>
                    <div className="text-center">ราคา</div>
                    <div>หมายเหตุ</div>
                    <div className="text-right">รวม</div>
                    <div className="text-right">ลบ</div>
                  </div>
                )}
                {(editMode ? editItems : selectedOrder.items || []).map((item) => (
                  <div
                    key={item.id}
                    className="border-b pb-2 last:border-b-0"
                  >
                    {editMode ? (
                      <div className="min-w-[720px] grid grid-cols-[minmax(180px,2fr)_90px_110px_minmax(140px,2fr)_110px_60px] items-center gap-2">
                        <div className="text-sm font-medium text-gray-900">{item.product_name}</div>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.quantity}
                          onChange={(e) => handleEditItemChange(item.id, 'quantity', e.target.value)}
                          className="px-2 py-1 border rounded-lg text-sm text-right"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.requested_price}
                          onChange={(e) => handleEditItemChange(item.id, 'requested_price', e.target.value)}
                          className="px-2 py-1 border rounded-lg text-sm text-right"
                        />
                        <input
                          type="text"
                          value={item.notes || ''}
                          onChange={(e) => handleEditItemChange(item.id, 'notes', e.target.value)}
                          className="px-2 py-1 border rounded-lg text-sm"
                          placeholder="หมายเหตุ"
                        />
                        <div className="text-right font-semibold text-blue-600">
                          ฿{(Number(item.quantity || 0) * Number(item.requested_price || 0)).toFixed(2)}
                        </div>
                        <div className="text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveEditItem(item.id)}
                            className="text-sm text-red-500 hover:text-red-700"
                          >
                            ลบ
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1">
                          <p className="font-medium">{item.product_name}</p>
                          <p className="text-xs text-gray-500">
                            {item.quantity} {item.unit_abbr} × ฿{item.requested_price}
                          </p>
                          {item.notes && (
                            <p className="text-xs text-gray-400 mt-1">
                              หมายเหตุ: {item.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="font-semibold text-blue-600">
                            ฿{(Number(item.quantity || 0) * Number(item.requested_price || 0)).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t pt-3 mt-4 flex justify-between items-center">
                <span className="font-semibold">ยอดรวม</span>
                <span className="font-bold text-blue-600">
                  ฿{(editMode ? editTotal : Number(selectedOrder.total_amount || 0)).toFixed(2)}
                </span>
              </div>
            </div>
          )
        )}
      </Modal>

      <Modal
        isOpen={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        title="พิมพ์รายการสั่งซื้อ"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
            <input
              type="date"
              value={printDate}
              onChange={(e) => setPrintDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">รูปแบบพิมพ์</label>
            <div className="grid grid-cols-1 gap-2">
              {printOptions.map((option) => (
                <label key={option.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="printType"
                    value={option.id}
                    checked={printType === option.id}
                    onChange={() => setPrintType(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">ตัวเลือกเพิ่มเติม</label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={printSortByWalk}
                onChange={(e) => setPrintSortByWalk(e.target.checked)}
              />
              เรียงตามการเดินซื้อของ
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setPrintModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handlePrint} disabled={printLoading}>
              {printLoading ? 'กำลังเตรียม...' : 'พิมพ์'}
            </Button>
          </div>
        </div>
      </Modal>

      {printData && (
        <div className="hidden print:block p-2">
          <style>{`
            @page { margin: 6mm; }
            body { margin: 6mm; }
            .print-nowrap { white-space: nowrap; }
            .print-compact th, .print-compact td { padding-top: 2px; padding-bottom: 2px; }
            .print-grid { border-collapse: collapse; width: 100%; }
            .print-grid th, .print-grid td { border: 1px solid #bdbdbd; }
            .print-grid td { height: 16px; }
            .print-page-header { position: fixed; top: 0; left: 0; right: 0; text-align: center; font-size: 10px; color: #6b7280; }
            .print-page-spacer { height: 12px; }
          `}</style>
          <div className="print-page-header">
            วันที่ {new Date(printData.date).toLocaleDateString('th-TH')}
          </div>
          <div className="print-page-spacer" />
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold">สรุปรายการสั่งซื้อ</h1>
            <p className="text-sm text-gray-600">
              วันที่ {new Date(printData.date).toLocaleDateString('th-TH')}
            </p>
          </div>
          {printData.type === 'all'
            ? printData.sections.map((section) => (
                <div key={section.type} className="mb-8">
                  <h2 className="font-bold mb-3">{section.label}</h2>
                  {section.type === 'branch_supplier'
                    ? (() => {
                        const matrix = buildBranchSupplierMatrix(section.groups, printData.sortByWalk);
                        return (
                          <div style={{ columnCount: 2, columnGap: '16px' }}>
                            {matrix.suppliers.map((supplier) => (
                              <div
                                key={supplier.id}
                                className="mb-4"
                                style={{ breakInside: 'avoid' }}
                              >
                                <h3 className="font-semibold mb-2">{supplier.name}</h3>
                                <table className="w-full text-xs print-compact print-grid table-fixed">
                                  <thead>
                                    <tr>
                                      <th className="text-left py-0.5 pr-1 print-nowrap w-full">สินค้า</th>
                                      {matrix.branches.map((branch) => (
                                        <th
                                          key={branch.id}
                                          className="text-right py-0.5 px-0.5 whitespace-normal break-all text-[8px] leading-tight w-[28px] min-w-0"
                                        >
                                          {formatBranchHeader(branch.name).map((line, idx) => (
                                            <span key={idx} className="block">
                                              {line}
                                            </span>
                                          ))}
                                        </th>
                                      ))}
                                      <th className="text-right py-0.5 pl-1 print-nowrap w-[32px]">รวม</th>
                                      <th className="text-right py-0.5 pl-1 print-nowrap w-[36px]">ราคา</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {supplier.products.map((product) => (
                                      <tr key={product.product_id}>
                                        <td className="py-0.5 pr-1 print-nowrap w-full">
                                          {product.product_name}
                                          {product.unit_abbr ? ` (${product.unit_abbr})` : ''}
                                        </td>
                                        {matrix.branches.map((branch) => {
                                          const qty = Number(product.quantities[branch.id] || 0);
                                          return (
                                        <td
                                          key={branch.id}
                                          className="py-0.5 px-0.5 text-right w-[28px]"
                                        >
                                              {qty > 0 ? formatQuantity(qty) : ''}
                                            </td>
                                          );
                                        })}
                                        <td className="py-0.5 pl-1 text-right print-nowrap w-[32px]">
                                          {Number(product.total_quantity || 0) > 0
                                            ? formatQuantity(product.total_quantity)
                                            : ''}
                                        </td>
                                        <td className="py-0.5 pl-1 text-right print-nowrap w-[36px]" />
                                      </tr>
                                    ))}
                                    {Array.from({
                                      length: Math.max(0, 8 - supplier.products.length)
                                    }).map((_, fillerIndex) => (
                                      <tr key={`${supplier.id}-filler-${fillerIndex}`}>
                                        <td className="py-0.5 pr-1 print-nowrap w-full" />
                                        {matrix.branches.map((branch) => (
                                          <td
                                            key={`${branch.id}-filler-${fillerIndex}`}
                                            className="py-0.5 px-0.5 text-right w-[28px]"
                                          />
                                        ))}
                                        <td className="py-0.5 pl-1 text-right print-nowrap w-[32px]" />
                                        <td className="py-0.5 pl-1 text-right print-nowrap w-[36px]" />
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                          </div>
                        );
                      })()
                    : section.groups.map((group) => (
                        <div key={group.id} className="mb-6">
                          <h3 className="font-semibold mb-2">{group.name}</h3>
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-1">สินค้า</th>
                                <th className="text-right py-1">จำนวน</th>
                                <th className="text-right py-1">ราคา/หน่วย</th>
                                <th className="text-right py-1">รวม</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.products.map((product) => (
                                <tr key={product.product_id} className="border-b">
                                  <td className="py-1">
                                    {product.product_name}
                                  </td>
                                  <td className="py-1 text-right">
                                    {formatQuantity(product.total_quantity)} {product.unit_abbr}
                                  </td>
                                  <td className="py-1 text-right">
                                    {product.unit_price !== null
                                      ? Number(product.unit_price || 0).toFixed(2)
                                      : '-'}
                                  </td>
                                  <td className="py-1 text-right">
                                    {product.total_amount !== null
                                      ? Number(product.total_amount || 0).toFixed(2)
                                      : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                </div>
              ))
            : printData.type === 'branch_supplier'
              ? (() => {
                  const matrix = buildBranchSupplierMatrix(printData.groups, printData.sortByWalk);
                  return (
                    <div style={{ columnCount: 2, columnGap: '16px' }}>
                      {matrix.suppliers.map((supplier) => (
                        <div
                          key={supplier.id}
                          className="mb-4"
                          style={{ breakInside: 'avoid' }}
                        >
                          <h2 className="font-semibold mb-2">{supplier.name}</h2>
                          <table className="w-full text-xs print-compact print-grid table-fixed">
                            <thead>
                              <tr>
                                <th className="text-left py-0.5 pr-1 print-nowrap w-full">สินค้า</th>
                                {matrix.branches.map((branch) => (
                                  <th
                                    key={branch.id}
                                    className="text-right py-0.5 px-0.5 whitespace-normal break-all text-[8px] leading-tight w-[28px] min-w-0"
                                  >
                                    {formatBranchHeader(branch.name).map((line, idx) => (
                                      <span key={idx} className="block">
                                        {line}
                                      </span>
                                    ))}
                                  </th>
                                ))}
                                <th className="text-right py-0.5 pl-1 print-nowrap w-[32px]">รวม</th>
                                <th className="text-right py-0.5 pl-1 print-nowrap w-[36px]">ราคา</th>
                              </tr>
                            </thead>
                            <tbody>
                              {supplier.products.map((product) => (
                                <tr key={product.product_id}>
                                  <td className="py-0.5 pr-1 print-nowrap w-full">
                                    {product.product_name}
                                    {product.unit_abbr ? ` (${product.unit_abbr})` : ''}
                                  </td>
                                  {matrix.branches.map((branch) => {
                                    const qty = Number(product.quantities[branch.id] || 0);
                                    return (
                                      <td
                                        key={branch.id}
                                        className="py-0.5 px-0.5 text-right w-[28px]"
                                      >
                                        {qty > 0 ? formatQuantity(qty) : ''}
                                      </td>
                                    );
                                  })}
                                  <td className="py-0.5 pl-1 text-right print-nowrap w-[32px]">
                                  {Number(product.total_quantity || 0) > 0
                                    ? formatQuantity(product.total_quantity)
                                    : ''}
                                  </td>
                                  <td className="py-0.5 pl-1 text-right print-nowrap w-[36px]" />
                                </tr>
                              ))}
                              {Array.from({
                                length: Math.max(0, 8 - supplier.products.length)
                              }).map((_, fillerIndex) => (
                                <tr key={`${supplier.id}-filler-${fillerIndex}`}>
                                  <td className="py-0.5 pr-1 print-nowrap w-full" />
                                  {matrix.branches.map((branch) => (
                                    <td
                                      key={`${branch.id}-filler-${fillerIndex}`}
                                      className="py-0.5 px-0.5 text-right w-[28px]"
                                    />
                                  ))}
                                  <td className="py-0.5 pl-1 text-right print-nowrap w-[32px]" />
                                  <td className="py-0.5 pl-1 text-right print-nowrap w-[36px]" />
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  );
                })()
              : printData.groups.map((group) => (
                  <div key={group.id} className="mb-6">
                    <h2 className="font-semibold mb-2">{group.name}</h2>
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1">สินค้า</th>
                          <th className="text-right py-1">จำนวน</th>
                          <th className="text-right py-1">ราคา/หน่วย</th>
                          <th className="text-right py-1">รวม</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.products.map((product) => (
                          <tr key={product.product_id} className="border-b">
                            <td className="py-1">
                              {product.product_name}
                            </td>
                            <td className="py-1 text-right">
                              {formatQuantity(product.total_quantity)} {product.unit_abbr}
                            </td>
                            <td className="py-1 text-right">
                              {product.unit_price !== null
                                ? Number(product.unit_price || 0).toFixed(2)
                                : '-'}
                            </td>
                            <td className="py-1 text-right">
                              {product.total_amount !== null
                                ? Number(product.total_amount || 0).toFixed(2)
                                : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
        </div>
      )}
    </Layout>
  );
};
