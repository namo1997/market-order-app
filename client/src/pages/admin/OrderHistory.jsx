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
  });

  return Array.from(map.values()).map((product) => ({
    ...product,
    total_amount:
      product.unit_price !== null
        ? Number(product.total_quantity || 0) * Number(product.unit_price || 0)
        : null
  }));
};

const groupItems = (items, type) => {
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

  return Array.from(groups.values()).map((group) => ({
    ...group,
    products: aggregateProducts(group.items)
  }));
};

const groupSuppliers = (items) => {
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
      const totalAmount = products.reduce(
        (sum, product) => sum + Number(product.total_amount || 0),
        0
      );
      return {
        id: supplier.id,
        name: supplier.name,
        products,
        total_amount: totalAmount
      };
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
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
  const [printData, setPrintData] = useState(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const printOptions = [
    { id: 'all', label: 'ทุกรูปแบบ' },
    { id: 'department', label: 'ตามแผนก' },
    { id: 'branch', label: 'ตามสาขา' },
    { id: 'supplier', label: 'ตามซัพพลายเออร์' }
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
        const sections = ['department', 'branch', 'supplier'].map((type) => ({
          type,
          label: printOptions.find((opt) => opt.id === type)?.label || type,
          groups: groupItems(items, type)
        }));
        setPrintData({
          date: printDate,
          type: printType,
          sections
        });
      } else {
        const grouped = groupItems(items, printType);
        setPrintData({
          date: printDate,
          type: printType,
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
      const response = await ordersAPI.getOrderById(orderId);
      setSelectedOrder(response.data);
    } catch (error) {
      console.error('Error fetching order detail:', error);
      alert('ไม่สามารถโหลดรายละเอียดคำสั่งซื้อได้');
    } finally {
      setDetailLoading(false);
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
            <div className="flex flex-wrap gap-2">
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
                    <p className="font-semibold text-gray-900">{order.order_number}</p>
                    <p className="text-sm text-gray-600">
                      {order.user_name} • {order.branch_name} • {order.department_name}
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
              <div className="mb-4">
                <p className="font-semibold text-gray-900">
                  {selectedOrder.order_number}
                </p>
                <p className="text-sm text-gray-500">
                  {selectedOrder.user_name} • {selectedOrder.branch_name} • {selectedOrder.department_name}
                  {formatOrderTime(selectedOrder.submitted_at || selectedOrder.created_at || selectedOrder.order_date)
                    ? ` • เวลา ${formatOrderTime(selectedOrder.submitted_at || selectedOrder.created_at || selectedOrder.order_date)}`
                    : ''}
                </p>
              </div>
              <div className="space-y-3">
                {(selectedOrder.items || []).map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between items-start border-b pb-2 last:border-b-0"
                  >
                    <div>
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
                    <div className="font-semibold text-blue-600">
                      ฿{(item.quantity * item.requested_price).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t pt-3 mt-4 flex justify-between items-center">
                <span className="font-semibold">ยอดรวม</span>
                <span className="font-bold text-blue-600">
                  ฿{Number(selectedOrder.total_amount || 0).toFixed(2)}
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
        <div className="hidden print:block p-4">
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
                  {section.groups.map((group) => (
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
                                {product.total_quantity} {product.unit_abbr}
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
                            {product.total_quantity} {product.unit_abbr}
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
