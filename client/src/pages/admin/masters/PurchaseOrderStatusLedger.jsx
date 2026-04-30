import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { adminAPI } from '../../../api/admin';
import { masterAPI } from '../../../api/master';

const todayLocal = () => {
  const now = new Date();
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return bangkok.toISOString().slice(0, 10);
};

const statusLabels = {
  all: 'ทั้งหมด',
  not_purchased: 'ยังไม่เดินซื้อ',
  missing_price: 'ยังไม่ใส่ราคา',
  not_received: 'ยังไม่รับ',
  short_received: 'รับขาด',
  over_received: 'รับเกิน',
  complete: 'ครบ'
};

const statusStyles = {
  not_purchased: 'bg-gray-100 text-gray-700',
  missing_price: 'bg-amber-100 text-amber-800',
  not_received: 'bg-orange-100 text-orange-800',
  short_received: 'bg-red-100 text-red-700',
  over_received: 'bg-blue-100 text-blue-700',
  complete: 'bg-green-100 text-green-700'
};

const formatQty = (value) => {
  const number = Number(value || 0);
  return number.toLocaleString('th-TH', {
    minimumFractionDigits: number % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });
};

const formatMoney = (value) => {
  const number = Number(value || 0);
  return number.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

export const PurchaseOrderStatusLedger = () => {
  const [date, setDate] = useState(todayLocal());
  const [productGroupId, setProductGroupId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [centralStatus, setCentralStatus] = useState('all');
  const [productGroups, setProductGroups] = useState([]);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const filteredDepartments = useMemo(() => {
    if (!branchId) return departments;
    return departments.filter((department) => String(department.branch_id) === String(branchId));
  }, [branchId, departments]);

  const summaryCards = useMemo(
    () => [
      { key: 'total', label: 'ทั้งหมด', value: summary.total || 0, className: 'bg-slate-50 text-slate-800' },
      { key: 'not_purchased', label: statusLabels.not_purchased, value: summary.not_purchased || 0, className: statusStyles.not_purchased },
      { key: 'missing_price', label: statusLabels.missing_price, value: summary.missing_price || 0, className: statusStyles.missing_price },
      { key: 'not_received', label: statusLabels.not_received, value: summary.not_received || 0, className: statusStyles.not_received },
      { key: 'short_received', label: statusLabels.short_received, value: summary.short_received || 0, className: statusStyles.short_received },
      { key: 'over_received', label: statusLabels.over_received, value: summary.over_received || 0, className: statusStyles.over_received },
      { key: 'complete', label: statusLabels.complete, value: summary.complete || 0, className: statusStyles.complete }
    ],
    [summary]
  );

  const loadMasterData = async () => {
    const [groupRows, branchRows, departmentRows] = await Promise.all([
      masterAPI.getProductGroups(),
      masterAPI.getBranches(),
      masterAPI.getDepartmentsAll()
    ]);
    setProductGroups(groupRows || []);
    setBranches(branchRows || []);
    setDepartments(departmentRows || []);
  };

  const loadLedger = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminAPI.getPurchaseOrderStatusLedger({
        date,
        productGroupId,
        branchId,
        departmentId,
        centralStatus
      });
      setRows(response?.data || []);
      setSummary(response?.summary || { total: 0 });
    } catch (err) {
      console.error('Error loading purchase order status ledger:', err);
      setError('โหลดสถานะกลางคำสั่งซื้อไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMasterData().catch((err) => {
      console.error('Error loading master data:', err);
      setError('โหลดข้อมูลตัวกรองไม่สำเร็จ');
    });
  }, []);

  useEffect(() => {
    loadLedger();
  }, [date, productGroupId, branchId, departmentId, centralStatus]);

  useEffect(() => {
    if (departmentId && !filteredDepartments.some((department) => String(department.id) === String(departmentId))) {
      setDepartmentId('');
    }
  }, [branchId, departmentId, filteredDepartments]);

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-4 space-y-4">
        <BackToSettings />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">สถานะกลางคำสั่งซื้อ</h1>
            <p className="text-sm text-gray-600">
              ตรวจรายการเดียวกันตั้งแต่สั่งซื้อ เดินซื้อ ใส่ราคา และรับสินค้า
            </p>
          </div>
          <Button onClick={loadLedger} disabled={loading}>
            {loading ? 'กำลังโหลด...' : 'รีเฟรช'}
          </Button>
        </div>

        <Card>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">กลุ่มสินค้า</label>
              <select
                value={productGroupId}
                onChange={(event) => setProductGroupId(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                <option value="">ทุกกลุ่ม</option>
                {productGroups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สาขา</label>
              <select
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                <option value="">ทุกสาขา</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">แผนก</label>
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                <option value="">ทุกแผนก</option>
                {filteredDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สถานะ</label>
              <select
                value={centralStatus}
                onChange={(event) => setCentralStatus(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                {Object.entries(statusLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {summaryCards.map((card) => (
            <div key={card.key} className={`rounded-lg px-3 py-3 ${card.className}`}>
              <div className="text-xs font-medium">{card.label}</div>
              <div className="text-2xl font-bold">{card.value}</div>
            </div>
          ))}
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-3 py-3 text-left">สินค้า</th>
                  <th className="px-3 py-3 text-left">กลุ่ม</th>
                  <th className="px-3 py-3 text-left">สาขา/แผนก</th>
                  <th className="px-3 py-3 text-right">สั่ง</th>
                  <th className="px-3 py-3 text-right">ซื้อจริง</th>
                  <th className="px-3 py-3 text-right">รับจริง</th>
                  <th className="px-3 py-3 text-right">ราคา</th>
                  <th className="px-3 py-3 text-left">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.order_item_id} className="hover:bg-gray-50">
                    <td className="px-3 py-3">
                      <div className="font-medium text-gray-900">{row.product_name}</div>
                      <div className="text-xs text-gray-500">{row.order_number}</div>
                    </td>
                    <td className="px-3 py-3 text-gray-700">{row.product_group_name}</td>
                    <td className="px-3 py-3">
                      <div className="text-gray-900">{row.branch_name}</div>
                      <div className="text-xs text-gray-500">{row.department_name}</div>
                    </td>
                    <td className="px-3 py-3 text-right">{formatQty(row.ordered_quantity)} {row.unit_abbr}</td>
                    <td className="px-3 py-3 text-right">{formatQty(row.purchased_quantity)} {row.unit_abbr}</td>
                    <td className="px-3 py-3 text-right">{formatQty(row.received_quantity)} {row.unit_abbr}</td>
                    <td className="px-3 py-3 text-right">
                      {Number(row.actual_price || 0) > 0 ? formatMoney(row.actual_price) : '-'}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusStyles[row.central_status] || 'bg-gray-100 text-gray-700'}`}>
                        {statusLabels[row.central_status] || row.central_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden divide-y divide-gray-100">
            {rows.map((row) => (
              <div key={row.order_item_id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900">{row.product_name}</div>
                    <div className="text-xs text-gray-500">
                      {row.product_group_name} • {row.branch_name} / {row.department_name}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${statusStyles[row.central_status] || 'bg-gray-100 text-gray-700'}`}>
                    {statusLabels[row.central_status] || row.central_status}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">สั่ง</div>
                    <div className="font-semibold">{formatQty(row.ordered_quantity)} {row.unit_abbr}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">ซื้อ</div>
                    <div className="font-semibold">{formatQty(row.purchased_quantity)} {row.unit_abbr}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">รับ</div>
                    <div className="font-semibold">{formatQty(row.received_quantity)} {row.unit_abbr}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">ราคา</div>
                    <div className="font-semibold">{Number(row.actual_price || 0) > 0 ? formatMoney(row.actual_price) : '-'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!loading && rows.length === 0 && (
            <div className="p-8 text-center text-gray-500">ไม่พบรายการตามเงื่อนไข</div>
          )}
          {loading && (
            <div className="p-8 text-center text-gray-500">กำลังโหลดข้อมูล...</div>
          )}
        </Card>
      </div>
    </Layout>
  );
};
