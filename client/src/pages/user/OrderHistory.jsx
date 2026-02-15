import { useState, useEffect, useMemo, useRef } from 'react';
import { ordersAPI } from '../../api/orders';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Loading } from '../../components/common/Loading';
import { Button } from '../../components/common/Button';

export const OrderHistory = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [showWarnings, setShowWarnings] = useState(false);
  const [itemSearchTerm, setItemSearchTerm] = useState('');
  const [itemSearchInput, setItemSearchInput] = useState('');
  const [showItemSearch, setShowItemSearch] = useState(false);
  const itemSearchRef = useRef(null);
  const pageStyle = {
    fontFamily: '"Sarabun", "Noto Sans Thai", "Noto Sans", sans-serif'
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  useEffect(() => {
    if (showItemSearch && itemSearchRef.current) {
      itemSearchRef.current.focus();
    }
  }, [showItemSearch, selectedOrder]);

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
      setShowWarnings(false);
      setShowItemSearch(false);
      setItemSearchTerm('');
      setItemSearchInput('');
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

  const warningItems = useMemo(() => {
    if (!selectedOrder?.items) return [];
    return selectedOrder.items
      .map((item) => {
        if (item.actual_quantity === null || item.actual_quantity === undefined) {
          return null;
        }
        const ordered = Number(item.quantity || 0);
        const actual = Number(item.actual_quantity || 0);
        const diff = Number((actual - ordered).toFixed(2));
        if (Math.abs(diff) < 0.01) return null;
        return {
          id: item.id,
          product_name: item.product_name,
          unit_abbr: item.unit_abbr || '',
          ordered,
          actual,
          diff,
          reason: item.purchase_reason || ''
        };
      })
      .filter(Boolean);
  }, [selectedOrder]);

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
                onClick={() => window.location.href = '/order'}
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
                          {order.transferred_at && (
                            <p className="text-xs font-semibold text-amber-700 mt-1">
                              ย้ายมาจาก {order.transferred_from_branch_name || 'ไม่ระบุสาขา'} •{' '}
                              {order.transferred_from_department_name || 'ไม่ระบุแผนก'}
                            </p>
                          )}
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
                    {warningItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowWarnings((prev) => !prev)}
                        className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                        title="แจ้งเตือนสินค้าที่อาจขาดหรือเกิน"
                      >
                        <svg
                          className="w-4 h-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 9v4" />
                          <path d="M12 17h.01" />
                          <path d="M10.3 3.5h3.4L21 18.5H3L10.3 3.5z" />
                        </svg>
                        แจ้งเตือน
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-slate-500">
                      {selectedOrder.order_number}
                    </p>
                    {getStatusBadge(selectedOrder.status)}
                  </div>
                  {selectedOrder.transferred_at && (
                    <p className="mt-2 text-xs font-semibold text-amber-700">
                      ย้ายมาจาก {selectedOrder.transferred_from_branch_name || 'ไม่ระบุสาขา'} •{' '}
                      {selectedOrder.transferred_from_department_name || 'ไม่ระบุแผนก'}
                    </p>
                  )}
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

              {warningItems.length > 0 && showWarnings && (
                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold">แจ้งเตือน: สินค้าอาจขาดหรือเกิน</p>
                    <button
                      type="button"
                      onClick={() => setShowWarnings(false)}
                      className="text-xs font-semibold text-amber-700 hover:text-amber-900"
                    >
                      ปิด
                    </button>
                  </div>
                  <p className="text-xs text-amber-700 mb-3">
                    เป็นการแจ้งเตือนเท่านั้น เพราะสินค้าบางรายการอาจถูกรวมจากหลายสาขา/แผนก
                  </p>
                  <div className="space-y-2">
                    {warningItems.map((item) => (
                      <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3">
                        <div>
                          <p className="font-semibold text-amber-900">{item.product_name}</p>
                          <p className="text-xs text-amber-700">
                            สั่ง {item.ordered} {item.unit_abbr} •
                            รับจริง {item.actual} {item.unit_abbr}
                          </p>
                          {item.reason && (
                            <p className="text-xs text-amber-700">
                              เหตุผล: {item.reason}
                            </p>
                          )}
                        </div>
                        <div className="text-right font-semibold text-amber-800">
                          {item.diff > 0
                            ? `เกิน ${item.diff}`
                            : `ขาด ${Math.abs(item.diff)}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-semibold text-gray-700">รายการสินค้า</h3>
                  <button
                    type="button"
                    onClick={() => setShowItemSearch((prev) => !prev)}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                  >
                    ค้นหาสินค้า
                  </button>
                </div>
                {showItemSearch && (
                  <div className="mb-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <input
                      ref={itemSearchRef}
                      type="text"
                      value={itemSearchInput}
                      onChange={(e) => setItemSearchInput(e.target.value)}
                      placeholder="พิมพ์ชื่อสินค้าเพื่อค้นหา"
                      className="w-full bg-transparent text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setItemSearchTerm(itemSearchInput.trim())}
                      className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
                    >
                      ค้นหา
                    </button>
                    {itemSearchTerm && (
                      <button
                        type="button"
                        onClick={() => {
                          setItemSearchTerm('');
                          setItemSearchInput('');
                        }}
                        className="text-xs font-semibold text-blue-600"
                      >
                        ล้าง
                      </button>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  {(isEditing ? editItems : selectedOrder.items)
                    .filter((item) => {
                      if (isEditing || !itemSearchTerm) return true;
                      return String(item.product_name || '')
                        .toLowerCase()
                        .includes(itemSearchTerm.toLowerCase());
                    })
                    .map((item) => {
                      return (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm"
                      >
                        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 whitespace-normal break-words leading-tight">
                              {item.product_name}
                            </p>
                          </div>
                          <div className="flex items-center justify-end gap-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {isEditing ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  value={item.quantity}
                                  onChange={(e) =>
                                    handleEditItemChange(
                                      item.id,
                                      'quantity',
                                      Number(e.target.value)
                                    )
                                  }
                                  className="w-10 rounded-full border border-blue-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 text-right"
                                />
                              ) : (
                                <span className="text-xs font-semibold text-slate-700">
                                  {item.quantity}
                                </span>
                              )}
                              <span className="text-xs text-slate-500">
                                {item.unit_abbr}
                              </span>
                            </div>
                            {isEditing && (
                              <button
                                type="button"
                                onClick={() => handleRemoveEditItem(item.id)}
                                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100"
                              >
                                ลบ
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
