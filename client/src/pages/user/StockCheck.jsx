import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../../contexts/CartContext';
import { stockCheckAPI } from '../../api/stock-check';
import { Layout } from '../../components/layout/Layout';

export const StockCheck = () => {
  const navigate = useNavigate();
  const { addToCart, orderDate, setOrderDate } = useCart();

  const [template, setTemplate] = useState([]);
  const [currentStock, setCurrentStock] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);
  const [checkDate, setCheckDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [selectedCategory, setSelectedCategory] = useState('');
  const pageStyle = {
    fontFamily: '"Sarabun", "Noto Sans Thai", "Noto Sans", sans-serif'
  };

  useEffect(() => {
    loadData();
  }, [checkDate]);

  const loadData = async () => {
    try {
      setLoading(true);
      setIsDisabled(false);
      const [templateData, stockChecks] = await Promise.all([
        stockCheckAPI.getMyDepartmentTemplate(),
        stockCheckAPI.getMyDepartmentCheck(checkDate)
      ]);

      setTemplate(templateData || []);

      // Initialize current stock with 0
      const stockObj = {};
      (templateData || []).forEach(item => {
        stockObj[item.product_id] = 0;
      });

      (stockChecks || []).forEach((item) => {
        stockObj[item.product_id] = Number(item.stock_quantity || 0);
      });
      setCurrentStock(stockObj);
    } catch (error) {
      console.error('Error fetching template:', error);
      if (error.response?.status === 403) {
        setIsDisabled(true);
        return;
      }
      alert('ไม่สามารถโหลดรายการของประจำได้');
    } finally {
      setLoading(false);
    }
  };

  const handleStockChange = (productId, value) => {
    const numValue = parseFloat(value) || 0;
    setCurrentStock(prev => ({
      ...prev,
      [productId]: numValue
    }));
  };

  const calculateOrderQuantity = (requiredQty, minQty, stockQty) => {
    const maxValue = Number(requiredQty || 0);
    const minValue = Number(minQty || 0);
    const stockValue = Number(stockQty || 0);

    if (minValue > 0) {
      if (stockValue < minValue) {
        const target = maxValue > 0 ? maxValue : minValue;
        const diff = target - stockValue;
        return diff > 0 ? diff : 0;
      }
      return 0;
    }

    if (maxValue > 0) {
      const diff = maxValue - stockValue;
      return diff > 0 ? diff : 0;
    }

    return 0;
  };

  const groupedTemplate = useMemo(() => {
    const groups = new Map();

    template.forEach((item) => {
      const key = item.category_id ? String(item.category_id) : 'uncategorized';
      const name = item.category_name || 'ไม่ระบุหมวด';
      const sortOrder =
        item.category_sort_order === null || item.category_sort_order === undefined
          ? 9999
          : Number(item.category_sort_order);

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name,
          sortOrder,
          items: []
        });
      }

      groups.get(key).items.push(item);
    });

    const result = Array.from(groups.values()).sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name, 'th');
    });

    result.forEach((group) => {
      group.items.sort((a, b) =>
        String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th')
      );
    });

    return result;
  }, [template]);

  const filteredGroups = useMemo(() => {
    if (!selectedCategory) return groupedTemplate;
    return groupedTemplate.filter((group) => group.key === selectedCategory);
  }, [groupedTemplate, selectedCategory]);

  useEffect(() => {
    if (!selectedCategory) return;
    const exists = groupedTemplate.some((group) => group.key === selectedCategory);
    if (!exists) {
      setSelectedCategory('');
    }
  }, [groupedTemplate, selectedCategory]);

  const handleSaveStock = async (silent = false) => {
    if (template.length === 0) return;

    try {
      setSaving(true);
      const items = template.map((item) => ({
        product_id: item.product_id,
        stock_quantity: Number(currentStock[item.product_id] || 0)
      }));
      await stockCheckAPI.saveMyDepartmentCheck(checkDate, items);
      if (!silent) {
        alert('บันทึกสต็อกสำเร็จ');
      }
    } catch (error) {
      console.error('Error saving stock:', error);
      if (!silent) {
        alert('บันทึกสต็อกไม่สำเร็จ');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddToCart = () => {
    const itemsToOrder = template
      .map(item => {
        const orderQty = calculateOrderQuantity(
          item.required_quantity,
          item.min_quantity,
          currentStock[item.product_id] || 0
        );
        return {
          ...item,
          orderQuantity: orderQty
        };
      })
      .filter(item => item.orderQuantity > 0);

    if (itemsToOrder.length === 0) {
      alert('ไม่มีสินค้าที่ต้องสั่ง (ของครบทุกรายการแล้ว)');
      return;
    }

    const confirmed = window.confirm(
      `ต้องการเพิ่ม ${itemsToOrder.length} รายการไปยังตะกร้าหรือไม่?`
    );

    if (!confirmed) return;

    try {
      if (orderDate && orderDate !== checkDate) {
        const shouldChange = window.confirm(
          `วันที่สั่งซื้อในตะกร้าเป็น ${orderDate} ต้องการเปลี่ยนเป็น ${checkDate} ตามวันที่เช็คสต็อกหรือไม่?`
        );
        if (!shouldChange) return;
      }
      setOrderDate(checkDate);
      setSubmitting(true);
      handleSaveStock(true);
      itemsToOrder.forEach((item) => {
        addToCart(
          {
            id: item.product_id,
            name: item.product_name,
            unit_name: item.unit_name,
            unit_abbr: item.unit_abbr,
            default_price: item.default_price
          },
          item.orderQuantity
        );
      });
      alert('เพิ่มสินค้าไปยังตะกร้าสำเร็จ');
      navigate('/cart');
    } catch (error) {
      console.error('Error adding to cart:', error);
      alert('เพิ่มสินค้าไปยังตะกร้าไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#F5F5F7]" style={pageStyle}>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center animate-fade-in">
            <div className="text-slate-500">กำลังโหลด...</div>
          </div>
        </div>
      </Layout>
    );
  }

  if (isDisabled) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#F5F5F7]" style={pageStyle}>
          <div className="max-w-4xl mx-auto text-center py-16 px-4 sm:px-6 animate-fade-in">
            <div className="text-slate-400 mb-4">
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
                  d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3l-7.07-12a2 2 0 00-3.46 0l-7.07 12c-.77 1.33.19 3 1.73 3z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-slate-900 mb-2">
              ปิดการใช้งานเช็คสต็อกชั่วคราว
            </h2>
            <p className="text-slate-600 mb-6">
              กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดใช้งานอีกครั้ง
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  if (template.length === 0) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#F5F5F7]" style={pageStyle}>
          <div className="max-w-4xl mx-auto text-center py-16 px-4 sm:px-6 animate-fade-in">
            <div className="text-slate-400 mb-4">
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
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </div>
            <h2 className="text-2xl font-semibold text-slate-900 mb-2">
              ยังไม่มีรายการของประจำ
            </h2>
            <p className="text-slate-600 mb-6">
              กรุณาติดต่อ Admin เพื่อตั้งค่ารายการของประจำให้แผนกของคุณ
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-[#F5F5F7]" style={pageStyle}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between animate-fade-slide-up">
            <div>
              <h1 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight">
                เช็คสต็อกและสั่งของ
              </h1>
            </div>
            <div className="w-full sm:w-72 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                วันที่เช็คสต็อก
              </label>
              <input
                type="date"
                value={checkDate}
                onChange={(e) => setCheckDate(e.target.value)}
                className="mt-1 w-full bg-transparent text-base font-semibold text-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">รายการของประจำ</h2>
          </div>

          {groupedTemplate.length > 1 && (
            <div className="mt-3">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                เลือกหมวด
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedCategory('')}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold transition ${
                    selectedCategory === ''
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  ทั้งหมด
                </button>
                {groupedTemplate.map((group) => (
                  <button
                    key={group.key}
                    onClick={() => setSelectedCategory(group.key)}
                    className={`px-3 py-1.5 rounded-full text-sm font-semibold transition ${
                      selectedCategory === group.key
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 space-y-4">
            {filteredGroups.map((group, groupIndex) => (
              <div
                key={group.key}
                className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
              >
                <div className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50">
                  {group.name}
                </div>
                <div className="divide-y">
                  {group.items.map((item, index) => {
                    const stock = currentStock[item.product_id] || 0;
                    const orderQty = calculateOrderQuantity(
                      item.required_quantity,
                      item.min_quantity,
                      stock
                    );
                    const needsOrder = orderQty > 0;

                    return (
                      <div
                        key={item.id}
                        className="animate-fade-slide-up"
                        style={{ animationDelay: `${120 + (groupIndex * 6 + index) * 30}ms` }}
                      >
                        <div className="flex flex-nowrap items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-base font-semibold text-slate-900 truncate">
                              {item.product_name}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              Min {Number(item.min_quantity || 0)} / Max {Number(item.required_quantity || 0)} {item.unit_abbr}
                            </p>
                          </div>
                          <div className="shrink-0">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                needsOrder
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {needsOrder
                                ? `สั่ง ${orderQty} ${item.unit_abbr}`
                                : 'ครบ'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-auto">
                            <input
                              type="number"
                              value={stock}
                              onChange={(e) =>
                                handleStockChange(item.product_id, e.target.value)
                              }
                              onFocus={(e) => e.target.select()}
                              min="0"
                              step="0.5"
                              inputMode="decimal"
                              className="w-20 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-base font-semibold text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-blue-300"
                            />
                            <span className="text-xs text-slate-500">{item.unit_abbr}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="sticky bottom-4 mt-8">
            <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-lg backdrop-blur p-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => handleSaveStock(false)}
                    disabled={saving}
                    className="w-full sm:w-auto rounded-2xl border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-700 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'กำลังบันทึก...' : 'บันทึกสต็อก'}
                  </button>
                  <button
                    onClick={handleAddToCart}
                    disabled={submitting}
                    className="w-full sm:w-auto rounded-2xl bg-blue-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'กำลังเพิ่มไปยังตะกร้า...' : 'เพิ่มไปยังตะกร้า'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};
