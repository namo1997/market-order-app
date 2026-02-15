import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { inventoryAPI } from '../../api/inventory';
import { masterAPI } from '../../api/master';

export const StockMovements = () => {
  const navigate = useNavigate();
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);

  const today = new Date().toISOString().split('T')[0];
  const [filters, setFilters] = useState({
    branchId: '',
    departmentId: '',
    transactionType: '',
    startDate: today,
    endDate: today,
    limit: 100
  });

  useEffect(() => {
    fetchMasterData();
    loadMovements();
  }, []);

  useEffect(() => {
    if (filters.branchId) {
      fetchDepartments(filters.branchId);
    } else {
      setDepartments([]);
      setFilters(prev => ({ ...prev, departmentId: '' }));
    }
  }, [filters.branchId]);

  useEffect(() => {
    loadMovements();
  }, [filters]);

  const fetchMasterData = async () => {
    try {
      const branchData = await masterAPI.getBranches();
      setBranches(branchData || []);
    } catch (error) {
      console.error('Error fetching master data:', error);
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

  const loadMovements = async () => {
    try {
      setLoading(true);
      const data = await inventoryAPI.getMovements(filters);
      setMovements(data || []);
    } catch (error) {
      console.error('Error loading movements:', error);
      alert('ไม่สามารถโหลดข้อมูลได้');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num) => {
    return Number(num || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

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

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">ประวัติการเคลื่อนไหว</h1>
            <p className="text-sm text-gray-500 mt-1">
              ติดตามการเคลื่อนไหวสต็อกสินค้า
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/inventory')}>
            ← ย้อนกลับ
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                สาขา
              </label>
              <select
                value={filters.branchId}
                onChange={(e) => setFilters(prev => ({ ...prev, branchId: e.target.value }))}
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
                แผนก
              </label>
              <select
                value={filters.departmentId}
                onChange={(e) => setFilters(prev => ({ ...prev, departmentId: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!filters.branchId}
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
                ประเภท
              </label>
              <select
                value={filters.transactionType}
                onChange={(e) => setFilters(prev => ({ ...prev, transactionType: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">ทั้งหมด</option>
                <option value="receive">รับเข้า</option>
                <option value="sale">ขาย</option>
                <option value="adjustment">ปรับปรุง</option>
                <option value="transfer_in">โอนเข้า</option>
                <option value="transfer_out">โอนออก</option>
                <option value="initial">ยอดเริ่มต้น</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                วันที่เริ่มต้น
              </label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                วันที่สิ้นสุด
              </label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                จำนวนแสดง
              </label>
              <select
                value={filters.limit}
                onChange={(e) => setFilters(prev => ({ ...prev, limit: Number(e.target.value) }))}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="50">50 รายการ</option>
                <option value="100">100 รายการ</option>
                <option value="200">200 รายการ</option>
                <option value="500">500 รายการ</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Results */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              ผลลัพธ์: {movements.length} รายการ
            </h2>
          </div>

          {loading ? (
            <div className="text-center py-10 text-gray-500">กำลังโหลด...</div>
          ) : movements.length === 0 ? (
            <div className="text-center py-10 text-gray-500">ไม่พบข้อมูล</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3">วันเวลา</th>
                    <th className="text-left px-4 py-3">สินค้า</th>
                    <th className="text-left px-4 py-3">แผนก</th>
                    <th className="text-center px-4 py-3">ประเภท</th>
                    <th className="text-right px-4 py-3">จำนวน</th>
                    <th className="text-right px-4 py-3">ยอดก่อน</th>
                    <th className="text-right px-4 py-3">ยอดหลัง</th>
                    <th className="text-left px-4 py-3">ผู้ทำรายการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {movements.map((item) => {
                    const isNegative = item.quantity < 0;
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600">
                          {formatDateTime(item.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.product_name}</div>
                          <div className="text-xs text-gray-500">{item.supplier_name}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-gray-900">{item.department_name}</div>
                          <div className="text-xs text-gray-500">{item.branch_name}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${getTransactionTypeColor(item.transaction_type)}`}>
                            {getTransactionTypeLabel(item.transaction_type)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${isNegative ? 'text-red-600' : 'text-green-600'}`}>
                          {isNegative ? '' : '+'}{formatNumber(item.quantity)} {item.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {formatNumber(item.balance_before)} {item.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                          {formatNumber(item.balance_after)} {item.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {item.created_by_name || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
};
