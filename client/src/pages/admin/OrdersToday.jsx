import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../api/admin';
import { ordersAPI } from '../../api/orders';
import { masterAPI } from '../../api/master';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';

export const OrdersToday = () => {
  const navigate = useNavigate();
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
  const [deletingOrderId, setDeletingOrderId] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [moveBranchId, setMoveBranchId] = useState('');
  const [moveDepartmentId, setMoveDepartmentId] = useState('');
  const [movingOrder, setMovingOrder] = useState(false);

  useEffect(() => {
    fetchOrders();
  }, [selectedDate]);

  useEffect(() => {
    fetchMasterData();
  }, []);

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

  useEffect(() => {
    if (!selectedOrder || departments.length === 0) return;
    const departmentId = selectedOrder.department_id
      ? String(selectedOrder.department_id)
      : '';
    const dept = departments.find((item) => String(item.id) === departmentId);
    setMoveDepartmentId(departmentId);
    setMoveBranchId(dept ? String(dept.branch_id) : '');
  }, [selectedOrder, departments]);

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

  const fetchMasterData = async () => {
    try {
      const [branchData, departmentData] = await Promise.all([
        masterAPI.getBranches(),
        masterAPI.getDepartments()
      ]);
      setBranches(Array.isArray(branchData) ? branchData : []);
      setDepartments(Array.isArray(departmentData) ? departmentData : []);
    } catch (error) {
      console.error('Error fetching master data:', error);
      setBranches([]);
      setDepartments([]);
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
      const order = response.data;
      setSelectedOrder(order);
      setEditMode(false);
      setEditItems(
        (order?.items || []).map((item) => ({
          id: item.id,
          product_id: item.product_id,
          product_name: item.product_name,
          unit_abbr: item.unit_abbr,
          unit_name: item.unit_name,
          quantity: item.quantity,
          requested_price: item.requested_price,
          notes: item.notes || item.note || ''
        }))
      );
    } catch (error) {
      console.error('Error fetching order detail:', error);
      alert('ไม่สามารถโหลดรายละเอียดคำสั่งซื้อได้');
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
      fetchOrders();
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
        notes: item.notes || item.note || ''
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

  const handleDeleteOrder = async (orderId) => {
    const confirmed = window.confirm('ลบคำสั่งซื้อนี้ออกทั้งหมด?');
    if (!confirmed) return;

    try {
      setDeletingOrderId(orderId);
      await ordersAPI.deleteOrder(orderId);
      alert('ลบคำสั่งซื้อแล้ว');
      setSelectedOrder(null);
      fetchOrders();
    } catch (error) {
      console.error('Error deleting order:', error);
      alert(error.response?.data?.message || 'ลบคำสั่งซื้อไม่สำเร็จ');
    } finally {
      setDeletingOrderId(null);
    }
  };

  const handleMoveBranchChange = (value) => {
    setMoveBranchId(value);
    const nextDept = departments.find(
      (dept) => String(dept.branch_id) === String(value)
    );
    setMoveDepartmentId(nextDept ? String(nextDept.id) : '');
  };

  const handleTransferOrder = async () => {
    if (!selectedOrder) return;
    if (!moveDepartmentId) {
      alert('กรุณาเลือกแผนกที่ต้องการย้าย');
      return;
    }

    if (String(moveDepartmentId) === String(selectedOrder.department_id)) {
      alert('เลือกแผนกใหม่ที่ต่างจากเดิม');
      return;
    }

    const targetDept = departments.find(
      (dept) => String(dept.id) === String(moveDepartmentId)
    );
    const targetBranch = branches.find(
      (branch) => String(branch.id) === String(targetDept?.branch_id)
    );
    const label = `${targetBranch?.name || 'ไม่ระบุสาขา'} • ${targetDept?.name || 'ไม่ระบุแผนก'}`;
    const confirmed = window.confirm(`ย้ายคำสั่งซื้อไปยัง ${label} ใช่หรือไม่?`);
    if (!confirmed) return;

    try {
      setMovingOrder(true);
      await adminAPI.transferOrder(selectedOrder.id, {
        department_id: moveDepartmentId
      });
      alert('ย้ายคำสั่งซื้อแล้ว');
      await openOrderDetail(selectedOrder.id);
      fetchOrders();
    } catch (error) {
      console.error('Error transferring order:', error);
      alert(error.response?.data?.message || 'ย้ายคำสั่งซื้อไม่สำเร็จ');
    } finally {
      setMovingOrder(false);
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

  const availableDepartments = useMemo(() => {
    if (!moveBranchId) return [];
    return departments.filter(
      (dept) => String(dept.branch_id) === String(moveBranchId)
    );
  }, [departments, moveBranchId]);

  const totalAmount = orders.reduce(
    (sum, order) => sum + Number(order.total_amount || 0),
    0
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOpen = orderStatus?.is_open;
  const canDeleteOrder = (order) => {
    if (!order) return false;
    const isOrderOpen = order.is_open === true || order.is_open === 1 || order.is_open === '1';
    return ['draft', 'submitted'].includes(order.status) && isOrderOpen;
  };
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
                disabled={closing}
              >
                {closing ? 'กำลังเปิด...' : 'เปิดรับออเดอร์'}
              </Button>
            )}
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
                          {formatOrderTime(order.submitted_at || order.created_at || order.order_date)
                            ? ` • เวลา ${formatOrderTime(order.submitted_at || order.created_at || order.order_date)}`
                            : ''}
                          {order.item_count !== undefined && order.item_count !== null
                            ? ` • รวม ${order.item_count} รายการ`
                            : ''}
                        </p>
                        {order.transferred_at && (
                          <p className="mt-1 text-xs font-semibold text-amber-700">
                            ถูกย้ายจาก {order.transferred_from_branch_name || 'ไม่ระบุสาขา'} •{' '}
                            {order.transferred_from_department_name || 'ไม่ระบุแผนก'}
                          </p>
                        )}
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
            <div className="mb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-900">
                  {selectedOrder.order_number}
                </p>
                <p className="text-sm text-gray-500">
                  {selectedOrder.user_name} • {selectedOrder.branch_name} • {selectedOrder.department_name}
                </p>
                {selectedOrder.transferred_at && (
                  <p className="mt-1 text-xs font-semibold text-amber-700">
                    ถูกย้ายจาก {selectedOrder.transferred_from_branch_name || 'ไม่ระบุสาขา'} •{' '}
                    {selectedOrder.transferred_from_department_name || 'ไม่ระบุแผนก'}
                  </p>
                )}
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      ย้ายไปสาขา
                    </label>
                    <select
                      value={moveBranchId}
                      onChange={(e) => handleMoveBranchChange(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">เลือกสาขา</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      ย้ายไปแผนก
                    </label>
                    <select
                      value={moveDepartmentId}
                      onChange={(e) => setMoveDepartmentId(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={!moveBranchId}
                    >
                      <option value="">เลือกแผนก</option>
                      {availableDepartments.map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleTransferOrder}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300"
                      disabled={!moveDepartmentId || movingOrder}
                    >
                      {movingOrder ? 'กำลังย้าย...' : 'ย้ายคำสั่งซื้อ'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
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
                {canDeleteOrder(selectedOrder) && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDeleteOrder(selectedOrder.id)}
                    disabled={deletingOrderId === selectedOrder.id}
                  >
                    {deletingOrderId === selectedOrder.id ? 'กำลังลบ...' : 'ลบคำสั่งซื้อ'}
                  </Button>
                )}
              </div>
            </div>
            <div className={editMode ? 'space-y-2 overflow-x-auto' : 'space-y-3'}>
              {editMode && (
                <div className="min-w-[640px] grid grid-cols-[minmax(160px,2fr)_90px_minmax(140px,2fr)_110px_60px] gap-2 text-xs font-semibold text-gray-500">
                  <div>สินค้า</div>
                  <div className="text-center">จำนวน</div>
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
                    <div className="min-w-[640px] grid grid-cols-[minmax(160px,2fr)_90px_minmax(140px,2fr)_110px_60px] items-center gap-2">
                      <div className="text-sm font-medium text-gray-900">{item.product_name}</div>
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.quantity}
                          onChange={(e) =>
                            handleEditItemChange(item.id, 'quantity', e.target.value)
                          }
                          className="w-full px-2 py-1 border rounded-lg text-sm text-right"
                        />
                        {item.unit_abbr && (
                          <span className="text-xs text-gray-500">{item.unit_abbr}</span>
                        )}
                      </div>
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
                        {(item.notes || item.note) && (
                          <p className="text-xs text-gray-400 mt-1">
                            หมายเหตุ: {item.notes || item.note}
                          </p>
                        )}
                      </div>
                      <div className="font-semibold text-blue-600">
                        ฿{(Number(item.quantity || 0) * Number(item.requested_price || 0)).toFixed(2)}
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
        )}
      </Modal>
    </Layout>
  );
};
