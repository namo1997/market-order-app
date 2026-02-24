import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { inventoryAPI } from '../../api/inventory';
import { masterAPI } from '../../api/master';
import { recipesAPI } from '../../api/recipes';

export const StockVariance = () => {
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [applying, setApplying] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const [filters, setFilters] = useState({
    date: today,
    branchId: '',
    departmentId: '',
    varianceOnly: false
  });

  useEffect(() => {
    fetchMasterData();
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
    if (filters.date) {
      loadReport();
    }
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

  const loadReport = async () => {
    try {
      setLoading(true);
      const data = await inventoryAPI.getVarianceReport(filters.date, filters);
      setReport(data);
    } catch (error) {
      console.error('Error loading report:', error);
      alert('ไม่สามารถโหลดข้อมูลได้');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyAdjustment = async (departmentId) => {
    if (!filters.date || !departmentId) {
      alert('กรุณาเลือกวันที่และแผนก');
      return;
    }

    const confirmed = window.confirm(
      'ต้องการปรับปรุงยอดคงเหลือตามการนับจริงใช่หรือไม่?\n\nระบบจะสร้าง adjustment transactions และอัพเดทยอดคงเหลือทั้งหมด'
    );

    if (!confirmed) return;

    try {
      setApplying(true);
      const result = await inventoryAPI.applyAdjustment(filters.date, departmentId);
      alert(
        `ปรับปรุงยอดเรียบร้อย\nจำนวนรายการ: ${result.data.total_adjustments}` +
          (Number(result?.data?.skipped_already_applied_count || 0) > 0
            ? `\nข้ามรายการที่เคยปรับไปแล้ว: ${result.data.skipped_already_applied_count}`
            : '')
      );
      loadReport();
    } catch (error) {
      console.error('Error applying adjustment:', error);
      alert('ปรับปรุงยอดไม่สำเร็จ');
    } finally {
      setApplying(false);
    }
  };

  const handleSyncSales = async () => {
    if (!filters.date) {
      alert('กรุณาเลือกวันที่ก่อน');
      return;
    }
    try {
      setSyncing(true);
      const response = await recipesAPI.syncUsageToInventory({
        start: filters.date,
        end: filters.date,
        branchId: filters.branchId || undefined
      });
      const data = response?.data ?? response;
      alert(
        `ดึงตัดสต็อกขายเรียบร้อย\n` +
        `บันทึกใหม่ ${Number(data?.applied_deductions || 0).toLocaleString()} รายการ\n` +
        `ข้ามที่มีแล้ว ${Number(data?.skipped_existing || 0).toLocaleString()} รายการ`
      );
      loadReport();
    } catch (error) {
      console.error('Error syncing sales:', error);
      alert(error.response?.data?.message || 'ไม่สามารถดึงตัดสต็อกขายได้');
    } finally {
      setSyncing(false);
    }
  };

  const formatNumber = (num) => {
    return Number(num || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  };

  const formatDateTimeThai = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getVarianceColor = (variance) => {
    if (variance === 0) return 'text-gray-600';
    return variance > 0 ? 'text-green-600' : 'text-red-600';
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">รายงาน Stock Variance</h1>
            <p className="text-sm text-gray-500 mt-1">
              เปรียบเทียบยอดระบบกับยอดนับจริง
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/inventory')}>
            ← ย้อนกลับ
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                วันที่นับสต็อก *
              </label>
              <Input
                type="date"
                value={filters.date}
                onChange={(e) => setFilters(prev => ({ ...prev, date: e.target.value }))}
              />
            </div>

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

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={filters.varianceOnly}
                  onChange={(e) => setFilters(prev => ({ ...prev, varianceOnly: e.target.checked }))}
                  className="rounded"
                />
                แสดงเฉพาะรายการที่มีส่วนต่าง
              </label>
            </div>
          </div>
        </Card>

        {/* Summary */}
        {report && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card className="bg-blue-50">
              <p className="text-sm text-gray-600">รายการทั้งหมด</p>
              <p className="text-3xl font-bold text-blue-700">
                {formatNumber(report.summary?.total_items || 0)}
              </p>
            </Card>

            <Card className="bg-orange-50">
              <p className="text-sm text-gray-600">รายการที่มีส่วนต่าง</p>
              <p className="text-3xl font-bold text-orange-700">
                {formatNumber(report.summary?.items_with_variance || 0)}
              </p>
            </Card>

            <Card className={`${report.summary?.total_variance_value >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className="text-sm text-gray-600">มูลค่าส่วนต่าง</p>
              <p className={`text-3xl font-bold ${report.summary?.total_variance_value >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                ฿{formatNumber(Math.abs(report.summary?.total_variance_value || 0))}
              </p>
            </Card>
          </div>
        )}

        {/* Results */}
        <Card>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-gray-900">
              รายละเอียด
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Step 1: sync ก่อน */}
              <div className="flex items-center gap-1">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-xs font-bold">1</span>
                <Button
                  onClick={handleSyncSales}
                  disabled={syncing || applying}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {syncing ? 'กำลังดึง...' : 'ดึงตัดสต็อกขาย'}
                </Button>
              </div>
              {/* Step 2: apply หลัง */}
              {filters.departmentId && report?.items && report.items.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold">2</span>
                  <Button
                    onClick={() => handleApplyAdjustment(filters.departmentId)}
                    disabled={applying || syncing}
                  >
                    {applying ? 'กำลังปรับปรุง...' : 'ปรับปรุงยอดทั้งหมด'}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div className="text-center py-10 text-gray-500">กำลังโหลด...</div>
          ) : !report || !report.items || report.items.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              {!filters.date ? 'กรุณาเลือกวันที่' : 'ไม่พบข้อมูล'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3">สินค้า</th>
                    <th className="text-left px-4 py-3">แผนก</th>
                    <th className="text-right px-4 py-3">ยอดระบบตอนเช็ค</th>
                    <th className="text-right px-4 py-3">ยอดนับจริง</th>
                    <th className="text-right px-4 py-3">ส่วนต่าง</th>
                    <th className="text-right px-4 py-3">มูลค่าส่วนต่าง</th>
                    <th className="text-left px-4 py-3">เวลาเช็ค</th>
                    <th className="text-left px-4 py-3">ผู้นับ</th>
                    <th className="text-center px-4 py-3">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.items.map((item, index) => {
                    const variance = Number(item.variance || 0);
                    const varianceValue = variance * Number(item.default_price || 0);
                    const isApplied = Boolean(item.is_applied);
                    const hasNewerApplied = !isApplied && Boolean(item.has_newer_applied);
                    const rowBg = isApplied
                      ? 'bg-green-50 opacity-70'
                      : hasNewerApplied
                        ? 'bg-gray-100 opacity-60'
                        : variance !== 0 ? 'bg-yellow-50' : '';
                    return (
                      <tr key={index} className={`hover:bg-gray-50 ${rowBg}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.product_name}</div>
                          <div className="text-xs text-gray-500">{item.product_code}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-gray-900">{item.department_name}</div>
                          <div className="text-xs text-gray-500">{item.branch_name}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {formatNumber(item.system_quantity)} {item.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                          {formatNumber(item.counted_quantity)} {item.unit_abbr}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${getVarianceColor(variance)}`}>
                          {variance > 0 && '+'}{formatNumber(variance)} {item.unit_abbr}
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${getVarianceColor(varianceValue)}`}>
                          {varianceValue > 0 && '+'}฿{formatNumber(Math.abs(varianceValue))}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                          {formatDateTimeThai(item.checked_at)}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {item.counted_by || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isApplied
                            ? <span className="inline-block px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">ปรับแล้ว ✓</span>
                            : hasNewerApplied
                              ? <span className="inline-block px-2 py-1 rounded-full text-xs font-semibold bg-gray-200 text-gray-500" title="มีการปรับปรุงวันหลังกว่านี้แล้ว ไม่สามารถย้อนหลังได้">ข้ามได้ ⚠</span>
                              : <span className="inline-block px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">รอปรับ</span>
                          }
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
