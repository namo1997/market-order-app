import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { inventoryAPI } from '../../api/inventory';
import { masterAPI } from '../../api/master';

export const InventoryDashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const today = new Date().toISOString().split('T')[0];
  const [movementStartDate, setMovementStartDate] = useState(today);
  const [movementEndDate, setMovementEndDate] = useState(today);

  useEffect(() => {
    fetchBranches();
    loadDashboard();
  }, []);

  useEffect(() => {
    if (selectedBranch) {
      fetchDepartments(selectedBranch);
    } else {
      setDepartments([]);
      setSelectedDepartment('');
    }
  }, [selectedBranch]);

  useEffect(() => {
    loadDashboard();
  }, [selectedBranch, selectedDepartment, movementStartDate, movementEndDate]);

  const fetchBranches = async () => {
    try {
      const data = await masterAPI.getBranches();
      setBranches(data || []);
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  };

  const fetchDepartments = async (branchId) => {
    try {
      const data = await masterAPI.getDepartmentsByBranch(branchId);
      setDepartments(data || []);
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const filters = {};
      if (selectedDepartment) filters.departmentId = selectedDepartment;
      else if (selectedBranch) filters.branchId = selectedBranch;
      if (movementStartDate) filters.startDate = movementStartDate;
      if (movementEndDate) filters.endDate = movementEndDate;

      const data = await inventoryAPI.getDashboard(filters);
      setStats(data.stats || {});
      setLowStockItems(data.low_stock_items || []);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      alert('ไม่สามารถโหลดข้อมูลได้');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num) => {
    return Number(num || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  };

  const formatDateThai = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const movementStart = stats?.movement_start_date || movementStartDate;
  const movementEnd = stats?.movement_end_date || movementEndDate;
  const movementItems = Array.isArray(stats?.today_movements) ? stats.today_movements : [];

  const movementEmptyMessage = (() => {
    if (!movementStart && !movementEnd) {
      return 'ยังไม่มีการเคลื่อนไหวในช่วงวันที่ที่เลือก';
    }
    if (movementStart && movementEnd && movementStart === movementEnd) {
      return `ยังไม่มีการเคลื่อนไหวในวันที่ ${formatDateThai(movementStart)}`;
    }
    return `ยังไม่มีการเคลื่อนไหวในช่วง ${formatDateThai(movementStart)} ถึง ${formatDateThai(movementEnd)}`;
  })();

  const getTransactionTypeLabel = (type) => {
    const labels = {
      receive: 'รับเข้า',
      sale: 'ขาย',
      adjustment: 'ปรับปรุง',
      transfer_in: 'โอนเข้า',
      transfer_out: 'โอนออก',
      initial: 'ยอดเริ่มต้น'
    };
    return labels[type] || type;
  };

  const getTransactionTypeColor = (type) => {
    const colors = {
      receive: 'bg-green-100 text-green-700',
      sale: 'bg-red-100 text-red-700',
      adjustment: 'bg-blue-100 text-blue-700',
      transfer_in: 'bg-purple-100 text-purple-700',
      transfer_out: 'bg-orange-100 text-orange-700',
      initial: 'bg-gray-100 text-gray-700'
    };
    return colors[type] || 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-gray-500">กำลังโหลด...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">ระบบคลังสินค้า</h1>
              <p className="text-sm text-gray-500 mt-1">
                ระบบจัดการคลังสินค้าและติดตามสต็อก
              </p>
            </div>
            <Button variant="secondary" onClick={() => navigate('/login')}>
              ← ย้อนกลับ
            </Button>
          </div>

          {/* Filters */}
          <Card className="mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  กรองตามสาขา
                </label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">ทั้งหมด</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  กรองตามแผนก
                </label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={!selectedBranch}
                >
                  <option value="">ทั้งหมด</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ช่วงวันที่เริ่ม
                </label>
                <Input
                  type="date"
                  value={movementStartDate}
                  onChange={(e) => setMovementStartDate(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ช่วงวันที่สิ้นสุด
                </label>
                <Input
                  type="date"
                  value={movementEndDate}
                  onChange={(e) => setMovementEndDate(e.target.value)}
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">จำนวนสินค้าทั้งหมด</p>
                <p className="text-3xl font-bold text-blue-700">
                  {formatNumber(stats?.total_products || 0)}
                </p>
                <p className="text-xs text-gray-500 mt-1">รายการ</p>
              </div>
              <div className="text-blue-500 text-5xl">📦</div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-green-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">ยอดคงเหลือรวม</p>
                <p className="text-3xl font-bold text-green-700">
                  {formatNumber(stats?.total_quantity || 0)}
                </p>
                <p className="text-xs text-gray-500 mt-1">หน่วย</p>
              </div>
              <div className="text-green-500 text-5xl">📊</div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-red-50 to-red-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">สินค้าต่ำกว่า Min</p>
                <p className="text-3xl font-bold text-red-700">
                  {formatNumber(stats?.low_stock_count || 0)}
                </p>
                <p className="text-xs text-gray-500 mt-1">รายการ</p>
              </div>
              <div className="text-red-500 text-5xl">⚠️</div>
            </div>
          </Card>
        </div>

        {/* Movements */}
        <Card className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            การเคลื่อนไหวตามช่วงวันที่
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            ช่วงข้อมูล: {formatDateThai(movementStart)} ถึง {formatDateThai(movementEnd)}
          </p>
          {movementItems.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {movementItems.map((movement) => (
                <div
                  key={movement.transaction_type}
                  className={`rounded-lg p-3 ${getTransactionTypeColor(movement.transaction_type)}`}
                >
                  <p className="text-xs font-medium">
                    {getTransactionTypeLabel(movement.transaction_type)}
                  </p>
                  <p className="text-2xl font-bold mt-1">{movement.count}</p>
                  <p className="text-xs mt-1">
                    {formatNumber(movement.total_quantity)} หน่วย
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">{movementEmptyMessage}</p>
          )}
        </Card>

        {/* Quick Actions */}
        <Card className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">เมนูหลัก</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <button
              onClick={() => navigate('/inventory/balance')}
              className="flex flex-col items-center p-4 rounded-lg border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 transition"
            >
              <span className="text-3xl mb-2">📦</span>
              <span className="text-sm font-semibold text-gray-900">ยอดคงเหลือ</span>
            </button>

            <button
              onClick={() => navigate('/inventory/movements')}
              className="flex flex-col items-center p-4 rounded-lg border-2 border-green-200 bg-green-50 hover:bg-green-100 transition"
            >
              <span className="text-3xl mb-2">📝</span>
              <span className="text-sm font-semibold text-gray-900">การเคลื่อนไหว</span>
            </button>

            <button
              onClick={() => navigate('/inventory/stock-card')}
              className="flex flex-col items-center p-4 rounded-lg border-2 border-purple-200 bg-purple-50 hover:bg-purple-100 transition"
            >
              <span className="text-3xl mb-2">🗂️</span>
              <span className="text-sm font-semibold text-gray-900">บัตรคุมสต็อก</span>
            </button>

            <button
              onClick={() => navigate('/inventory/variance')}
              className="flex flex-col items-center p-4 rounded-lg border-2 border-orange-200 bg-orange-50 hover:bg-orange-100 transition"
            >
              <span className="text-3xl mb-2">📊</span>
              <span className="text-sm font-semibold text-gray-900">Stock Variance</span>
            </button>

            <button
              onClick={() => navigate('/inventory/settings')}
              className="flex flex-col items-center p-4 rounded-lg border-2 border-gray-200 bg-gray-50 hover:bg-gray-100 transition"
            >
              <span className="text-3xl mb-2">⚙️</span>
              <span className="text-sm font-semibold text-gray-900">ตั้งค่า</span>
            </button>
          </div>
        </Card>

        {/* Low Stock Items */}
        {lowStockItems.length > 0 && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                สินค้าที่ต่ำกว่า Min (10 อันดับแรก)
              </h2>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('/inventory/balance?low_stock=true')}
              >
                ดูทั้งหมด
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2">สินค้า</th>
                    <th className="text-left px-4 py-2">แผนก</th>
                    <th className="text-right px-4 py-2">คงเหลือ</th>
                    <th className="text-right px-4 py-2">Min</th>
                    <th className="text-right px-4 py-2">ต้องสั่ง</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lowStockItems.map((item) => {
                    const needed = Math.max(0, (item.max_quantity || item.min_quantity || 0) - item.quantity);
                    return (
                      <tr key={`${item.product_id}-${item.department_id}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.product_name}</div>
                          <div className="text-xs text-gray-500">{item.supplier_name}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {item.department_name}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-semibold text-red-600">
                            {formatNumber(item.quantity)} {item.unit_abbr}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {formatNumber(item.min_quantity)} {item.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-semibold text-orange-600">
                            {formatNumber(needed)} {item.unit_abbr}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
};
