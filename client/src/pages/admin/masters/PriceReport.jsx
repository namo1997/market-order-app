import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Loading } from '../../../components/common/Loading';
import { DataTable } from '../../../components/common/DataTable';
import { adminAPI } from '../../../api/admin';
import { productsAPI } from '../../../api/products';

const formatPrice = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }
  return `฿${Number(value).toFixed(2)}`;
};

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }
  const num = Number(value);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(`${String(value).split('T')[0]}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('th-TH');
};

const formatDateShort = (value) => {
  if (!value) return '';
  const date = new Date(`${String(value).split('T')[0]}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
};

const getAverage = (values) => {
  if (!values || values.length === 0) return null;
  const sum = values.reduce((acc, value) => acc + Number(value || 0), 0);
  return sum / values.length;
};

const toDateOnlyString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDateMinusDays = (dateString, days) => {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() - days);
  return toDateOnlyString(date);
};

export const PriceReport = () => {
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [showOnlyActual, setShowOnlyActual] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [sortMode, setSortMode] = useState('name_asc');
  const [activeTab, setActiveTab] = useState('review');
  const [alertThresholdPercent, setAlertThresholdPercent] = useState(10);
  const [reviewFilter, setReviewFilter] = useState('all');

  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        const data = await productsAPI.getProductGroups();
        setSuppliers(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error fetching suppliers:', error);
        setSuppliers([]);
      }
    };

    fetchSuppliers();
  }, []);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        setLoading(true);
        const startDate = getDateMinusDays(selectedDate, 29);
        const response = await adminAPI.getPriceReport({
          start: startDate,
          end: selectedDate
        });
        setItems(Array.isArray(response.data) ? response.data : []);
      } catch (error) {
        console.error('Error fetching price report:', error);
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [selectedDate]);

  const reportRows = useMemo(() => {
    const rows = items
      .map((item) => {
        const priceToday =
          item.price_today !== null && item.price_today !== undefined
            ? Number(item.price_today)
            : item.requested_price_today !== null && item.requested_price_today !== undefined
              ? Number(item.requested_price_today)
              : null;
        const lastPrice =
          item.last_actual_price !== null && item.last_actual_price !== undefined
            ? Number(item.last_actual_price)
            : item.last_requested_price !== null && item.last_requested_price !== undefined
              ? Number(item.last_requested_price)
              : null;
        const monthRefPrice =
          item.month_ref_price !== null && item.month_ref_price !== undefined
            ? Number(item.month_ref_price)
            : null;
        const defaultPrice =
          item.default_price !== null && item.default_price !== undefined
            ? Number(item.default_price)
            : null;
        const diff =
          priceToday !== null && monthRefPrice !== null
            ? Number((priceToday - monthRefPrice).toFixed(2))
            : null;
        const diffPercent =
          diff !== null && monthRefPrice !== null && Number(monthRefPrice) !== 0
            ? Number(((diff / Number(monthRefPrice)) * 100).toFixed(2))
            : null;
        const diffFromDefault =
          priceToday !== null && defaultPrice !== null && defaultPrice !== 0
            ? Number(((priceToday - defaultPrice) / defaultPrice * 100).toFixed(2))
            : null;

        let issueType = 'normal';
        if (priceToday === null) issueType = 'missing_today_price';
        else if (Number(priceToday) === 0) issueType = 'zero_today_price';
        else if (diffPercent !== null && diffPercent >= Number(alertThresholdPercent || 0)) {
          issueType = 'high_increase_percent';
        } else if (diffPercent !== null && diffPercent <= -Number(alertThresholdPercent || 0)) {
          issueType = 'high_decrease_percent';
        }

        return {
          id: item.product_id,
          product_name: item.product_name || 'ไม่ระบุสินค้า',
          supplier_name: item.supplier_name || 'ไม่ระบุกลุ่มสินค้า',
          supplier_master_name: item.supplier_master_name || '-',
          supplier_id: item.supplier_id ?? null,
          supplier_ids_csv: item.supplier_ids_csv || '',
          unit_abbr: item.unit_abbr || '',
          default_price: defaultPrice,
          price_today: priceToday,
          price_today_date: item.price_today_date || null,
          month_ref_price: monthRefPrice,
          month_ref_price_date: item.month_ref_price_date || null,
          last_price: lastPrice,
          latest_price_date: item.latest_price_date || null,
          avg_actual_price_30d: item.avg_actual_price_30d ?? null,
          diff,
          diff_percent: diffPercent,
          diff_from_default: diffFromDefault,
          issue_type: issueType
        };
      })
      .filter((row) => {
        if (showOnlyActual && row.price_today === null) return false;
        if (selectedSupplier) {
          const selected = String(selectedSupplier);
          const linkedIds = String(row.supplier_ids_csv || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
          if (!linkedIds.includes(selected) && String(row.supplier_id) !== selected) {
            return false;
          }
        }
        if (!search) return true;
        const term = search.toLowerCase();
        if (row.product_name.toLowerCase().includes(term)) return true;
        if (row.supplier_name.toLowerCase().includes(term)) return true;
        if (row.supplier_master_name.toLowerCase().includes(term)) return true;
        return false;
      });

    const getNumeric = (value, fallback = Number.NEGATIVE_INFINITY) => {
      if (value === null || value === undefined) return fallback;
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    rows.sort((a, b) => {
      switch (sortMode) {
        case 'name_desc':
          return b.product_name.localeCompare(a.product_name, 'th');
        case 'price_today_desc':
          return getNumeric(b.price_today) - getNumeric(a.price_today);
        case 'price_today_asc':
          return getNumeric(a.price_today) - getNumeric(b.price_today);
        case 'diff_desc':
          return getNumeric(b.diff) - getNumeric(a.diff);
        case 'diff_asc':
          return getNumeric(a.diff) - getNumeric(b.diff);
        case 'diff_abs_desc':
          return Math.abs(getNumeric(b.diff, 0)) - Math.abs(getNumeric(a.diff, 0));
        case 'diff_percent_desc':
          return getNumeric(b.diff_percent) - getNumeric(a.diff_percent);
        case 'diff_percent_asc':
          return getNumeric(a.diff_percent) - getNumeric(b.diff_percent);
        case 'last_price_desc':
          return getNumeric(b.last_price) - getNumeric(a.last_price);
        case 'updated_latest':
          return String(b.price_today_date || b.latest_price_date || '').localeCompare(String(a.price_today_date || a.latest_price_date || ''));
        case 'updated_oldest':
          return String(a.price_today_date || a.latest_price_date || '').localeCompare(String(b.price_today_date || b.latest_price_date || ''));
        case 'name_asc':
        default:
          return a.product_name.localeCompare(b.product_name, 'th');
      }
    });

    return rows;
  }, [items, search, showOnlyActual, selectedSupplier, sortMode, alertThresholdPercent]);

  const reviewRows = useMemo(() => {
    const base = reportRows.filter((row) => row.issue_type !== 'normal');
    switch (reviewFilter) {
      case 'missing':
        return base.filter((row) => row.issue_type === 'missing_today_price');
      case 'zero':
        return base.filter((row) => row.issue_type === 'zero_today_price');
      case 'up':
        return base.filter((row) => row.issue_type === 'high_increase_percent');
      case 'down':
        return base.filter((row) => row.issue_type === 'high_decrease_percent');
      default:
        return base;
    }
  }, [reportRows, reviewFilter]);

  const analysis = useMemo(() => {
    const hasDiffPercent = reportRows.filter((row) => row.diff_percent !== null);
    const hasDiffAmount = reportRows.filter((row) => row.diff !== null);
    return {
      topIncreasePercent: [...hasDiffPercent]
        .sort((a, b) => Number(b.diff_percent) - Number(a.diff_percent))
        .slice(0, 20),
      topDecreasePercent: [...hasDiffPercent]
        .sort((a, b) => Number(a.diff_percent) - Number(b.diff_percent))
        .slice(0, 20),
      topIncreaseAmount: [...hasDiffAmount]
        .filter((row) => Number(row.diff) > 0)
        .sort((a, b) => Number(b.diff) - Number(a.diff))
        .slice(0, 20),
      topDecreaseAmount: [...hasDiffAmount]
        .filter((row) => Number(row.diff) < 0)
        .sort((a, b) => Number(a.diff) - Number(b.diff))
        .slice(0, 20)
    };
  }, [reportRows]);

  const summary = useMemo(() => {
    const total = reportRows.length;
    const withActual = reportRows.filter((row) => row.price_today !== null).length;
    const missingActual = total - withActual;
    const avgPrice = getAverage(
      reportRows.map((row) => row.price_today).filter((value) => value !== null)
    );

    const missingTodayPrice = reportRows.filter((row) => row.issue_type === 'missing_today_price').length;
    const zeroTodayPrice = reportRows.filter((row) => row.issue_type === 'zero_today_price').length;
    const highIncrease = reportRows.filter((row) => row.issue_type === 'high_increase_percent').length;
    const highDecrease = reportRows.filter((row) => row.issue_type === 'high_decrease_percent').length;

    return {
      total,
      withActual,
      missingActual,
      avgPrice,
      missingTodayPrice,
      zeroTodayPrice,
      highIncrease,
      highDecrease
    };
  }, [reportRows]);

  const rangeStartDate = getDateMinusDays(selectedDate, 29);

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  const columns = [
    {
      header: 'สินค้า',
      accessor: 'product_name',
      wrap: true,
      render: (row) => (
        <div>
          <p className="font-medium text-gray-900">{row.product_name}</p>
          <p className="text-[11px] text-gray-400">{row.unit_abbr}</p>
        </div>
      )
    },
    {
      header: 'ซัพพลายเออร์',
      accessor: 'supplier_master_name',
      wrap: true,
      render: (row) => (
        <span className="text-xs text-purple-700">{row.supplier_master_name}</span>
      )
    },
    {
      header: 'กลุ่มสินค้า',
      accessor: 'supplier_name',
      wrap: true,
      render: (row) => (
        <span className="text-xs text-gray-600">{row.supplier_name}</span>
      )
    },
    {
      header: 'ราคาตั้ง',
      accessor: 'default_price',
      render: (row) => {
        if (row.default_price === null || row.default_price === 0) return <span className="text-gray-300">-</span>;
        return <span className="text-gray-500">{formatPrice(row.default_price)}</span>;
      }
    },
    {
      header: 'ราคาล่าสุด',
      accessor: 'price_today',
      render: (row) => {
        if (row.price_today === null) return <span className="text-gray-300">ไม่มี</span>;
        const diffDefault = row.diff_from_default;
        return (
          <div>
            <span className="font-semibold text-gray-900">{formatPrice(row.price_today)}</span>
            {row.price_today_date && (
              <p className="text-[10px] text-gray-400">{formatDateShort(row.price_today_date)}</p>
            )}
            {diffDefault !== null && diffDefault !== 0 && (
              <p className={`text-[10px] ${diffDefault > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {diffDefault > 0 ? '+' : ''}{diffDefault.toFixed(1)}% จากราคาตั้ง
              </p>
            )}
          </div>
        );
      }
    },
    {
      header: 'อ้างอิง 1 ด.',
      accessor: 'month_ref_price',
      render: (row) => {
        if (row.month_ref_price === null) return <span className="text-gray-300">-</span>;
        return (
          <div>
            <span className="text-gray-700">{formatPrice(row.month_ref_price)}</span>
            {row.month_ref_price_date && (
              <p className="text-[10px] text-gray-400">{formatDateShort(row.month_ref_price_date)}</p>
            )}
          </div>
        );
      }
    },
    {
      header: 'เฉลี่ย 30 วัน',
      accessor: 'avg_actual_price_30d',
      render: (row) => (
        <span className="text-gray-500">{formatPrice(row.avg_actual_price_30d)}</span>
      )
    },
    {
      header: 'เปลี่ยนแปลง',
      accessor: 'diff',
      render: (row) => {
        if (row.diff === null) return <span className="text-gray-300">-</span>;
        const color = row.diff > 0 ? 'text-amber-600' : row.diff < 0 ? 'text-emerald-600' : 'text-gray-500';
        return (
          <div className={color}>
            <span className="font-medium">{row.diff > 0 ? '+' : ''}{row.diff}</span>
            {row.diff_percent !== null && (
              <p className="text-[11px]">{formatPercent(row.diff_percent)}</p>
            )}
          </div>
        );
      }
    },
    {
      header: 'สถานะ',
      accessor: 'issue_type',
      render: (row) => {
        const mapping = {
          missing_today_price: { text: 'ไม่มีราคา', className: 'bg-gray-100 text-gray-700' },
          zero_today_price: { text: 'ราคา 0', className: 'bg-rose-100 text-rose-700' },
          high_increase_percent: { text: `+${alertThresholdPercent}%`, className: 'bg-amber-100 text-amber-700' },
          high_decrease_percent: { text: `-${alertThresholdPercent}%`, className: 'bg-emerald-100 text-emerald-700' },
          normal: { text: 'ปกติ', className: 'bg-blue-50 text-blue-600' }
        };
        const value = mapping[row.issue_type] || mapping.normal;
        return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${value.className}`}>{value.text}</span>;
      }
    }
  ];

  const analysisColumns = columns.filter((column) =>
    ['product_name', 'supplier_master_name', 'price_today', 'diff'].includes(column.accessor)
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">รายงานราคาสินค้า</h1>
            <p className="text-sm text-gray-500">
              เปรียบเทียบราคาล่าสุด (ณ วันที่เลือก) กับราคาอ้างอิงย้อนหลัง 1 เดือน
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">สิ้นสุด</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">ค้นหา</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="สินค้า / กลุ่ม / ซัพพลายเออร์"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400 w-52"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">กลุ่มสินค้า</label>
              <select
                value={selectedSupplier}
                onChange={(e) => setSelectedSupplier(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">ทั้งหมด</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">เรียงตาม</label>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="name_asc">ชื่อสินค้า A-Z</option>
                <option value="name_desc">ชื่อสินค้า Z-A</option>
                <option value="price_today_desc">ราคาล่าสุด มาก→น้อย</option>
                <option value="price_today_asc">ราคาล่าสุด น้อย→มาก</option>
                <option value="diff_desc">ผลต่าง เพิ่มมากสุด</option>
                <option value="diff_asc">ผลต่าง ลดมากสุด</option>
                <option value="diff_abs_desc">ผลต่าง ผันผวนสูงสุด</option>
                <option value="diff_percent_desc">ผลต่าง (%) เพิ่มมากสุด</option>
                <option value="diff_percent_asc">ผลต่าง (%) ลดมากสุด</option>
                <option value="updated_latest">ราคาล่าสุด ใหม่→เก่า</option>
                <option value="updated_oldest">ราคาล่าสุด เก่า→ใหม่</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">เกณฑ์เตือน %</label>
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={alertThresholdPercent}
                onChange={(e) => setAlertThresholdPercent(Number(e.target.value || 10))}
                className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 pb-1">
              <input
                type="checkbox"
                checked={showOnlyActual}
                onChange={(e) => setShowOnlyActual(e.target.checked)}
                className="accent-blue-600"
              />
              เฉพาะมีราคาจริง
            </label>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            ช่วงข้อมูล: {formatDate(rangeStartDate)} - {formatDate(selectedDate)}
          </p>
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
          <Card className="bg-blue-50 !p-3">
            <div className="text-center">
              <p className="text-gray-600 text-[11px]">สินค้าทั้งหมด</p>
              <p className="text-2xl font-bold text-blue-600">{summary.total}</p>
            </div>
          </Card>
          <Card className="bg-emerald-50 !p-3">
            <div className="text-center">
              <p className="text-gray-600 text-[11px]">มีราคาจริง</p>
              <p className="text-2xl font-bold text-emerald-600">{summary.withActual}</p>
            </div>
          </Card>
          <Card className="bg-amber-50 !p-3">
            <div className="text-center">
              <p className="text-gray-600 text-[11px]">ยังไม่มีราคา</p>
              <p className="text-2xl font-bold text-amber-600">{summary.missingActual}</p>
            </div>
          </Card>
          <Card className="bg-indigo-50 !p-3">
            <div className="text-center">
              <p className="text-gray-600 text-[11px]">ราคาเฉลี่ย</p>
              <p className="text-lg font-bold text-indigo-600">
                {summary.avgPrice === null ? '-' : `฿${summary.avgPrice.toFixed(2)}`}
              </p>
            </div>
          </Card>
          <Card className="bg-amber-50 !p-3">
            <div className="text-center">
              <p className="text-gray-600 text-[11px]">ขึ้นเกิน {alertThresholdPercent}%</p>
              <p className="text-2xl font-bold text-amber-600">{summary.highIncrease}</p>
            </div>
          </Card>
          <Card className="bg-rose-50 !p-3">
            <div className="text-center">
              <p className="text-gray-600 text-[11px]">ลงเกิน {alertThresholdPercent}%</p>
              <p className="text-2xl font-bold text-rose-600">{summary.highDecrease}</p>
            </div>
          </Card>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('review')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${activeTab === 'review' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}
          >
            ต้องเช็ค ({reviewRows.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analysis')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${activeTab === 'analysis' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}
          >
            วิเคราะห์ราคา
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${activeTab === 'all' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}
          >
            ข้อมูลทั้งหมด ({reportRows.length})
          </button>
        </div>

        {activeTab === 'review' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'all', label: 'ทั้งหมด' },
                { key: 'missing', label: 'ไม่มีราคา' },
                { key: 'zero', label: 'ราคาเป็น 0' },
                { key: 'up', label: `ขึ้นเกิน ${alertThresholdPercent}%` },
                { key: 'down', label: `ลงเกิน ${alertThresholdPercent}%` }
              ].map((btn) => (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => setReviewFilter(btn.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${reviewFilter === btn.key ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
            <DataTable columns={columns} data={reviewRows} rowKey="id" showActions={false} />
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card>
              <h3 className="font-semibold text-gray-900 mb-3">Top ราคาเพิ่ม (%)</h3>
              <DataTable columns={analysisColumns} data={analysis.topIncreasePercent} rowKey="id" showActions={false} dense />
            </Card>
            <Card>
              <h3 className="font-semibold text-gray-900 mb-3">Top ราคาลด (%)</h3>
              <DataTable columns={analysisColumns} data={analysis.topDecreasePercent} rowKey="id" showActions={false} dense />
            </Card>
            <Card>
              <h3 className="font-semibold text-gray-900 mb-3">Top ราคาเพิ่ม (บาท)</h3>
              <DataTable columns={analysisColumns} data={analysis.topIncreaseAmount} rowKey="id" showActions={false} dense />
            </Card>
            <Card>
              <h3 className="font-semibold text-gray-900 mb-3">Top ราคาลด (บาท)</h3>
              <DataTable columns={analysisColumns} data={analysis.topDecreaseAmount} rowKey="id" showActions={false} dense />
            </Card>
          </div>
        )}

        {activeTab === 'all' && (
          <DataTable columns={columns} data={reportRows} rowKey="id" showActions={false} />
        )}
      </div>
    </Layout>
  );
};
