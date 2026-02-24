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

const getAverage = (values) => {
  if (!values || values.length === 0) return null;
  const sum = values.reduce((acc, value) => acc + Number(value || 0), 0);
  return sum / values.length;
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
        const response = await adminAPI.getOrderItems(selectedDate);
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
    const map = new Map();

    items.forEach((item) => {
      const key = item.product_id ?? item.product_name ?? item.order_item_id;
      if (!key) return;

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          product_name: item.product_name || 'ไม่ระบุสินค้า',
          supplier_name: item.supplier_name || 'ไม่ระบุกลุ่มสินค้า',
          supplier_id: item.supplier_id ?? null,
          unit_abbr: item.unit_abbr || '',
          actual_prices: [],
          requested_prices: [],
          last_actual_price: item.last_actual_price ?? null,
          last_requested_price: item.last_requested_price ?? null,
          yesterday_actual_price: item.yesterday_actual_price ?? null,
          default_price: item.default_price ?? null,
          avg_actual_price_30d: item.avg_actual_price_30d ?? null
        });
      }

      const entry = map.get(key);
      if (item.actual_price !== null && item.actual_price !== undefined) {
        entry.actual_prices.push(Number(item.actual_price || 0));
      }
      if (item.requested_price !== null && item.requested_price !== undefined) {
        entry.requested_prices.push(Number(item.requested_price || 0));
      }
      if (entry.last_actual_price === null && item.last_actual_price !== null) {
        entry.last_actual_price = item.last_actual_price;
      }
      if (entry.last_requested_price === null && item.last_requested_price !== null) {
        entry.last_requested_price = item.last_requested_price;
      }
      if (entry.yesterday_actual_price === null && item.yesterday_actual_price !== null) {
        entry.yesterday_actual_price = item.yesterday_actual_price;
      }
      if (entry.default_price === null && item.default_price !== null) {
        entry.default_price = item.default_price;
      }
      if (entry.avg_actual_price_30d === null && item.avg_actual_price_30d !== null) {
        entry.avg_actual_price_30d = item.avg_actual_price_30d;
      }
    });

    return Array.from(map.values())
      .map((entry) => {
        const avgActual = getAverage(entry.actual_prices);
        const avgRequested = getAverage(entry.requested_prices);
        const priceToday = avgActual ?? avgRequested;
        const lastPrice = entry.last_actual_price ?? entry.last_requested_price;
        const yesterdayPrice = entry.yesterday_actual_price;
        const diff =
          priceToday !== null && yesterdayPrice !== null
            ? Number((priceToday - Number(yesterdayPrice || 0)).toFixed(2))
            : null;

        return {
          ...entry,
          price_today: priceToday,
          last_price: lastPrice,
          diff,
          default_price: entry.default_price,
          avg_actual_price_30d: entry.avg_actual_price_30d
        };
      })
      .filter((row) => {
        if (showOnlyActual && row.price_today === null) return false;
        if (selectedSupplier && String(row.supplier_id) !== String(selectedSupplier)) {
          return false;
        }
        if (!search) return true;
        const term = search.toLowerCase();
        return (
          row.product_name.toLowerCase().includes(term) ||
          row.supplier_name.toLowerCase().includes(term)
        );
      })
      .sort((a, b) => a.product_name.localeCompare(b.product_name, 'th'));
  }, [items, search, showOnlyActual]);

  const summary = useMemo(() => {
    const total = reportRows.length;
    const withActual = reportRows.filter((row) => row.price_today !== null).length;
    const missingActual = total - withActual;
    const avgPrice = getAverage(
      reportRows.map((row) => row.price_today).filter((value) => value !== null)
    );

    return {
      total,
      withActual,
      missingActual,
      avgPrice
    };
  }, [reportRows]);

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
      wrap: true
    },
    {
      header: 'กลุ่มสินค้า',
      accessor: 'supplier_name',
      wrap: true
    },
    {
      header: 'หน่วย',
      accessor: 'unit_abbr'
    },
    {
      header: 'ราคา ณ วันที่เลือก',
      accessor: 'price_today',
      render: (row) => formatPrice(row.price_today)
    },
    {
      header: 'ราคาเมื่อวาน',
      accessor: 'yesterday_actual_price',
      render: (row) => formatPrice(row.yesterday_actual_price)
    },
    {
      header: 'ราคาล่าสุดในระบบ',
      accessor: 'last_price',
      render: (row) => formatPrice(row.last_price)
    },
    {
      header: 'ราคามาตรฐาน',
      accessor: 'default_price',
      render: (row) => (
        <span className="text-gray-500">{formatPrice(row.default_price)}</span>
      )
    },
    {
      header: 'ราคาเฉลี่ย (30 วัน)',
      accessor: 'avg_actual_price_30d',
      render: (row) => (
        <span className="text-gray-500">{formatPrice(row.avg_actual_price_30d)}</span>
      )
    },
    {
      header: 'เปลี่ยนแปลง',
      accessor: 'diff',
      render: (row) => {
        if (row.diff === null) return '-';
        const color = row.diff > 0 ? 'text-amber-600' : row.diff < 0 ? 'text-emerald-600' : 'text-gray-500';
        const label = row.diff > 0 ? `+${row.diff}` : row.diff;
        return <span className={color}>{label}</span>;
      }
    }
  ];

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">รายงานราคาสินค้า</h1>
            <p className="text-sm text-gray-500">สรุปราคาซื้อจริงที่บันทึกไว้</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">วันที่</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาสินค้า/กลุ่มสินค้า"
                className="bg-transparent text-sm text-gray-900 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">กลุ่มสินค้า</label>
              <select
                value={selectedSupplier}
                onChange={(e) => setSelectedSupplier(e.target.value)}
                className="bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
              >
                <option value="">ทั้งหมด</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showOnlyActual}
                onChange={(e) => setShowOnlyActual(e.target.checked)}
              />
              แสดงเฉพาะราคาจริง
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-blue-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">สินค้าในรายงาน</p>
              <p className="text-3xl font-bold text-blue-600">{summary.total}</p>
            </div>
          </Card>
          <Card className="bg-emerald-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">มีราคาจริง</p>
              <p className="text-3xl font-bold text-emerald-600">{summary.withActual}</p>
            </div>
          </Card>
          <Card className="bg-amber-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">ยังไม่มีราคา</p>
              <p className="text-3xl font-bold text-amber-600">{summary.missingActual}</p>
            </div>
          </Card>
          <Card className="bg-indigo-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">ราคาเฉลี่ย</p>
              <p className="text-2xl font-bold text-indigo-600">
                {summary.avgPrice === null ? '-' : `฿${summary.avgPrice.toFixed(2)}`}
              </p>
            </div>
          </Card>
        </div>

        <DataTable columns={columns} data={reportRows} rowKey="id" showActions={false} />
      </div>
    </Layout>
  );
};
