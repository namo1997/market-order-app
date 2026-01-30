import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Loading } from '../../../components/common/Loading';
import { DataTable } from '../../../components/common/DataTable';
import { adminAPI } from '../../../api/admin';

const formatNumber = (value) => Number(value || 0).toFixed(2);
const formatCurrency = (value) => `฿${Number(value || 0).toFixed(2)}`;

export const PurchaseReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [groupBy, setGroupBy] = useState('branch');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchReport = async () => {
      try {
        setLoading(true);
        const response = await adminAPI.getPurchaseReport({
          start: startDate,
          end: endDate,
          groupBy
        });
        setRows(Array.isArray(response.data) ? response.data : []);
      } catch (error) {
        console.error('Error fetching purchase report:', error);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [startDate, endDate, groupBy]);

  const filteredRows = useMemo(() => {
    if (!search) return rows;
    const term = search.toLowerCase();
    return rows.filter((row) => {
      const values = [
        row.group_name,
        row.branch_name,
        row.department_name,
        row.supplier_name
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      return values.some((value) => value.includes(term));
    });
  }, [rows, search]);

  const summary = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.total_amount += Number(row.total_amount || 0);
        acc.total_quantity += Number(row.total_quantity || 0);
        acc.item_count += Number(row.item_count || 0);
        acc.missing_actual_count += Number(row.missing_actual_count || 0);
        return acc;
      },
      {
        total_amount: 0,
        total_quantity: 0,
        item_count: 0,
        missing_actual_count: 0
      }
    );
  }, [filteredRows]);

  const viewOptions = [
    { id: 'branch', label: 'รวมสาขา' },
    { id: 'department', label: 'รวมแผนก' },
    { id: 'branch_department', label: 'สาขา/แผนก' },
    { id: 'supplier', label: 'รวมซัพพลายเออร์' },
    { id: 'product', label: 'รวมสินค้า' }
  ];

  const columnsByGroup = {
    branch: [
      { header: 'สาขา', accessor: 'group_name', wrap: true },
      { header: 'จำนวนรายการ', accessor: 'item_count' },
      { header: 'ปริมาณรวม', accessor: 'total_quantity', render: (row) => formatNumber(row.total_quantity) },
      { header: 'ยอดซื้อรวม', accessor: 'total_amount', render: (row) => formatCurrency(row.total_amount) },
      { header: 'ยังไม่มีราคาจริง', accessor: 'missing_actual_count' }
    ],
    department: [
      { header: 'แผนก', accessor: 'group_name', wrap: true },
      { header: 'สาขา', accessor: 'branch_name', wrap: true },
      { header: 'จำนวนรายการ', accessor: 'item_count' },
      { header: 'ยอดซื้อรวม', accessor: 'total_amount', render: (row) => formatCurrency(row.total_amount) },
      { header: 'ยังไม่มีราคาจริง', accessor: 'missing_actual_count' }
    ],
    branch_department: [
      { header: 'สาขา', accessor: 'branch_name', wrap: true },
      { header: 'แผนก', accessor: 'department_name', wrap: true },
      { header: 'จำนวนรายการ', accessor: 'item_count' },
      { header: 'ยอดซื้อรวม', accessor: 'total_amount', render: (row) => formatCurrency(row.total_amount) }
    ],
    supplier: [
      { header: 'ซัพพลายเออร์', accessor: 'group_name', wrap: true },
      { header: 'จำนวนรายการ', accessor: 'item_count' },
      { header: 'ปริมาณรวม', accessor: 'total_quantity', render: (row) => formatNumber(row.total_quantity) },
      { header: 'ยอดซื้อรวม', accessor: 'total_amount', render: (row) => formatCurrency(row.total_amount) },
      { header: 'ยังไม่มีราคาจริง', accessor: 'missing_actual_count' }
    ],
    product: [
      { header: 'สินค้า', accessor: 'group_name', wrap: true },
      { header: 'ซัพพลายเออร์', accessor: 'supplier_name', wrap: true },
      { header: 'หน่วย', accessor: 'unit_abbr' },
      { header: 'ปริมาณรวม', accessor: 'total_quantity', render: (row) => formatNumber(row.total_quantity) },
      { header: 'ยอดซื้อรวม', accessor: 'total_amount', render: (row) => formatCurrency(row.total_amount) }
    ]
  };

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">รายงานการซื้อของ</h1>
            <p className="text-sm text-gray-500">สรุปค่าใช้จ่ายตามจุดต่างๆ</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">เริ่ม</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">ถึง</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหากลุ่ม/ซัพ/สินค้า"
                className="bg-transparent text-sm text-gray-900 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-blue-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">ยอดซื้อรวม</p>
              <p className="text-2xl font-bold text-blue-600">
                {formatCurrency(summary.total_amount)}
              </p>
            </div>
          </Card>
          <Card className="bg-emerald-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">จำนวนรายการ</p>
              <p className="text-2xl font-bold text-emerald-600">{summary.item_count}</p>
            </div>
          </Card>
          <Card className="bg-amber-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">ปริมาณรวม</p>
              <p className="text-2xl font-bold text-amber-600">
                {formatNumber(summary.total_quantity)}
              </p>
            </div>
          </Card>
          <Card className="bg-rose-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">ยังไม่มีราคาจริง</p>
              <p className="text-2xl font-bold text-rose-600">
                {summary.missing_actual_count}
              </p>
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {viewOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setGroupBy(option.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                groupBy === option.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <DataTable
          columns={columnsByGroup[groupBy]}
          data={filteredRows}
          rowKey={(row) =>
            row.group_id ??
            `${row.branch_id || ''}-${row.department_id || ''}-${row.group_name || ''}`
          }
          showActions={false}
        />
      </div>
    </Layout>
  );
};
