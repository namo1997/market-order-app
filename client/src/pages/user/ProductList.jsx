import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { productsAPI } from '../../api/products';
import { ordersAPI } from '../../api/orders';
import { departmentProductsAPI } from '../../api/department-products';
import { useCart } from '../../contexts/CartContext';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.data)) return value.data;
  if (value.data && typeof value.data === 'object') {
    const nested = normalizeArray(value.data);
    if (nested.length) return nested;
  }
  const candidates = ['items', 'rows', 'products', 'list', 'suppliers'];
  for (const key of candidates) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
};

const normalizeObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.is_open !== undefined) return value;
  if (value.data && typeof value.data === 'object') {
    return normalizeObject(value.data);
  }
  return value;
};

const toNumber = (value) => {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toLocalDateString = (date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().split('T')[0];
};

const normalizeProducts = (payload) => {
  const list = normalizeArray(payload);
  return list
    .map((product) => ({
      id: product.id ?? product.product_id ?? product?.product?.id ?? null,
      name: product.name ?? product.product_name ?? product?.product?.name ?? '',
      default_price: toNumber(
        product.last_actual_price ??
          product.default_price ??
          product.price?.default ??
          product?.product?.default_price ??
          product?.product?.price
      ),
      unit_name:
        product.unit_name ??
        product.unit?.name ??
        product?.product?.unit_name ??
        '',
      unit_abbr:
        product.unit_abbr ??
        product.unit?.abbreviation ??
        product.unit?.abbr ??
        product?.product?.unit_abbr ??
        '',
      supplier_id:
        product.supplier_id ??
        product.supplier?.id ??
        product?.product?.supplier_id ??
        null,
      supplier_name:
        product.supplier_name ??
        product.supplier?.name ??
        product?.product?.supplier_name ??
        product.product_group_name ??
        product.product_group?.name ??
        ''
    }))
    .filter((product) => product.id !== null);
};

const normalizeSuppliers = (payload) => {
  const list = normalizeArray(payload);
  return list
    .map((supplier) => ({
      id: supplier.id ?? supplier.supplier_id ?? supplier?.supplier?.id ?? null,
      name:
        supplier.name ??
        supplier.supplier_name ??
        supplier?.supplier?.name ??
        ''
    }))
    .filter((supplier) => supplier.id !== null && supplier.name);
};

export const ProductList = () => {
  const navigate = useNavigate();
  const {
    addToCart,
    cartItems,
    totalAmount,
    itemCount,
    updateQuantity,
    updateNote,
    removeFromCart,
    clearCart,
    orderDate,
    setOrderDate
  } = useCart();

  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orderStatus, setOrderStatus] = useState(null);

  const [search, setSearch] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'grid';
    const saved = window.localStorage.getItem('order_product_view_mode');
    return saved === 'row' ? 'row' : 'grid';
  });
  const [notes, setNotes] = useState({});
  const [departmentOnly, setDepartmentOnly] = useState(false);
  const [departmentProductIds, setDepartmentProductIds] = useState(new Set());
  const [departmentLoading, setDepartmentLoading] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const cardPointerStart = useRef(null);

  const [isCartModalOpen, setIsCartModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const today = new Date();
  const todayString = toLocalDateString(today);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 7);
  const maxDateString = toLocalDateString(maxDate);
  const displayOrderDate = orderDate
    ? new Date(orderDate).toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : '';
  const isTodayOrder = orderDate === todayString;

  useEffect(() => {
    fetchData();
  }, [selectedSupplier, orderDate]);

  useEffect(() => {
    setIsAndroid(/Android/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('order_product_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!departmentOnly) return;
    if (departmentProductIds.size > 0) return;

    const fetchDepartmentProducts = async () => {
      try {
        setDepartmentLoading(true);
        const products = await departmentProductsAPI.getMyDepartmentProducts();
        const ids = new Set(
          (products || []).map((productId) => String(productId))
        );
        setDepartmentProductIds(ids);
      } catch (error) {
        console.error('Error fetching department products:', error);
        alert('ไม่สามารถโหลดรายการสินค้าเฉพาะแผนกได้');
        setDepartmentOnly(false);
      } finally {
        setDepartmentLoading(false);
      }
    };

    fetchDepartmentProducts();
  }, [departmentOnly, departmentProductIds]);

  useEffect(() => {
    const map = {};
    cartItems.forEach((item) => {
      if (item.note) {
        map[item.product_id] = item.note;
      }
    });
    setNotes((prev) => ({ ...prev, ...map }));
  }, [cartItems]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // ดึงข้อมูลพร้อมกัน
      const statusPromise = orderDate
        ? ordersAPI.getOrderStatus(orderDate)
        : Promise.resolve({ data: { is_open: false } });
      const [productsRes, suppliersRes, statusRes] = await Promise.all([
        productsAPI.getProducts({ supplierId: selectedSupplier }),
        suppliers.length === 0
          ? productsAPI.getProductGroups()
          : Promise.resolve({ data: suppliers }),
        statusPromise
      ]);

      setProducts(normalizeProducts(productsRes?.data ?? productsRes));

      if (suppliers.length === 0) {
        setSuppliers(normalizeSuppliers(suppliersRes?.data ?? suppliersRes));
      }

      setOrderStatus(normalizeObject(statusRes?.data ?? statusRes));
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCartItem = (productId) =>
    cartItems.find((item) => item.product_id === productId);

  const applyQuantity = (product, quantity) => {
    const normalized = Math.max(0, Number(quantity) || 0);
    const noteValue =
      notes[product.id] ?? getCartItem(product.id)?.note ?? '';

    if (normalized > 0 && !orderDate) {
      alert('กรุณาเลือกวันที่สั่งซื้อก่อน');
      return;
    }

    if (normalized === 0) {
      removeFromCart(product.id);
      return;
    }

    const existing = getCartItem(product.id);
    if (existing) {
      updateQuantity(product.id, normalized);
      updateNote(product.id, noteValue);
    } else {
      addToCart(product, normalized, noteValue);
    }
  };

  const handleQuantityInputChange = (product, value) => {
    if (value === '') {
      applyQuantity(product, 0);
      return;
    }

    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    applyQuantity(product, parsed);
  };

  const adjustQuantity = (product, delta) => {
    const currentQty = getCartItem(product.id)?.quantity || 0;
    const newQty = Math.max(0, currentQty + delta);
    applyQuantity(product, newQty);
  };

  const handleCardClick = (product) => {
    if (isClosed) return;
    const currentQty = getCartItem(product.id)?.quantity || 0;
    const nextQty = currentQty > 0 ? currentQty + 1 : 1;
    applyQuantity(product, nextQty);
  };

  const handleCardPointerDown = (event, product) => {
    if (event.pointerType === 'touch') {
      cardPointerStart.current = {
        x: event.clientX,
        y: event.clientY,
        productId: product.id
      };
    }
  };

  const handleCardPointerUp = (event, product) => {
    if (event.target.closest('[data-card-control="true"]')) {
      cardPointerStart.current = null;
      return;
    }

    if (event.pointerType === 'touch') {
      const start = cardPointerStart.current;
      cardPointerStart.current = null;
      if (!start) return;
      const dx = Math.abs(event.clientX - start.x);
      const dy = Math.abs(event.clientY - start.y);
      if (dx > 10 || dy > 10) {
        return;
      }
    }

    handleCardClick(product);
  };

  const handleCardPointerCancel = () => {
    cardPointerStart.current = null;
  };

  const handleNoteChange = (product, value) => {
    setNotes((prev) => ({ ...prev, [product.id]: value }));
    const existing = getCartItem(product.id);
    if (existing) {
      updateNote(product.id, value);
    }
  };

  const handleSearchChange = (value) => setSearch(value);

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
      alert('วันที่ที่เลือกยังไม่เปิดรับคำสั่งซื้อ');
      return;
    }

    const confirmed = window.confirm(
      `ยืนยันส่งคำสั่งซื้อ?\nยอดรวม: ${totalAmount.toFixed(2)} บาท`
    );

    if (!confirmed) return;

    try {
      setSubmitting(true);
      await ordersAPI.createOrder(cartItems, orderDate);
      clearCart();
      setIsCartModalOpen(false);
      alert('ส่งคำสั่งซื้อสำเร็จ');
      navigate('/orders');
    } catch (error) {
      console.error('Error submitting order:', error);
      alert(error.response?.data?.message || 'ส่งคำสั่งซื้อไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  // เช็คว่าปิดรับออเดอร์หรือไม่
  const hasOrderDate = Boolean(orderDate);
  const isClosed = !hasOrderDate || (orderStatus && !orderStatus.is_open);

  if (loading && products.length === 0) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  const normalizedSearch = search.trim().toLowerCase();
  const baseProducts = departmentOnly
    ? products.filter((product) => departmentProductIds.has(String(product.id)))
    : products;
  const visibleProducts = normalizedSearch
    ? baseProducts.filter((product) => String(product.name || '').toLowerCase().includes(normalizedSearch))
    : baseProducts;

  const emptyMessage = departmentOnly
    ? 'ยังไม่มีรายการสินค้าสำหรับแผนกนี้'
    : 'ไม่พบสินค้า';
  const isRowView = viewMode === 'row';

  const layoutClass = '';
  const wrapperClass = 'max-w-4xl mx-auto w-full flex flex-col';
  const listClass = 'pb-28';
  const searchContainerClass = 'sticky top-0 z-50 py-2 bg-gray-50 border-b border-gray-100 mb-3';

  return (
    <Layout mainClassName={layoutClass}>
      <div className={wrapperClass}>
        <div className="shrink-0">
          <h1 className="text-2xl font-bold text-gray-900 mb-4 px-1">สั่งซื้อสินค้า</h1>

          {!hasOrderDate && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg mb-6 shadow-sm">
              กรุณาเลือกวันที่สั่งซื้อก่อนเริ่มสั่งสินค้า
            </div>
          )}

          {hasOrderDate && isClosed && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 shadow-sm">
              ⚠️ วันที่ที่เลือกยังไม่เปิดรับคำสั่งซื้อ
            </div>
          )}

          {/* Filters */}
          <div className="bg-gray-50 pt-2 pb-4 mb-4 -mx-4 px-4 border-b border-gray-100">
            {/* Order Date */}
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">วันที่สั่งซื้อ</label>
              <input
                type="date"
                value={orderDate}
                min={todayString}
                max={maxDateString}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {isTodayOrder && (
                <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠️ คุณกำลังสั่งของเมื่อวาน (ปกติสั่งวันนี้ซื้อพรุ่งนี้)
                </div>
              )}
            </div>
            <div className="mb-3 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={departmentOnly}
                  onChange={(e) => setDepartmentOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                แสดงสินค้าเฉพาะแผนก
              </label>
              {departmentOnly && departmentLoading && (
                <span className="text-xs text-gray-500">กำลังโหลดรายการแผนก...</span>
              )}
            </div>
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">มุมมองสินค้า</label>
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-3 py-1.5 text-sm rounded-md transition ${
                    !isRowView
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  การ์ด
                </button>
                <button
                  onClick={() => setViewMode('row')}
                  className={`px-3 py-1.5 text-sm rounded-md transition ${
                    isRowView
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  แถว (มือถือ)
                </button>
              </div>
            </div>

            {/* Supplier Filter Buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedSupplier('')}
                className={`px-5 py-2.5 rounded-full font-semibold whitespace-nowrap transition-all max-w-full ${
                  selectedSupplier === ''
                    ? 'bg-blue-600 text-white shadow-lg scale-105'
                    : 'bg-white text-gray-700 border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                <span className="block truncate">ทั้งหมด</span>
              </button>
              {suppliers.map((supplier) => (
                <button
                  key={supplier.id}
                  onClick={() => setSelectedSupplier(supplier.id)}
                  className={`px-5 py-2.5 rounded-full font-semibold whitespace-nowrap transition-all max-w-full ${
                    selectedSupplier === supplier.id
                      ? 'bg-blue-600 text-white shadow-lg scale-105'
                      : 'bg-white text-gray-700 border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}
                >
                  <span className="block truncate">{supplier.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sticky Search */}
        <div className={searchContainerClass}>
          <Input
            placeholder="🔍 ค้นหาสินค้า..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full text-base"
          />
        </div>

        {/* Product List */}
        <div className={listClass}>
        {visibleProducts.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
            {emptyMessage}
          </div>
        ) : (
          <div className={isRowView ? 'space-y-2' : 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3'}>
            {visibleProducts.map((product) => (
              <Card
                key={product.id}
                onClick={isAndroid ? () => handleCardClick(product) : undefined}
                onPointerDown={
                  isAndroid ? undefined : (event) => handleCardPointerDown(event, product)
                }
                onPointerUp={
                  isAndroid ? undefined : (event) => handleCardPointerUp(event, product)
                }
                onPointerCancel={isAndroid ? undefined : handleCardPointerCancel}
                className={`transform transition-all duration-200 ${
                  !isClosed ? 'cursor-pointer hover:-translate-y-1 hover:shadow-xl' : ''
                } ${isRowView ? 'p-3' : ''}`}
              >
                  {isRowView ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="min-w-0 font-bold text-sm text-gray-900 truncate">
                          {product.name || 'Unknown Product'}
                        </h3>
                        {product.supplier_name && (
                          <p className="text-[10px] text-gray-500 truncate">
                            {product.supplier_name}
                          </p>
                        )}
                      </div>
                      <span className="font-semibold text-blue-600 text-xs whitespace-nowrap">
                        ฿{parseFloat(product.default_price || 0).toFixed(0)}
                      </span>
                      <span className="bg-blue-100 text-blue-800 text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap">
                        {product.unit_abbr}
                      </span>
                      <div
                        className="flex items-center gap-1 w-28 shrink-0"
                        data-card-control="true"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            adjustQuantity(product, -0.5);
                          }}
                          className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-lg font-bold hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0"
                          disabled={isClosed}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={getCartItem(product.id)?.quantity ?? 0}
                          onChange={(e) => handleQuantityInputChange(product, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-center border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm font-medium py-1"
                          placeholder="0"
                          min="0"
                          step="0.1"
                          disabled={isClosed}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            adjustQuantity(product, 0.5);
                          }}
                          className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-lg font-bold hover:bg-blue-100 active:bg-blue-200 transition-colors flex-shrink-0"
                          disabled={isClosed}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-2">
                        <div>
                          <div className="mb-2">
                            <h3 className="font-bold text-sm md:text-base text-gray-900 line-clamp-2 mb-1">
                              {product.name || 'Unknown Product'}
                            </h3>
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-blue-600 text-base md:text-lg">
                                ฿{parseFloat(product.default_price || 0).toFixed(0)}
                              </span>
                              <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded">
                                {product.unit_abbr}
                              </span>
                            </div>
                          </div>

                          {product.supplier_name && (
                            <p className="text-xs text-gray-500 mb-2 truncate">{product.supplier_name}</p>
                          )}
                        </div>

                        {/* Quantity Controls - Compact */}
                        <div className="pt-2 border-t">
                          <div
                            className="flex items-center space-x-1"
                            data-card-control="true"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                adjustQuantity(product, -0.5);
                              }}
                              className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-lg font-bold hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0"
                              disabled={isClosed}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              value={getCartItem(product.id)?.quantity ?? 0}
                              onChange={(e) => handleQuantityInputChange(product, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full text-center border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm font-medium py-1.5"
                              placeholder="0"
                              min="0"
                              step="0.1"
                              disabled={isClosed}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                adjustQuantity(product, 0.5);
                              }}
                              className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-lg font-bold hover:bg-blue-100 active:bg-blue-200 transition-colors flex-shrink-0"
                              disabled={isClosed}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={notes[product.id] ?? getCartItem(product.id)?.note ?? ''}
                        onChange={(e) => handleNoteChange(product, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="หมายเหตุ"
                        data-card-control="true"
                        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
                        disabled={isClosed}
                      />
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating Cart Button */}
      {itemCount > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-8 md:w-auto">
          <button
            onClick={() => setIsCartModalOpen(true)}
            className="w-full md:w-auto bg-green-600 text-white shadow-lg rounded-full px-6 py-4 flex items-center justify-between hover:bg-green-700 transition-all transform hover:scale-105 active:scale-95"
          >
            <div className="flex items-center space-x-3">
              <div className="bg-white text-green-600 rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm">
                {itemCount}
              </div>
              <span className="font-semibold text-lg">ตะกร้าสินค้า</span>
            </div>
            <span className="font-bold text-lg ml-4">฿{totalAmount.toLocaleString()}</span>
          </button>
        </div>
      )}

      {/* Cart Modal */}
      <Modal
        isOpen={isCartModalOpen}
        onClose={() => setIsCartModalOpen(false)}
        title="ตะกร้าสินค้า"
        size="large"
      >
        {cartItems.length === 0 ? (
          <div className="text-center py-12">
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
          </div>
        ) : (
          <div>
            <div className="mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                <div>
                  <p className="text-xs text-gray-500">วันที่สั่งซื้อ</p>
                  <p className="font-semibold text-gray-900">
                    {displayOrderDate || 'ยังไม่ได้เลือกวันที่'}
                  </p>
                  {hasOrderDate && isTodayOrder && (
                    <p className="text-xs text-amber-700 mt-1">
                      ⚠️ คุณกำลังสั่งของเมื่อวาน (ปกติสั่งวันนี้ซื้อพรุ่งนี้)
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
                    วันที่ที่เลือกยังไม่เปิดรับคำสั่งซื้อ
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
              {cartItems.map((item) => (
                <Card key={item.product_id} className="relative">
                  <div className="flex flex-col space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-lg text-gray-900">{item.product_name}</h3>
                        <p className="text-sm text-gray-500">
                          {item.quantity} {item.unit_abbr} × ฿{parseFloat(item.requested_price || 0).toFixed(2)}
                        </p>
                        {item.note && (
                          <p className="text-xs text-gray-500 mt-1">
                            หมายเหตุ: {item.note}
                          </p>
                        )}
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
                            onClick={() => updateQuantity(item.product_id, Math.max(0.5, item.quantity - 0.5))}
                            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600"
                          >
                            -
                          </button>
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateQuantity(item.product_id, parseFloat(e.target.value) || 0)}
                            className="text-center"
                            min="0"
                            step="0.1"
                          />
                          <button
                            onClick={() => updateQuantity(item.product_id, item.quantity + 0.5)}
                            className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center font-bold text-blue-600"
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
                  onClick={() => setIsCartModalOpen(false)}
                  variant="secondary"
                  fullWidth
                >
                  เลือกสินค้าเพิ่ม
                </Button>
                <Button
                  onClick={handleSubmitOrder}
                  disabled={submitting || isClosed}
                  fullWidth
                >
                  {submitting ? 'กำลังส่ง...' : 'ยืนยันส่งคำสั่งซื้อ'}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </Modal>
    </Layout>
  );
};
