import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../api/admin';
import { ordersAPI } from '../../api/orders';
import { useAuth } from '../../contexts/AuthContext';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';

export const OrdersToday = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderStatus, setOrderStatus] = useState(null);
  const [view, setView] = useState('orders');
  const [orderItems, setOrderItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsDate, setItemsDate] = useState('');
  const [resettingOrderId, setResettingOrderId] = useState(null);
  const [resettingAllOrders, setResettingAllOrders] = useState(false);

  useEffect(() => {
    fetchOrders();
  }, [selectedDate]);

  useEffect(() => {
    setSelectedOrder(null);
  }, [view]);

  useEffect(() => {
    setOrderItems([]);
    setItemsDate('');
  }, [selectedDate]);

  useEffect(() => {
    if (view === 'product' || view === 'supplier') {
      ensureOrderItems();
    }
  }, [view, selectedDate]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const [ordersRes, statusRes] = await Promise.all([
        adminAPI.getAllOrders({
          date: selectedDate,
          status: 'submitted'
        }),
        ordersAPI.getOrderStatus(selectedDate)
      ]);
      setOrders(Array.isArray(ordersRes.data) ? ordersRes.data : []);
      setOrderStatus(statusRes.data || null);
    } catch (error) {
      console.error('Error fetching orders:', error);
      setOrders([]);
      setOrderStatus(null);
    } finally {
      setLoading(false);
    }
  };

  const ensureOrderItems = async () => {
    if (itemsLoading) return;
    if (itemsDate === selectedDate) return;

    try {
      setItemsLoading(true);
      const response = await adminAPI.getOrderItems(selectedDate, ['submitted']);
      setOrderItems(Array.isArray(response.data) ? response.data : []);
      setItemsDate(selectedDate);
    } catch (error) {
      console.error('Error fetching order items:', error);
      setOrderItems([]);
    } finally {
      setItemsLoading(false);
    }
  };

  const openOrderDetail = async (orderId) => {
    try {
      const response = await ordersAPI.getOrderById(orderId);
      setSelectedOrder(response.data);
    } catch (error) {
      console.error('Error fetching order detail:', error);
      alert('ไม่สามารถโหลดรายละเอียดคำสั่งซื้อได้');
    }
  };

  const handleCloseOrders = async () => {
    const confirmed = window.confirm('ยืนยันปิดรับคำสั่งซื้อของวันนี้?');
    if (!confirmed) return;

    try {
      setClosing(true);
      await adminAPI.closeOrders(selectedDate);
      alert('ปิดรับคำสั่งซื้อแล้ว');
      navigate(`/admin/history?date=${selectedDate}`);
    } catch (error) {
      console.error('Error closing orders:', error);
      alert(error.response?.data?.message || 'เกิดข้อผิดพลาดในการปิดรับคำสั่งซื้อ');
    } finally {
      setClosing(false);
    }
  };

  const handleOpenOrders = async () => {
    if (!canOpenSelectedDate) {
      alert('เปิดรับคำสั่งซื้อได้เฉพาะวันนี้ถึง 7 วันล่วงหน้า');
      return;
    }

    try {
      setClosing(true);
      await adminAPI.openOrders(selectedDate);
      alert('เปิดรับคำสั่งซื้อแล้ว');
      fetchOrders();
    } catch (error) {
      console.error('Error opening orders:', error);
      alert(error.response?.data?.message || 'เกิดข้อผิดพลาดในการเปิดรับคำสั่งซื้อ');
    } finally {
      setClosing(false);
    }
  };

  const handleResetDay = async () => {
    const confirmed = window.confirm(
      'รีเซ็ตวันสั่งซื้อเพื่อทดสอบ?\nคำสั่งซื้อจะกลับไปสถานะส่งแล้ว และล้างข้อมูลการซื้อจริง'
    );
    if (!confirmed) return;

    try {
      setClosing(true);
      await adminAPI.resetOrderDay(selectedDate);
      alert('รีเซ็ตสำเร็จ');
      fetchOrders();
    } catch (error) {
      console.error('Error resetting order day:', error);
      alert(error.response?.data?.message || 'เกิดข้อผิดพลาดในการรีเซ็ต');
    } finally {
      setClosing(false);
    }
  };

  const handleResetOrder = async (orderId) => {
    const confirmed = window.confirm(
      'รีเซ็ตคำสั่งซื้อนี้?\nสถานะจะกลับเป็นร่าง และล้างข้อมูลการซื้อจริง'
    );
    if (!confirmed) return;

    try {
      setResettingOrderId(orderId);
      await adminAPI.resetOrder(orderId);
      alert('รีเซ็ตคำสั่งซื้อแล้ว');
      setSelectedOrder(null);
      fetchOrders();
    } catch (error) {
      console.error('Error resetting order:', error);
      alert(error.response?.data?.message || 'เกิดข้อผิดพลาดในการรีเซ็ตคำสั่งซื้อ');
    } finally {
      setResettingOrderId(null);
    }
  };

  const handleResetAllOrders = async () => {
    const confirmed = window.confirm(
      'ลบคำสั่งซื้อทั้งหมดทุกวัน ทุกสาขา?\nการกระทำนี้ลบประวัติทั้งหมด และย้อนกลับไม่ได้'
    );
    if (!confirmed) return;

    const finalConfirm = window.confirm('ยืนยันอีกครั้งว่าต้องการลบคำสั่งซื้อทั้งหมดจริงๆ');
    if (!finalConfirm) return;

    try {
      setResettingAllOrders(true);
      await adminAPI.resetAllOrders();
      alert('ลบคำสั่งซื้อทั้งหมดแล้ว');
      setSelectedOrder(null);
      fetchOrders();
    } catch (error) {
      console.error('Error resetting all orders:', error);
      alert(error.response?.data?.message || 'เกิดข้อผิดพลาดในการลบคำสั่งซื้อทั้งหมด');
    } finally {
      setResettingAllOrders(false);
    }
  };

  const branchSummaries = useMemo(() => {
    const map = new Map();

    orders.forEach((order) => {
      const id = order.branch_id ?? order.branch_name ?? 'unknown';
      const name = order.branch_name || 'ไม่ระบุสาขา';
      const amount = Number(order.total_amount || 0);

      if (!map.has(id)) {
        map.set(id, {
          id,
          name,
          order_count: 0,
          total_amount: 0,
          departments: new Set()
        });
      }

      const entry = map.get(id);
      entry.order_count += 1;
      entry.total_amount += amount;
      if (order.department_name) {
        entry.departments.add(order.department_name);
      }
    });

    return Array.from(map.values())
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        order_count: entry.order_count,
        total_amount: entry.total_amount,
        department_count: entry.departments.size
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [orders]);

  const departmentSummaries = useMemo(() => {
    const map = new Map();

    orders.forEach((order) => {
      const id =
        order.department_id ??
        `${order.branch_name || 'unknown'}-${order.department_name || 'unknown'}`;
      const name = order.department_name || 'ไม่ระบุแผนก';
      const branchName = order.branch_name || 'ไม่ระบุสาขา';
      const amount = Number(order.total_amount || 0);

      if (!map.has(id)) {
        map.set(id, {
          id,
          name,
          branch_name: branchName,
          order_count: 0,
          total_amount: 0
        });
      }

      const entry = map.get(id);
      entry.order_count += 1;
      entry.total_amount += amount;
    });

    return Array.from(map.values()).sort((a, b) => {
      const branchCompare = a.branch_name.localeCompare(b.branch_name, 'th');
      if (branchCompare !== 0) return branchCompare;
      return a.name.localeCompare(b.name, 'th');
    });
  }, [orders]);

  const productSummaries = useMemo(() => {
    const map = new Map();

    orderItems.forEach((item) => {
      const id = item.product_id ?? item.product_name;
      if (!id) return;

      const name = item.product_name || 'ไม่ระบุสินค้า';
      const supplierName = item.supplier_name || 'ไม่ระบุซัพพลายเออร์';
      const unitAbbr = item.unit_abbr || '';
      const quantity = Number(item.quantity || 0);
      const price = Number(item.requested_price || 0);
      const lineAmount = quantity * price;

      if (!map.has(id)) {
        map.set(id, {
          id,
          product_name: name,
          supplier_name: supplierName,
          unit_abbr: unitAbbr,
          total_quantity: 0,
          total_amount: 0
        });
      }

      const entry = map.get(id);
      entry.total_quantity += quantity;
      entry.total_amount += lineAmount;
    });

    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        avg_price:
          entry.total_quantity > 0 ? entry.total_amount / entry.total_quantity : 0
      }))
      .sort((a, b) => {
        const supplierCompare = a.supplier_name.localeCompare(b.supplier_name, 'th');
        if (supplierCompare !== 0) return supplierCompare;
        return a.product_name.localeCompare(b.product_name, 'th');
      });
  }, [orderItems]);

  const supplierSummaries = useMemo(() => {
    const map = new Map();

    orderItems.forEach((item) => {
      const supplierId = item.supplier_id ?? 0;
      const supplierName = item.supplier_name || 'ไม่ระบุซัพพลายเออร์';
      const quantity = Number(item.quantity || 0);
      const price = Number(item.requested_price || 0);
      const lineAmount = quantity * price;

      if (!map.has(supplierId)) {
        map.set(supplierId, {
          id: supplierId,
          name: supplierName,
          total_amount: 0,
          total_quantity: 0,
          products: new Map()
        });
      }

      const supplier = map.get(supplierId);
      supplier.total_amount += lineAmount;
      supplier.total_quantity += quantity;

      const productId = item.product_id ?? item.product_name;
      if (!productId) return;

      if (!supplier.products.has(productId)) {
        supplier.products.set(productId, {
          product_id: item.product_id,
          product_name: item.product_name || 'ไม่ระบุสินค้า',
          unit_abbr: item.unit_abbr || '',
          total_quantity: 0,
          total_amount: 0
        });
      }

      const product = supplier.products.get(productId);
      product.total_quantity += quantity;
      product.total_amount += lineAmount;
    });

    return Array.from(map.values())
      .map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        total_amount: supplier.total_amount,
        total_quantity: supplier.total_quantity,
        products: Array.from(supplier.products.values())
          .map((product) => ({
            ...product,
            avg_price:
              product.total_quantity > 0
                ? product.total_amount / product.total_quantity
                : 0
          }))
          .sort((a, b) => a.product_name.localeCompare(b.product_name, 'th'))
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [orderItems]);

  const totalAmount = orders.reduce(
    (sum, order) => sum + Number(order.total_amount || 0),
    0
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selectedDateObj = new Date(`${selectedDate}T00:00:00`);
  const diffDays = Math.floor((selectedDateObj - today) / (1000 * 60 * 60 * 24));
  const canOpenSelectedDate = diffDays >= 0 && diffDays <= 7;
  const isOpen = orderStatus?.is_open;
  const showReset = user?.role === 'admin' && user?.branch === 'สาขาส่วนกลาง';

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  const viewOptions = [
    { id: 'orders', label: 'รายการคำสั่งซื้อ' },
    { id: 'product', label: 'รวมสินค้า' },
    { id: 'department', label: 'รวมแผนก' },
    { id: 'branch', label: 'รวมสาขา' },
    { id: 'supplier', label: 'รวมซัพพลายเออร์' }
  ];

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">คำสั่งซื้อวันนี้</h1>
            <p className="text-sm text-gray-500">เฉพาะคำสั่งซื้อที่ส่งแล้ว</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button
              onClick={handleResetAllOrders}
              variant="danger"
              disabled={resettingAllOrders}
            >
              {resettingAllOrders ? 'กำลังลบทั้งหมด...' : 'ลบคำสั่งซื้อทั้งหมด'}
            </Button>
            {showReset && (
              <Button
                onClick={handleResetDay}
                variant="secondary"
                disabled={closing}
              >
                รีเซ็ต (ทดสอบ)
              </Button>
            )}
            {isOpen ? (
              <Button
                onClick={handleCloseOrders}
                variant="danger"
                disabled={closing}
              >
                {closing ? 'กำลังปิด...' : 'ปิดรับออเดอร์'}
              </Button>
            ) : (
              <Button
                onClick={handleOpenOrders}
                variant="success"
                disabled={closing || !canOpenSelectedDate}
              >
                {closing ? 'กำลังเปิด...' : 'เปิดรับออเดอร์'}
              </Button>
            )}
          </div>
        </div>

        {!isOpen && !canOpenSelectedDate && (
          <div className="text-sm text-orange-600 mb-4">
            เปิดรับได้เฉพาะวันนี้ถึง 7 วันล่วงหน้า
          </div>
        )}

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

        <div className="flex flex-wrap gap-2 mb-4">
          {viewOptions.map((option) => {
            const isActive = view === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                  isActive
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {view === 'orders' && (
          <>
            {orders.length === 0 ? (
              <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
                ยังไม่มีคำสั่งซื้อที่ส่งมา
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
          </>
        )}

        {view === 'product' && (
          <>
            {itemsLoading ? (
              <Loading />
            ) : productSummaries.length === 0 ? (
              <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
                ยังไม่มีรายการสินค้า
              </div>
            ) : (
              <div className="space-y-3">
                {productSummaries.map((product) => (
                  <Card key={product.id} className="hover:shadow-sm transition-shadow">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900">{product.product_name}</p>
                        <p className="text-sm text-gray-600">{product.supplier_name}</p>
                      </div>
                      <div className="text-sm text-gray-600">
                        {product.total_quantity.toFixed(2)} {product.unit_abbr}
                      </div>
                      <div className="text-sm text-gray-600">
                        ราคาเฉลี่ย ฿{product.avg_price.toFixed(2)}
                      </div>
                      <div className="font-semibold text-blue-600">
                        ฿{product.total_amount.toFixed(2)}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {view === 'department' && (
          <>
            {departmentSummaries.length === 0 ? (
              <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
                ยังไม่มีคำสั่งซื้อที่ส่งมา
              </div>
            ) : (
              <div className="space-y-3">
                {departmentSummaries.map((dept) => (
                  <Card key={dept.id} className="hover:shadow-sm transition-shadow">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">{dept.name}</p>
                        <p className="text-sm text-gray-600">{dept.branch_name}</p>
                      </div>
                      <div className="text-sm text-gray-600">
                        {dept.order_count} คำสั่งซื้อ
                      </div>
                      <div className="font-semibold text-blue-600">
                        ฿{dept.total_amount.toFixed(2)}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {view === 'branch' && (
          <>
            {branchSummaries.length === 0 ? (
              <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
                ยังไม่มีคำสั่งซื้อที่ส่งมา
              </div>
            ) : (
              <div className="space-y-3">
                {branchSummaries.map((branch) => (
                  <Card key={branch.id} className="hover:shadow-sm transition-shadow">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">{branch.name}</p>
                        <p className="text-sm text-gray-600">
                          {branch.department_count} แผนก
                        </p>
                      </div>
                      <div className="text-sm text-gray-600">
                        {branch.order_count} คำสั่งซื้อ
                      </div>
                      <div className="font-semibold text-blue-600">
                        ฿{branch.total_amount.toFixed(2)}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {view === 'supplier' && (
          <>
            {itemsLoading ? (
              <Loading />
            ) : supplierSummaries.length === 0 ? (
              <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
                ยังไม่มีรายการซัพพลายเออร์
              </div>
            ) : (
              <div className="space-y-4">
                {supplierSummaries.map((supplier) => (
                  <Card key={supplier.id} className="bg-white">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">{supplier.name}</p>
                        <p className="text-sm text-gray-600">
                          รวม {supplier.total_quantity.toFixed(2)} รายการ
                        </p>
                      </div>
                      <div className="font-semibold text-blue-600">
                        ฿{supplier.total_amount.toFixed(2)}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {supplier.products.map((product) => (
                        <div
                          key={product.product_id || product.product_name}
                          className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border-t pt-2"
                        >
                          <div className="text-sm font-medium text-gray-900">
                            {product.product_name}
                          </div>
                          <div className="text-sm text-gray-600">
                            {product.total_quantity.toFixed(2)} {product.unit_abbr}
                          </div>
                          <div className="text-sm text-gray-600">
                            ราคาเฉลี่ย ฿{product.avg_price.toFixed(2)}
                          </div>
                          <div className="text-sm font-semibold text-blue-600">
                            ฿{product.total_amount.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={view === 'orders' && Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        title="รายละเอียดคำสั่งซื้อ"
        size="large"
      >
        {selectedOrder && (
          <div>
            <div className="mb-4">
              <p className="font-semibold text-gray-900">
                {selectedOrder.order_number}
              </p>
              <p className="text-sm text-gray-500">
                {selectedOrder.user_name} • {selectedOrder.branch_name} • {selectedOrder.department_name}
              </p>
              <div className="mt-3">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleResetOrder(selectedOrder.id)}
                  disabled={resettingOrderId === selectedOrder.id}
                >
                  {resettingOrderId === selectedOrder.id ? 'กำลังรีเซ็ต...' : 'รีเซ็ตคำสั่งซื้อ'}
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {selectedOrder.items.map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between items-start border-b pb-2 last:border-b-0"
                >
                  <div>
                    <p className="font-medium">{item.product_name}</p>
                    <p className="text-xs text-gray-500">
                      {item.quantity} {item.unit_abbr} × ฿{item.requested_price}
                    </p>
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
        )}
      </Modal>
    </Layout>
  );
};
