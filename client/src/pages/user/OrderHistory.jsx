import { useState, useEffect } from 'react';
import { ordersAPI } from '../../api/orders';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Loading } from '../../components/common/Loading';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';

export const OrderHistory = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const pageStyle = {
    fontFamily: '"Sarabun", "Noto Sans Thai", "Noto Sans", sans-serif'
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const response = await ordersAPI.getMyOrders();
      setOrders(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrderDetails = async (orderId) => {
    try {
      const response = await ordersAPI.getOrderById(orderId);
      setSelectedOrder(response.data);
      setIsEditing(false);
      setEditItems(
        (response.data?.items || []).map((item) => ({
          ...item,
          quantity: Number(item.quantity || 0),
          requested_price: Number(item.requested_price || 0)
        }))
      );
    } catch (error) {
      console.error('Error fetching order details:', error);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      draft: 'bg-gray-200 text-gray-700',
      submitted: 'bg-blue-200 text-blue-700',
      confirmed: 'bg-green-200 text-green-700',
      completed: 'bg-green-600 text-white',
      cancelled: 'bg-red-200 text-red-700'
    };

    const labels = {
      draft: 'รอดำเนินการ',
      submitted: 'ส่งแล้ว - รอไปซื้อ',
      confirmed: 'กำลังจัดซื้อ',
      completed: 'ซื้อเรียบร้อย',
      cancelled: 'ยกเลิก'
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${badges[status]}`}>
        {labels[status]}
      </span>
    );
  };

  const canEdit = (order) => {
    if (!order) return false;
    const editableStatus = ['draft', 'submitted'];
    return editableStatus.includes(order.status) && Boolean(order.is_open);
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

  const handleCancelEdit = () => {
    if (!selectedOrder) return;
    setEditItems(
      (selectedOrder.items || []).map((item) => ({
        ...item,
        quantity: Number(item.quantity || 0),
        requested_price: Number(item.requested_price || 0)
      }))
    );
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedOrder) return;

    const itemsPayload = editItems
      .map((item) => ({
        product_id: item.product_id,
        quantity: Number(item.quantity || 0),
        requested_price: Number(item.requested_price || 0),
        notes: item.notes ?? ''
      }))
      .filter((item) => item.quantity > 0);

    if (itemsPayload.length === 0) {
      alert('ต้องมีอย่างน้อย 1 รายการสินค้า');
      return;
    }

    try {
      setSaving(true);
      await ordersAPI.updateOrder(selectedOrder.id, itemsPayload);
      await fetchOrders();
      const refreshed = await ordersAPI.getOrderById(selectedOrder.id);
      setSelectedOrder(refreshed.data);
      setEditItems(
        (refreshed.data?.items || []).map((item) => ({
          ...item,
          quantity: Number(item.quantity || 0),
          requested_price: Number(item.requested_price || 0)
        }))
      );
      setIsEditing(false);
      alert('แก้ไขคำสั่งซื้อสำเร็จ');
    } catch (error) {
      console.error('Error updating order:', error);
      alert(error.response?.data?.message || 'ไม่สามารถแก้ไขคำสั่งซื้อได้');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOrder = async () => {
    if (!selectedOrder) return;
    const confirmed = window.confirm(
      'ลบคำสั่งซื้อทั้งรายการ?\nรายการสินค้าในคำสั่งซื้อนี้จะถูกลบทั้งหมด'
    );
    if (!confirmed) return;

    try {
      setDeleting(true);
      await ordersAPI.deleteOrder(selectedOrder.id);
      await fetchOrders();
      setSelectedOrder(null);
      setIsEditing(false);
      alert('ลบคำสั่งซื้อเรียบร้อย');
    } catch (error) {
      console.error('Error deleting order:', error);
      alert(error.response?.data?.message || 'ลบคำสั่งซื้อไม่สำเร็จ');
    } finally {
      setDeleting(false);
    }
  };

  const formatOrderDate = (value) => {
    const dateValue = value ? new Date(value) : new Date();
    if (Number.isNaN(dateValue.getTime())) {
      return { dateText: '-', timeText: '' };
    }
    return {
      dateText: dateValue.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      timeText: dateValue.toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit'
      })
    };
  };

  const getOrderDateKey = (value) => {
    if (!value) return '';
    return String(value).split('T')[0];
  };

  const filteredOrders = filterDate
    ? orders.filter((order) => getOrderDateKey(order?.order_date) === filterDate)
    : orders;
  const emptyMessage = filterDate
    ? 'ยังไม่มีคำสั่งซื้อในวันที่เลือก'
    : 'ยังไม่มีคำสั่งซื้อ';

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#F5F5F7]" style={pageStyle}>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center animate-fade-in">
            <Loading />
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-[#F5F5F7]" style={pageStyle}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 animate-fade-slide-up">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Orders
              </p>
              <h1 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight">
                การสั่งซื้อของฉัน
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                แสดง {filteredOrders.length} รายการ
              </p>
            </div>
            <div className="flex flex-col sm:items-end gap-2">
              <div className="w-full sm:w-72 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  วันที่ที่แสดง
                </label>
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="mt-1 w-full bg-transparent text-base font-semibold text-slate-900 focus:outline-none"
                />
              </div>
              {filterDate && (
                <button
                  type="button"
                  onClick={() => setFilterDate('')}
                  className="text-sm font-semibold text-blue-600"
                >
                  แสดงทั้งหมด
                </button>
              )}
            </div>
          </div>

          {(!filteredOrders || filteredOrders.length === 0) ? (
            <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 animate-fade-in">
              <p className="mb-4">{emptyMessage}</p>
              <button
                onClick={() => window.location.href = '/'}
                className="rounded-2xl bg-blue-600 px-6 py-3 text-white text-base font-semibold shadow-sm transition hover:bg-blue-700"
              >
                เลือกสินค้า
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {filteredOrders.map((order, index) => {
                if (!order) return null;
                const total = Number(order.total_amount || 0);
                const isLocked = !canEdit(order);
                const { dateText, timeText } = formatOrderDate(order.order_date);
                const orderNumber = order.order_number || `Order #${order.id}`;

                return (
                  <div
                    key={order.id}
                    className="animate-fade-slide-up"
                    style={{ animationDelay: `${120 + index * 40}ms` }}
                  >
                    <Card
                      onClick={() => fetchOrderDetails(order.id)}
                      className={`cursor-pointer rounded-2xl border border-slate-200 p-5 shadow-sm transition hover:shadow-md ${
                        isLocked ? 'bg-slate-50' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-2xl sm:text-3xl font-semibold text-slate-900">
                            {dateText}
                          </p>
                          <p className="text-sm text-slate-500 mt-1">
                            {timeText ? `เวลา ${timeText} • ` : ''}{orderNumber}
                          </p>
                          {order.item_count && (
                            <p className="text-xs text-slate-500 mt-1">
                              {order.item_count} รายการ
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {getStatusBadge(order.status || 'draft')}
                          {isLocked && (
                            <span className="text-xs text-slate-400" title="ไม่สามารถแก้ไขได้">
                              🔒 ล็อค
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-4 border-t border-slate-200 mt-4">
                        <span className="text-slate-500 text-sm font-medium">ยอดรวม</span>
                        <span className="font-semibold text-blue-600 text-lg">
                          ฿{total.toFixed(2)}
                        </span>
                      </div>
                    </Card>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Order Detail Modal */}
        {selectedOrder && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            onClick={() => setSelectedOrder(null)}
          >
            <div
              className="bg-white rounded-3xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-4 gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-2xl font-semibold text-slate-900">
                      {formatOrderDate(selectedOrder.order_date).dateText}
                    </h2>
                    {!canEdit(selectedOrder) && (
                      <span className="text-gray-400" title="ไม่สามารถแก้ไขได้">
                        🔒
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-slate-500">
                      {selectedOrder.order_number}
                    </p>
                    {getStatusBadge(selectedOrder.status)}
                  </div>
                </div>
                {canEdit(selectedOrder) && !isEditing && (
                  <div className="flex items-center gap-2">
                    <Button onClick={() => setIsEditing(true)} variant="secondary">
                      แก้ไข
                    </Button>
                    <Button
                      onClick={handleDeleteOrder}
                      variant="danger"
                      disabled={deleting}
                    >
                      {deleting ? 'กำลังลบ...' : 'ลบคำสั่งซื้อ'}
                    </Button>
                  </div>
                )}
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {!canEdit(selectedOrder) && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-700">
                    <strong>ℹ️ ไม่สามารถแก้ไขได้</strong>
                    <br />
                    {!selectedOrder.is_open
                      ? 'Admin ปิดรับคำสั่งซื้อแล้ว ไม่สามารถแก้ไขได้'
                      : 'คำสั่งซื้อนี้อยู่ระหว่างดำเนินการ ไม่สามารถแก้ไขได้'}
                  </p>
                </div>
              )}

              <div className="mb-4">
                <h3 className="font-semibold text-gray-700 mb-3">รายการสินค้า</h3>
                {!isEditing && (
                  <div className="space-y-3">
                    {selectedOrder.items.map((item) => (
                      <div
                        key={item.id}
                        className="bg-gray-50 p-3 rounded-lg"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-medium text-gray-900">{item.product_name}</span>
                          <span className="text-blue-600 font-semibold">
                            ฿{(item.quantity * item.requested_price).toFixed(2)}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600">
                          {item.quantity} {item.unit_abbr} × ฿{item.requested_price}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {isEditing && (
                  <div className="space-y-3">
                    {editItems.map((item) => (
                      <div key={item.id} className="border rounded-lg p-3">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">{item.product_name}</p>
                            <p className="text-xs text-gray-500">{item.unit_abbr}</p>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 sm:items-end w-full md:w-auto">
                            <Input
                              label="จำนวน"
                              type="number"
                              min="0"
                              step="0.5"
                              value={item.quantity}
                              onChange={(e) =>
                                handleEditItemChange(
                                  item.id,
                                  'quantity',
                                  Number(e.target.value)
                                )
                              }
                              className="w-full sm:w-28"
                            />
                            <Input
                              label="ราคา"
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.requested_price}
                              onChange={(e) =>
                                handleEditItemChange(
                                  item.id,
                                  'requested_price',
                                  Number(e.target.value)
                                )
                              }
                              className="w-full sm:w-28"
                            />
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-500">รวม</p>
                            <p className="font-semibold text-blue-600">
                              ฿{(Number(item.quantity) * Number(item.requested_price)).toFixed(2)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveEditItem(item.id)}
                            className="text-sm text-red-600 hover:text-red-700"
                          >
                            ลบรายการ
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">ยอดรวมทั้งหมด</span>
                  <span className="text-2xl font-bold text-blue-600">
                    ฿
                    {(
                      isEditing
                        ? editItems.reduce(
                            (sum, item) =>
                              sum + Number(item.quantity || 0) * Number(item.requested_price || 0),
                            0
                          )
                        : Number(selectedOrder.total_amount || 0)
                    ).toFixed(2)}
                  </span>
                </div>
              </div>

              {isEditing && (
                <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:justify-end">
                  <Button onClick={handleCancelEdit} variant="secondary" disabled={saving}>
                    ยกเลิก
                  </Button>
                  <Button onClick={handleSaveEdit} disabled={saving}>
                    {saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};
