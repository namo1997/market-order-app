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
  const [checkDate, setCheckDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [selectedCategory, setSelectedCategory] = useState('');
  const [dailyRequiredOnly, setDailyRequiredOnly] = useState(true);
  const [branchDepartments, setBranchDepartments] = useState([]);
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkOnlyDailyRequired, setBulkOnlyDailyRequired] = useState(true);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState(new Set());
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
      const [templateData, stockChecks, branchDeptRows] = await Promise.all([
        stockCheckAPI.getMyDepartmentTemplate(),
        stockCheckAPI.getMyDepartmentCheck(checkDate),
        stockCheckAPI.getMyBranchDepartments(checkDate)
      ]);

      setTemplate(templateData || []);

      // Initialize current stock: daily required -> 0, optional -> empty
      const stockObj = {};
      (templateData || []).forEach((item) => {
        stockObj[item.product_id] = item.daily_required ? 0 : '';
      });

      (stockChecks || []).forEach((item) => {
        stockObj[item.product_id] = Number(item.stock_quantity || 0);
      });
      setCurrentStock(stockObj);
      setLockedItemIds(new Set((stockChecks || []).map((item) => item.product_id)));
      const normalizedDepartments = Array.isArray(branchDeptRows) ? branchDeptRows : [];
      setBranchDepartments(normalizedDepartments);
      const defaultSelected = normalizedDepartments
        .filter(
          (dept) =>
            Number(dept.daily_required_count || 0) > 0
            && Number(dept.checked_daily_required_count || 0) < Number(dept.daily_required_count || 0)
        )
        .map((dept) => Number(dept.department_id))
        .filter((id) => Number.isFinite(id));
      setSelectedDepartmentIds(new Set(defaultSelected));
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

  const handleStockChange = (productId, value) => {
    if (value === '') {
      setCurrentStock((prev) => ({
        ...prev,
        [productId]: ''
      }));
      return;
    }

    const numValue = Number(value);
    setCurrentStock((prev) => ({
      ...prev,
      [productId]: Number.isNaN(numValue) ? '' : numValue
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

  const bulkDepartmentRows = useMemo(
    () =>
      (branchDepartments || []).filter(
        (dept) => Number(dept.template_count || 0) > 0
      ),
    [branchDepartments]
  );

  useEffect(() => {
    const validIds = new Set(
      bulkDepartmentRows
        .map((dept) => Number(dept.department_id))
        .filter((id) => Number.isFinite(id))
    );
    setSelectedDepartmentIds((prev) => {
      let changed = false;
      const next = new Set();
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [bulkDepartmentRows]);

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

  const toggleDepartmentSelection = (departmentId) => {
    setSelectedDepartmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(departmentId)) {
        next.delete(departmentId);
      } else {
        next.add(departmentId);
      }
      return next;
    });
  };

  const handleSelectAllDepartments = () => {
    setSelectedDepartmentIds(
      new Set(
        bulkDepartmentRows
          .map((dept) => Number(dept.department_id))
          .filter((id) => Number.isFinite(id))
      )
    );
  };

  const handleClearDepartmentSelection = () => {
    setSelectedDepartmentIds(new Set());
  };

  const handleBulkCheckByBranch = async () => {
    const departmentIds = Array.from(selectedDepartmentIds);
    if (departmentIds.length === 0) {
      alert('กรุณาเลือกแผนกอย่างน้อย 1 แผนก');
      return;
    }

    try {
      setBulkSaving(true);
      await stockCheckAPI.bulkCheckMyBranch(checkDate, departmentIds, bulkOnlyDailyRequired);
      await loadData();
      alert('เช็คสต็อกทั้งสาขาเรียบร้อยแล้ว');
    } catch (error) {
      console.error('Error bulk checking branch stock:', error);
      alert(error.response?.data?.message || 'เช็คสต็อกทั้งสาขาไม่สำเร็จ');
    } finally {
      setBulkSaving(false);
    }
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

  if (template.length === 0) {
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
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </div>
            <h2 className="text-2xl font-semibold text-slate-900 mb-2">
              ยังไม่มีสินค้าประจำหมวด
            </h2>
            <p className="text-slate-600 mb-6">
              กรุณาติดต่อ Admin เพื่อตั้งค่าสินค้าประจำหมวดให้แผนกของคุณ
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

          <div className="mt-6 px-3 sm:px-0 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">สินค้าประจำหมวด</h2>
          </div>

          <div className="mt-3 px-3 sm:px-0">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">เช็คทั้งสาขา (แบ่งแผนก)</p>
                  <p className="text-xs text-slate-500">
                    เลือกแผนกที่ต้องการเช็ค แล้วบันทึกทีเดียวในวันที่ {checkDate}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBulkPanelOpen((prev) => !prev)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {bulkPanelOpen ? 'ซ่อนแผงแผนก' : 'เปิดแผงแผนก'}
                </button>
              </div>

              {bulkPanelOpen && (
                <div className="mt-3 border-t border-slate-100 pt-3 space-y-3">
                  <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={bulkOnlyDailyRequired}
                      onChange={(e) => setBulkOnlyDailyRequired(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    เช็คเฉพาะรายการที่ต้องกรอกทุกวัน
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAllDepartments}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      เลือกทุกแผนก
                    </button>
                    <button
                      type="button"
                      onClick={handleClearDepartmentSelection}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      ล้างที่เลือก
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkCheckByBranch}
                      disabled={bulkSaving || selectedDepartmentIds.size === 0}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {bulkSaving ? 'กำลังเช็คทั้งสาขา...' : `เช็คที่เลือก (${selectedDepartmentIds.size})`}
                    </button>
                  </div>

                  {bulkDepartmentRows.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                      ยังไม่มีแผนกที่ตั้งค่าสินค้าสำหรับเช็คสต็อก
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {bulkDepartmentRows.map((dept) => {
                        const departmentId = Number(dept.department_id);
                        const selected = selectedDepartmentIds.has(departmentId);
                        const dailyRequiredCount = Number(dept.daily_required_count || 0);
                        const checkedDailyRequiredCount = Number(
                          dept.checked_daily_required_count || 0
                        );
                        const pendingDailyRequired = Math.max(
                          dailyRequiredCount - checkedDailyRequiredCount,
                          0
                        );
                        return (
                          <label
                            key={departmentId}
                            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                          >
                            <span className="inline-flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleDepartmentSelection(departmentId)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm font-semibold text-slate-800 truncate">
                                {dept.department_name}
                              </span>
                            </span>
                            <span className="text-xs text-slate-500 text-right">
                              ต้องกรอกทุกวัน {checkedDailyRequiredCount}/{dailyRequiredCount} • ค้าง {pendingDailyRequired}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 px-3 sm:px-0">
            <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">
              <input
                type="checkbox"
                checked={!dailyRequiredOnly}
                onChange={(e) => setDailyRequiredOnly(!e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              แสดงทั้งหมด
            </label>
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
                                      กรอกทุกวัน
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
                                  type="number"
                                  value={stockValue}
                                  onChange={(e) =>
                                    handleStockChange(item.product_id, e.target.value)
                                  }
                                  onFocus={(e) => e.target.select()}
                                  inputMode="decimal"
                                  className="w-12 rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-xs font-semibold text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-blue-300"
                                />
                                <span className="text-xs text-slate-500">{item.unit_abbr}</span>
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
                                      กรอกทุกวัน
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
                                  type="number"
                                  value={stockValue}
                                  inputMode="decimal"
                                  disabled
                                  className="w-12 rounded-lg border border-gray-200 bg-gray-100 px-1.5 py-1 text-xs font-semibold text-slate-500 text-right focus:outline-none"
                                />
                                <span className="text-xs text-slate-500">{item.unit_abbr}</span>
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

        </div>
      </div>
    </Layout>
  );
};
