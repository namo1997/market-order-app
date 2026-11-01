import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../../contexts/CartContext';
import { ordersAPI } from '../../api/orders';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';

const toLocalDateString = (date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().split('T')[0];
};

const MAX_ORDER_DAYS_AHEAD = 7;
const QUANTITY_STEP = 0.5;

// ช่องจำนวนที่เก็บค่าที่กำลังพิมพ์ไว้เอง: ลบช่องว่างระหว่างพิมพ์ไม่ทำให้สินค้าหายจากตะกร้า
// จะลบสินค้าก็ต่อเมื่อยืนยันค่า 0 หรือปล่อยช่องว่างแล้วออกจากช่อง (blur/Enter)
export const CartQuantityInput = ({ quantity, onChange, onRemove, className = '' }) => {
  const [draft, setDraft] = useState(null);
  const displayValue = draft ?? (Number(quantity) > 0 ? String(quantity) : '');

  const handleChange = (value) => {
    setDraft(value);
    const parsed = Number(value);
    if (value.trim() !== '' && Number.isFinite(parsed) && parsed > 0) {
      onChange(parsed);
    }
  };

  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (draft.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      onRemove();
      return;
    }
    onChange(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      className={className}
      aria-label="จำนวน"
    />
  );
};

export const Cart = () => {
  const navigate = useNavigate();
  const {
    cartItems,
    updateQuantity,
    removeFromCart,
    clearCart,
    totalAmount,
    orderDate
  } = useCart();

  const [loading, setLoading] = useState(false);
  const [orderStatus, setOrderStatus] = useState(null);

  useEffect(() => {
    const fetchStatus = async () => {
      if (!orderDate) {
        setOrderStatus(null);
        return;
      }
      try {
        const response = await ordersAPI.getOrderStatus(orderDate);
        setOrderStatus(response.data);
      } catch (error) {
        console.error('Error fetching order status:', error);
        setOrderStatus(null);
      }
    };

    fetchStatus();
  }, [orderDate]);

  const todayString = toLocalDateString(new Date());
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + MAX_ORDER_DAYS_AHEAD);
  const maxDateString = toLocalDateString(maxDate);
  const hasOrderDate = Boolean(orderDate);
  const isOutOfRange = hasOrderDate && (orderDate < todayString || orderDate > maxDateString);
  const isStatusClosed = Boolean(orderStatus && !orderStatus.is_open);
  const isClosed = !hasOrderDate || isOutOfRange || isStatusClosed;
  const closedMessage = isOutOfRange
    ? `วันที่ที่เลือกอยู่นอกช่วงที่สั่งได้ (วันนี้ถึงอีก ${MAX_ORDER_DAYS_AHEAD} วัน)`
    : 'ปิดรับคำสั่งซื้อของวันที่ที่เลือกแล้ว';
  const displayOrderDate = orderDate
    ? new Date(orderDate).toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : '';
  const isTodayOrder = orderDate === todayString;

  const handleSubmitOrder = async () => {
    if (cartItems.length === 0) {
      alert('ตะกร้าว่างเปล่า');
      return;
    }
    if (!orderDate) {
      alert('กรุณาเลือกวันที่สั่งซื้อก่อน');
      return;
    }
    if (isClosed) {
      alert(closedMessage);
      return;
    }

    const confirmed = window.confirm(
      `ยืนยันส่งคำสั่งซื้อ?\nยอดรวม: ${totalAmount.toFixed(2)} บาท`
    );

    if (!confirmed) return;

    try {
      setLoading(true);
      await ordersAPI.createOrder(cartItems, orderDate);
      clearCart();
      alert('ส่งคำสั่งซื้อสำเร็จ');
      navigate('/orders');
    } catch (error) {
      console.error('Error submitting order:', error);
      alert(error.response?.data?.message || 'ส่งคำสั่งซื้อไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  if (cartItems.length === 0) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg
              className="w-24 h-24 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            ตะกร้าว่างเปล่า
          </h2>
          <p className="text-gray-600 mb-6">ยังไม่มีสินค้าในตะกร้า</p>
          <Button onClick={() => navigate('/order')}>เลือกสินค้า</Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">ตะกร้าสินค้า</h1>

        <div className="mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
            <div>
              <p className="text-xs text-gray-500">วันที่สั่งซื้อ</p>
              <p className="font-semibold text-gray-900">
                {displayOrderDate || 'ยังไม่ได้เลือกวันที่'}
              </p>
              {hasOrderDate && isTodayOrder && (
                <p className="text-xs text-amber-700 mt-1">
                  ⚠️ คุณกำลังสั่งของสำหรับวันนี้ (ปกติสั่งวันนี้เพื่อซื้อพรุ่งนี้)
                </p>
              )}
            </div>
            {!hasOrderDate && (
              <span className="text-sm text-yellow-700">
                กรุณาเลือกวันที่ก่อนยืนยันคำสั่งซื้อ
              </span>
            )}
            {hasOrderDate && isClosed && (
              <span className="text-sm text-red-600">
                {closedMessage}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-4 mb-6">
          {cartItems.map((item) => (
            <Card key={item.product_id} className="relative">
              <div className="flex flex-col space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">{item.product_name}</h3>
                    <p className="text-sm text-gray-500">
                      {item.quantity} {item.unit_abbr} × ฿{parseFloat(item.requested_price || 0).toFixed(2)}
                    </p>
                  </div>
                  <button
                    onClick={() => removeFromCart(item.product_id)}
                    className="text-red-500 hover:text-red-700 p-1"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>

                <div className="flex items-center space-x-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">จำนวน</label>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(
                            item.product_id,
                            Math.max(QUANTITY_STEP, Number(item.quantity) - QUANTITY_STEP)
                          )
                        }
                        className="w-9 h-9 shrink-0 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600"
                        aria-label="ลดจำนวน"
                      >
                        -
                      </button>
                      <CartQuantityInput
                        quantity={item.quantity}
                        onChange={(value) => updateQuantity(item.product_id, value)}
                        onRemove={() => removeFromCart(item.product_id)}
                        className="w-full min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(item.product_id, Number(item.quantity) + QUANTITY_STEP)
                        }
                        className="w-9 h-9 shrink-0 rounded-full bg-blue-50 flex items-center justify-center font-bold text-blue-600"
                        aria-label="เพิ่มจำนวน"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="w-1/3 text-right">
                    <label className="block text-sm font-medium text-gray-700 mb-1">รวม</label>
                    <div className="font-bold text-lg text-blue-600">
                      ฿{(item.quantity * item.requested_price).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Summary */}
        <Card className="bg-blue-50">
          <div className="flex justify-between items-center mb-4">
            <span className="text-lg font-semibold">ยอดรวมทั้งหมด</span>
            <span className="text-2xl font-bold text-blue-600">
              {totalAmount.toFixed(2)} บาท
            </span>
          </div>

          <div className="flex space-x-3">
            <Button
              onClick={() => navigate('/order')}
              variant="secondary"
              fullWidth
            >
              เลือกสินค้าเพิ่ม
            </Button>
            <Button
              onClick={handleSubmitOrder}
              disabled={loading || isClosed}
              fullWidth
            >
              {loading ? 'กำลังส่ง...' : 'ยืนยันส่งคำสั่งซื้อ'}
            </Button>
          </div>
        </Card>
      </div>
    </Layout>
  );
};
