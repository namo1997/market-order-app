import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { stockCheckAPI } from '../../api/stock-check';
import { Layout } from '../../components/layout/Layout';

export const StockCheck = () => {
  const navigate = useNavigate();

  const [template, setTemplate] = useState([]);
  const [currentStock, setCurrentStock] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingItemId, setSavingItemId] = useState(null);
  const [lockedItemIds, setLockedItemIds] = useState(new Set());
  const [isDisabled, setIsDisabled] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [checkDate, setCheckDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [selectedCategory, setSelectedCategory] = useState('');
  const [dailyRequiredOnly, setDailyRequiredOnly] = useState(true);
  const [activeTab, setActiveTab] = useState('check');
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyStartDate, setHistoryStartDate] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return start.toISOString().split('T')[0];
  });
  const [historyEndDate, setHistoryEndDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const pageStyle = {
    fontFamily: '"Sarabun", "Noto Sans Thai", "Noto Sans", sans-serif'
  };

  useEffect(() => {
    loadData();
  }, [checkDate]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    loadHistory();
  }, [activeTab, historyStartDate, historyEndDate]);

  const loadData = async () => {
    try {
      setLoading(true);
      setIsDisabled(false);
      const [templateData, stockChecks] = await Promise.all([
        stockCheckAPI.getMyDepartmentTemplate(),
        stockCheckAPI.getMyDepartmentCheck(checkDate)
      ]);

      setTemplate(templateData || []);

      // Initialize current stock: high-value item -> 0, optional -> empty
      const stockObj = {};
      (templateData || []).forEach((item) => {
        stockObj[item.product_id] = item.daily_required ? '0' : '';
      });

      (stockChecks || []).forEach((item) => {
        stockObj[item.product_id] = String(Number(item.stock_quantity || 0));
      });
      setCurrentStock(stockObj);
      setLockedItemIds(new Set((stockChecks || []).map((item) => item.product_id)));
    } catch (error) {
      console.error('Error fetching template:', error);
      if (error.response?.status === 403) {
        setIsDisabled(true);
        return;
      }
      alert('ไม่สามารถโหลดสินค้าประจำหมวดได้');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);
      const historyData = await stockCheckAPI.getMyDepartmentCheckHistory(
        historyStartDate,
        historyEndDate,
        1000
      );
      setHistoryItems(historyData || []);
    } catch (error) {
      console.error('Error fetching stock check history:', error);
      alert('ไม่สามารถโหลดประวัติการเช็คสต็อกได้');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleStockChange = (productId, value) => {
    if (value === '') {
      setCurrentStock((prev) => ({
        ...prev,
        [productId]: ''
      }));
      return;
    }

    const cleaned = String(value)
      .replace(',', '.')
      .replace(/[^0-9.]/g, '')
      .replace(/(\..*?)\..*/g, '$1');

    if (cleaned === '') {
      setCurrentStock((prev) => ({
        ...prev,
        [productId]: ''
      }));
      return;
    }

    setCurrentStock((prev) => ({
      ...prev,
      [productId]: cleaned
    }));
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
    const categoryFiltered = !selectedCategory
      ? groupedTemplate
      : groupedTemplate.filter((group) => group.key === selectedCategory);

    if (!dailyRequiredOnly) return categoryFiltered;

    return categoryFiltered
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.daily_required)
      }))
      .filter((group) => group.items.length > 0);
  }, [groupedTemplate, selectedCategory, dailyRequiredOnly]);

  const { unsavedGroups, savedGroups, unsavedCount, savedCount } = useMemo(() => {
    const unsaved = [];
    const saved = [];

    filteredGroups.forEach((group) => {
      const unsavedItems = group.items.filter(
        (item) => !lockedItemIds.has(item.product_id)
      );
      const savedItems = group.items.filter((item) => lockedItemIds.has(item.product_id));

      if (unsavedItems.length > 0) {
        unsaved.push({
          ...group,
          items: unsavedItems
        });
      }

      if (savedItems.length > 0) {
        saved.push({
          ...group,
          items: savedItems
        });
      }
    });

    return {
      unsavedGroups: unsaved,
      savedGroups: saved,
      unsavedCount: unsaved.reduce((sum, group) => sum + group.items.length, 0),
      savedCount: saved.reduce((sum, group) => sum + group.items.length, 0)
    };
  }, [filteredGroups, lockedItemIds]);

  const groupedHistory = useMemo(() => {
    const groups = new Map();
    (historyItems || []).forEach((item) => {
      const key = String(item.check_date || '').slice(0, 10);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(item);
    });
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [historyItems]);

  useEffect(() => {
    if (!selectedCategory) return;
    const exists = groupedTemplate.some((group) => group.key === selectedCategory);
    if (!exists) {
      setSelectedCategory('');
    }
  }, [groupedTemplate, selectedCategory]);

  const handleSaveSingleItem = async (item) => {
    const currentValue = currentStock[item.product_id];
    if ((currentValue === '' || currentValue === null) && !item.daily_required) {
      alert('กรุณากรอกจำนวนก่อนบันทึกรายการนี้');
      return;
    }

    try {
      setSavingItemId(item.product_id);
      await stockCheckAPI.saveMyDepartmentCheck(checkDate, [
        {
          product_id: item.product_id,
          stock_quantity: Number(currentValue || 0)
        }
      ]);
      setLockedItemIds((prev) => {
        const next = new Set(prev);
        next.add(item.product_id);
        return next;
      });
    } catch (error) {
      console.error('Error saving stock item:', error);
      alert('บันทึกรายการไม่สำเร็จ');
    } finally {
      setSavingItemId(null);
    }
  };

  const handleEditSingleItem = (item) => {
    setLockedItemIds((prev) => {
      const next = new Set(prev);
      next.delete(item.product_id);
      return next;
    });
  };

  const handleClearAllByDate = async () => {
    const confirmed = confirm(`ต้องการยกเลิกการบันทึกการเช็คทั้งหมดของวันที่ ${checkDate} ใช่หรือไม่?`);
    if (!confirmed) return;

    try {
      setClearingAll(true);
      await stockCheckAPI.clearMyDepartmentCheck(checkDate);
      await loadData();
      alert('ยกเลิกการบันทึกทั้งหมดเรียบร้อย');
    } catch (error) {
      console.error('Error clearing stock checks:', error);
      alert(error.response?.data?.message || 'ยกเลิกการบันทึกไม่สำเร็จ');
    } finally {
      setClearingAll(false);
    }
  };

  const formatDateThai = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('th-TH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatDateTimeThai = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('th-TH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#F5F5F7]" style={pageStyle}>
          <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-16 text-center animate-fade-in">
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
          <div className="max-w-5xl mx-auto w-full text-center py-16 px-4 sm:px-6 animate-fade-in">
            <div className="text-left mb-6">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="text-sm font-semibold text-blue-600 hover:text-blue-700"
              >
                &lt;- ย้อนกลับ
              </button>
            </div>
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

  return (
    <Layout>
      <div className="min-h-screen bg-[#F5F5F7]" style={pageStyle}>
        <div className="max-w-5xl mx-auto w-full px-0 sm:px-6 py-4 sm:py-8">
          <div className="px-3 sm:px-0 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between animate-fade-slide-up">
            <div>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="mb-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
              >
                &lt;- ย้อนกลับ
              </button>
              <h1 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight">
                เช็คสต็อกสินค้า
              </h1>
              <div className="mt-3 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setActiveTab('check')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    activeTab === 'check'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  เช็คสต็อก
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    activeTab === 'history'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  ประวัติการเช็คสต็อก
                </button>
              </div>
            </div>
            {activeTab === 'check' && (
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
            )}
          </div>

          {activeTab === 'check' ? (
            <>
              <div className="mt-6 px-3 sm:px-0 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">สินค้าประจำหมวด</h2>
              </div>

              <div className="mt-3 px-3 sm:px-0">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">
                    <input
                      type="checkbox"
                      checked={!dailyRequiredOnly}
                      onChange={(e) => setDailyRequiredOnly(!e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    แสดงสินค้าทั้งหมด
                  </label>
                  <button
                    type="button"
                    onClick={handleClearAllByDate}
                    disabled={clearingAll || lockedItemIds.size === 0}
                    className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {clearingAll ? 'กำลังยกเลิก...' : 'ยกเลิกการบันทึกการเช็คทั้งหมด'}
                  </button>
                </div>
              </div>

              {groupedTemplate.length > 1 && (
                <div className="mt-3 px-3 sm:px-0">
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

              <div className="mt-4 space-y-6">
                <div className="space-y-4">
                  <div className="px-3 sm:px-0 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700">รายการที่ยังไม่บันทึก</h3>
                    <span className="text-xs font-semibold text-slate-500">{unsavedCount} รายการ</span>
                  </div>

                  {unsavedGroups.length === 0 ? (
                    <div className="mx-3 sm:mx-0 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500 shadow-sm">
                      ไม่มีรายการที่รอบันทึก
                    </div>
                  ) : (
                    unsavedGroups.map((group, groupIndex) => (
                      <div
                        key={`unsaved-${group.key}`}
                        className="rounded-none sm:rounded-lg border-y border-gray-200 sm:border bg-white overflow-hidden shadow-none sm:shadow-sm"
                      >
                        <div className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50">
                          {group.name}
                        </div>
                        <div className="divide-y">
                          {group.items.map((item, index) => {
                            const stock = currentStock[item.product_id];
                            const isMissing =
                              (stock === '' || stock === null || stock === undefined) &&
                              !item.daily_required;
                            const stockValue = stock === '' ? '' : stock ?? 0;

                            return (
                              <div
                                key={item.id}
                                className="animate-fade-slide-up"
                                style={{ animationDelay: `${120 + (groupIndex * 6 + index) * 30}ms` }}
                              >
                                <div className="flex items-center gap-2 px-3 py-2 text-sm">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-slate-900 whitespace-normal break-words">
                                      {item.product_name}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                                      {item.daily_required && (
                                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                          มูลค่าสูง
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0">
                                    <span
                                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                        isMissing
                                          ? 'bg-slate-100 text-slate-500'
                                          : 'bg-emerald-100 text-emerald-700'
                                      }`}
                                    >
                                      {isMissing ? 'ยังไม่กรอก' : 'กรอกแล้ว'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                                    <input
                                      type="text"
                                      value={stockValue}
                                      onChange={(e) =>
                                        handleStockChange(item.product_id, e.target.value)
                                      }
                                      onFocus={(e) => e.target.select()}
                                      inputMode="decimal"
                                      pattern="[0-9]*[.,]?[0-9]*"
                                      autoComplete="off"
                                      enterKeyHint="done"
                                      className="w-12 rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-xs font-semibold text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-blue-300"
                                    />
                                    <span className="text-xs text-slate-500">{item.unit_name || item.unit_abbr}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveSingleItem(item)}
                                      disabled={savingItemId === item.product_id}
                                      className={`h-8 w-8 flex items-center justify-center rounded-lg border text-green-600 ${
                                        savingItemId === item.product_id
                                          ? 'border-gray-200 bg-gray-100 text-gray-400'
                                          : 'border-gray-200 hover:bg-green-50'
                                      }`}
                                      title="บันทึกรายการนี้"
                                    >
                                      {savingItemId === item.product_id ? '...' : '✓'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-4">
                  <div className="px-3 sm:px-0 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700">บันทึกแล้ว</h3>
                    <span className="text-xs font-semibold text-slate-500">{savedCount} รายการ</span>
                  </div>

                  {savedGroups.length === 0 ? (
                    <div className="mx-3 sm:mx-0 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500 shadow-sm">
                      ยังไม่มีรายการที่บันทึกแล้ว
                    </div>
                  ) : (
                    savedGroups.map((group) => (
                      <div
                        key={`saved-${group.key}`}
                        className="rounded-none sm:rounded-lg border-y border-gray-200 sm:border bg-white overflow-hidden shadow-none sm:shadow-sm"
                      >
                        <div className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50">
                          {group.name}
                        </div>
                        <div className="divide-y">
                          {group.items.map((item) => {
                            const stock = currentStock[item.product_id];
                            const stockValue = stock === '' ? '' : stock ?? 0;

                            return (
                              <div key={item.id}>
                                <div className="flex items-center gap-2 px-3 py-2 text-sm">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-slate-900 whitespace-normal break-words">
                                      {item.product_name}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                                      {item.daily_required && (
                                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                          มูลค่าสูง
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0">
                                    <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-700">
                                      บันทึกแล้ว
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                                    <input
                                      type="text"
                                      value={stockValue}
                                      inputMode="decimal"
                                      disabled
                                      className="w-12 rounded-lg border border-gray-200 bg-gray-100 px-1.5 py-1 text-xs font-semibold text-slate-500 text-right focus:outline-none"
                                    />
                                    <span className="text-xs text-slate-500">{item.unit_name || item.unit_abbr}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleEditSingleItem(item)}
                                      className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50"
                                      title="แก้ไขรายการนี้"
                                    >
                                      แก้ไข
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="mt-6 space-y-4 px-3 sm:px-0">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      วันที่เริ่ม
                    </label>
                    <input
                      type="date"
                      value={historyStartDate}
                      onChange={(e) => setHistoryStartDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      วันที่สิ้นสุด
                    </label>
                    <input
                      type="date"
                      value={historyEndDate}
                      onChange={(e) => setHistoryEndDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={loadHistory}
                      disabled={historyLoading}
                      className="w-full rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {historyLoading ? 'กำลังโหลด...' : 'โหลดประวัติ'}
                    </button>
                  </div>
                </div>
              </div>

              {historyLoading ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                  กำลังโหลดประวัติ...
                </div>
              ) : groupedHistory.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                  ไม่พบประวัติการเช็คสต็อกในช่วงวันที่ที่เลือก
                </div>
              ) : (
                groupedHistory.map(([date, items]) => (
                  <div
                    key={date}
                    className="rounded-none sm:rounded-lg border-y border-gray-200 sm:border bg-white overflow-hidden shadow-none sm:shadow-sm"
                  >
                    <div className="flex items-center justify-between bg-slate-50 px-4 py-2">
                      <h3 className="text-sm font-semibold text-slate-800">{formatDateThai(date)}</h3>
                      <span className="text-xs font-semibold text-slate-500">{items.length} รายการ</span>
                    </div>
                    <div className="divide-y">
                      {items.map((item) => (
                        <div key={item.id} className="px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 flex-1 text-sm font-semibold text-slate-900 break-words">
                              {item.product_name || '-'}
                            </p>
                            <p className="shrink-0 text-sm font-semibold text-slate-800">
                              {Number(item.stock_quantity || 0)} {item.unit_name || item.unit_abbr || ''}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            โดย {item.checked_by_name || 'ไม่ระบุผู้บันทึก'} • {formatDateTimeThai(item.checked_at)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>
      </div>
    </Layout>
  );
};
