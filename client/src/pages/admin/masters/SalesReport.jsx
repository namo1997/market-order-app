import { useEffect, useMemo, useState, useRef } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Input } from '../../../components/common/Input';
import { Select } from '../../../components/common/Select';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { reportsAPI } from '../../../api/reports';
import { masterAPI } from '../../../api/master';
import { productsAPI } from '../../../api/products';
import { aiAPI } from '../../../api/ai';

export const SalesReport = () => {
  const formatDateInput = (date) => {
    const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return offsetDate.toISOString().split('T')[0];
  };

  const today = formatDateInput(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');

  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [report, setReport] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [loading, setLoading] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    fetchBranches();
    fetchProducts();
    handleLoadReport();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchInputRef.current && !searchInputRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchBranches = async () => {
    try {
      const data = await masterAPI.getBranches();
      setBranches(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching branches:', error);
      setBranches([]);
    }
  }


  const fetchProducts = async () => {
    try {
      const response = await productsAPI.getProducts();
      setAllProducts(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const handleLoadReport = async (options = {}) => {
    try {
      setLoading(true);
      const rawSearch = options.search !== undefined ? options.search : search;
      const trimmedSearch = rawSearch.trim();
      const limit = options.limit;
      const response = await reportsAPI.getSalesReport({
        start: options.start || startDate,
        end: options.end || endDate,
        branchId: branchId || undefined,
        search: trimmedSearch || undefined,
        limit: limit || undefined
      });
      const data = response?.data ?? response;
      setReport(data);
      setReport(data);
      setSelectedGroup('');
      if (options.search !== undefined) {
        setSearch(rawSearch);
      }
      setChatMessages([]);
      setChatInput('');
    } catch (error) {
      console.error('Error fetching sales report:', error);
      alert(error.response?.data?.message || 'ไม่สามารถโหลดรายงานยอดขายได้');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const applyQuickRange = (range) => {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);

    if (range === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end = new Date(start);
    } else if (range === 'week') {
      start.setDate(start.getDate() - 6);
    } else if (range === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const nextStart = formatDateInput(start);
    const nextEnd = formatDateInput(end);
    setStartDate(nextStart);
    setEndDate(nextEnd);
    handleLoadReport({ start: nextStart, end: nextEnd });
  };

  const branchOptions = useMemo(
    () =>
      branches.map((branch) => ({
        value: branch.id,
        label: branch.clickhouse_branch_id ? branch.name : `${branch.name} (ไม่มี ClickHouse ID)`
      })),
    [branches]
  );

  const columns = [
    { header: 'เมนู', accessor: 'menu_name', wrap: true },
    { header: 'Barcode', accessor: 'barcode' },
    {
      header: 'จำนวน',
      accessor: 'total_qty',
      render: (row) =>
        Number(row.total_qty || 0).toLocaleString('th-TH', {
          maximumFractionDigits: 2
        })
    },
    {
      header: 'ยอดขาย',
      accessor: 'total_revenue',
      render: (row) =>
        Number(row.total_revenue || 0).toLocaleString('th-TH', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
    }
  ];

  const formatNumber = (value, options = {}) =>
    Number(value || 0).toLocaleString('th-TH', options);

  const totals = useMemo(() => {
    const summary = report?.summary || {};
    return {
      billCount: Number(summary.bill_count || 0),
      totalRevenue: Number(summary.total_revenue || 0)
    };
  }, [report]);

  const menuItems = useMemo(() => report?.items || [], [report]);

  const groupedMenuItems = useMemo(
    () =>
      menuItems.filter(
        (item) => item.group_name && String(item.group_name).trim().length > 0
      ),
    [menuItems]
  );

  const filteredMenuItems = useMemo(() => {
    if (selectedGroup) {
      return groupedMenuItems.filter((item) => item.group_name === selectedGroup);
    }
    return groupedMenuItems.length > 0 ? groupedMenuItems : menuItems;
  }, [groupedMenuItems, menuItems, selectedGroup]);



  const reportPayload = useMemo(() => {
    if (!report) return null;
    const items = Array.isArray(report.items) ? report.items : [];
    return {
      start: report.start,
      end: report.end,
      branch_id: report.branch_id,
      summary: report.summary,
      daily: report.daily || [],
      by_branch: report.by_branch || [],
      by_group: report.by_group || [],
      items: items.map((item) => ({
        menu_name: item.menu_name,
        barcode: item.barcode,
        total_qty: item.total_qty,
        total_revenue: item.total_revenue,
        group_name: item.group_name
      }))
    };
  }, [report]);
  const canChat = Boolean(reportPayload);

  const handleChatSubmit = async () => {
    if (!reportPayload) {
      alert('กรุณาโหลดรายงานก่อน');
      return;
    }
    const question = chatInput.trim();
    if (!question) return;

    const nextMessages = [...chatMessages, { role: 'user', content: question }];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatLoading(true);

    try {
      const response = await aiAPI.chatSalesReport({
        question,
        report: reportPayload
      });
      const answer = response?.answer || 'ไม่พบข้อมูลในรายงาน';
      setChatMessages([...nextMessages, { role: 'assistant', content: answer }]);
    } catch (error) {
      console.error('AI chat error:', error);
      alert(error.response?.data?.message || 'ไม่สามารถเรียก AI ได้');
    } finally {
      setChatLoading(false);
    }
  };

  const showGroupFallbackNote =
    groupedMenuItems.length === 0 && menuItems.length > 0;

  const summaryCards = useMemo(() => {
    const menuCount = report?.items?.length || 0;
    const averagePerBill = totals.billCount ? totals.totalRevenue / totals.billCount : 0;
    return [
      {
        label: 'ยอดขายรวม',
        value: `${formatNumber(totals.totalRevenue, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })} บาท`
      },
      {
        label: 'จำนวนบิล',
        value: formatNumber(totals.billCount)
      },
      {
        label: 'จำนวนเมนู',
        value: formatNumber(menuCount)
      },
      {
        label: 'ยอดเฉลี่ยต่อบิล',
        value: `${formatNumber(averagePerBill, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })} บาท`
      }
    ];
  }, [report, totals.billCount, totals.totalRevenue]);

  const topRevenue = useMemo(() => {
    return filteredMenuItems.slice(0, 5);
  }, [filteredMenuItems]);

  const topQuantity = useMemo(() => {
    return [...filteredMenuItems]
      .sort((a, b) => Number(b.total_qty || 0) - Number(a.total_qty || 0))
      .slice(0, 5);
  }, [filteredMenuItems]);

  const dailySeries = useMemo(() => {
    return report?.daily || [];
  }, [report]);

  const maxDailyRevenue = useMemo(() => {
    return dailySeries.reduce((max, item) => Math.max(max, Number(item.total_revenue || 0)), 0);
  }, [dailySeries]);

  const branchMap = useMemo(() => {
    const map = new Map();
    branches.forEach((branch) => {
      if (branch.clickhouse_branch_id) {
        map.set(branch.clickhouse_branch_id, branch.name);
      }
    });
    return map;
  }, [branches]);

  const branchSeries = useMemo(() => {
    return report?.by_branch || [];
  }, [report]);

  const groupSeries = useMemo(() => {
    return report?.by_group || [];
  }, [report]);

  const groupColumns = [
    { header: 'กลุ่มสินค้า', accessor: 'group_name', wrap: true },
    {
      header: 'จำนวน',
      accessor: 'total_qty',
      render: (row) =>
        Number(row.total_qty || 0).toLocaleString('th-TH', {
          maximumFractionDigits: 2
        })
    },
    {
      header: 'ยอดขาย',
      accessor: 'total_revenue',
      render: (row) =>
        Number(row.total_revenue || 0).toLocaleString('th-TH', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
    }
  ];

  const handleSelectGroup = (groupName) => {
    setSelectedGroup(groupName);
  };

  const suggestions = useMemo(() => {
    if (!search.trim() || !allProducts.length) return [];
    const query = search.trim().toLowerCase();
    return allProducts
      .filter(p => p.name.toLowerCase().includes(query) || (p.barcode && p.barcode.includes(query)))
      .slice(0, 10);
  }, [search, allProducts]);

  const handleSelectSuggestion = (productName) => {
    setSearch(productName);
    setShowSuggestions(false);
    // Optional: Auto-trigger search or just focus
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-3">
          <BackToSettings />
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">รายงานยอดขาย</h1>
          <p className="text-sm text-gray-500 mt-1">
            ดูยอดขายจาก ClickHouse และค้นหาเมนูที่ต้องการ
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Input
              label="วันที่เริ่มต้น"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="วันที่สิ้นสุด"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <Select
              label="สาขา"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={branchOptions}
              placeholder="รวมทุกสาขา"
            />
            <div className="relative" ref={searchInputRef}>
              <Input
                label="ค้นหาเมนู"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="ชื่อเมนูหรือ barcode"
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                  {suggestions.map((product) => (
                    <div
                      key={product.id}
                      className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                      onClick={() => handleSelectSuggestion(product.name)}
                    >
                      <div className="font-medium text-gray-900">{product.name}</div>
                      {product.barcode && (
                        <div className="text-xs text-gray-500">{product.barcode}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-end">
              <button
                onClick={handleLoadReport}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {loading ? 'กำลังโหลด...' : 'โหลดรายงาน'}
              </button>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">ทางลัดช่วงเวลา</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'today', label: 'วันนี้' },
                { id: 'yesterday', label: 'เมื่อวาน' },
                { id: 'week', label: 'สัปดาห์นี้' },
                { id: 'month', label: 'เดือนนี้' }
              ].map((shortcut) => (
                <button
                  key={shortcut.id}
                  type="button"
                  onClick={() => applyQuickRange(shortcut.id)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {report && (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {summaryCards.map((card) => (
                <div key={card.label} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs text-gray-500">{card.label}</p>
                  <p className="text-xl font-semibold text-gray-900">{card.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              <div className="rounded-lg border border-gray-200 p-4 lg:col-span-2">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">ยอดขายรายวัน</h2>
                {dailySeries.length === 0 ? (
                  <p className="text-sm text-gray-500">ไม่มีข้อมูลรายวัน</p>
                ) : (
                  <div className="space-y-2">
                    {dailySeries.map((item) => {
                      const revenue = Number(item.total_revenue || 0);
                      const width = maxDailyRevenue ? (revenue / maxDailyRevenue) * 100 : 0;
                      return (
                        <div key={item.sale_date} className="flex items-center gap-3">
                          <div className="w-24 text-xs text-gray-500">{item.sale_date}</div>
                          <div className="flex-1">
                            <div className="h-2 rounded-full bg-gray-100">
                              <div
                                className="h-2 rounded-full bg-blue-500"
                                style={{ width: `${Math.max(width, 2)}%` }}
                              />
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 w-24 text-right">
                            {formatNumber(revenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">ยอดขายตามสาขา</h2>
                {branchSeries.length === 0 ? (
                  <p className="text-sm text-gray-500">ไม่มีข้อมูลสาขา</p>
                ) : (
                  <div className="space-y-2">
                    {branchSeries.map((item) => (
                      <div key={item.branch_id} className="border rounded-lg px-3 py-2 text-sm">
                        <div className="font-medium text-gray-900">
                          {branchMap.get(item.branch_id) || item.branch_id || 'ไม่ระบุสาขา'}
                        </div>
                        <div className="text-xs text-gray-500">
                          ยอดขาย {formatNumber(item.total_revenue, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}{' '}
                          บาท • {formatNumber(item.bill_count)} บิล
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div className="rounded-lg border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">เมนูยอดขายสูงสุด</h2>
                {topRevenue.length === 0 ? (
                  <p className="text-sm text-gray-500">ไม่มีข้อมูลเมนู</p>
                ) : (
                  <div className="space-y-2">
                    {topRevenue.map((item) => (
                      <div key={item.barcode} className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{item.menu_name}</p>
                          <p className="text-xs text-gray-500">{item.barcode}</p>
                        </div>
                        <div className="text-right text-gray-700">
                          {formatNumber(item.total_revenue, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}{' '}
                          บาท
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">เมนูขายดีตามจำนวน</h2>
                {topQuantity.length === 0 ? (
                  <p className="text-sm text-gray-500">ไม่มีข้อมูลเมนู</p>
                ) : (
                  <div className="space-y-2">
                    {topQuantity.map((item) => (
                      <div key={item.barcode} className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{item.menu_name}</p>
                          <p className="text-xs text-gray-500">{item.barcode}</p>
                        </div>
                        <div className="text-right text-gray-700">
                          {formatNumber(item.total_qty, { maximumFractionDigits: 2 })} หน่วย
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-4 mb-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">ยอดขายตามกลุ่มสินค้า</h2>
              {groupSeries.length === 0 ? (
                <p className="text-sm text-gray-500">ไม่มีข้อมูลกลุ่มสินค้า</p>
              ) : (
                <DataTable
                  columns={groupColumns}
                  data={groupSeries}
                  rowKey="group_name"
                  renderActions={(row) => (
                    <button
                      type="button"
                      onClick={() => handleSelectGroup(row.group_name)}
                      className="text-sm text-blue-600 hover:text-blue-900"
                    >
                      ดูรายการ
                    </button>
                  )}
                />
              )}
            </div>
            {selectedGroup && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                กำลังดูเฉพาะกลุ่ม: <span className="font-semibold">{selectedGroup}</span>
                <button
                  type="button"
                  onClick={() => setSelectedGroup('')}
                  className="ml-2 text-xs text-blue-600 underline"
                >
                  แสดงทั้งหมด
                </button>
              </div>
            )}
            {showGroupFallbackNote && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ไม่มีเมนูที่ถูกจัดกลุ่มในช่วงวันที่นี้ จึงแสดงเมนูทั้งหมดแทน
              </div>
            )}

            <DataTable
              columns={columns}
              data={filteredMenuItems}
              rowKey="barcode"
              renderActions={() => <span className="text-xs text-gray-300">-</span>}
            />
          </div>
        )}
      </div>

      <div className="fixed bottom-4 right-4 z-40">
        {chatOpen ? (
          <div className="w-80 rounded-2xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">AI รายงานยอดขาย</p>
                <p className="text-xs text-gray-500">ใช้ข้อมูลจากรายงานที่โหลดไว้</p>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="px-4 py-3 text-xs">
              {!canChat && (
                <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                  โหลดรายงานก่อนใช้งาน
                </div>
              )}
              <div className="mb-2 flex flex-wrap gap-2">
                {[
                  'เมนูเกี่ยวกับปลา ขายได้กี่จาน',
                  'ยอดขายรวมเท่าไร',
                  'เมนูขายดี 5 อันดับแรก'
                ].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setChatInput(example)}
                    disabled={!canChat}
                    className="rounded-full border border-gray-200 px-3 py-1 text-gray-600 hover:border-blue-200 hover:text-blue-700 disabled:text-gray-300 disabled:border-gray-200"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-sm">
                {chatMessages.length === 0 ? (
                  <p className="text-gray-500">ลองถามคำถามเกี่ยวกับยอดขายหรือเมนูได้เลย</p>
                ) : (
                  chatMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`rounded-lg px-3 py-2 ${message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-800 border border-gray-200'
                        }`}
                    >
                      {message.content}
                    </div>
                  ))
                )}
                {chatLoading && (
                  <p className="text-xs text-gray-400">กำลังคิดคำตอบ...</p>
                )}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="พิมพ์คำถาม"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                  disabled={!canChat}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleChatSubmit();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleChatSubmit}
                  disabled={!canChat || chatLoading}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
                >
                  ส่งคำถาม
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-blue-700"
          >
            🤖 ถาม AI
          </button>
        )}
      </div>
    </Layout>
  );
};
