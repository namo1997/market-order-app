import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { inventoryAPI } from '../../api/inventory';
import { masterAPI } from '../../api/master';
import { recipesAPI } from '../../api/recipes';
import { useAuth } from '../../contexts/AuthContext';

export const InventoryDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncingSales, setSyncingSales] = useState(false);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const today = new Date().toISOString().split('T')[0];
  const [movementStartDate, setMovementStartDate] = useState(today);
  const [movementEndDate, setMovementEndDate] = useState(today);
  const [adjustmentDate, setAdjustmentDate] = useState(today);
  const [adjustmentBranchId, setAdjustmentBranchId] = useState('');
  const [adjustmentDepartments, setAdjustmentDepartments] = useState([]);
  const [adjustmentDepartmentId, setAdjustmentDepartmentId] = useState('');
  const [adjustmentPreview, setAdjustmentPreview] = useState(null);
  const [selectedAdjustmentProductIds, setSelectedAdjustmentProductIds] = useState([]);
  const [loadingAdjustmentPreview, setLoadingAdjustmentPreview] = useState(false);
  const [applyingAdjustment, setApplyingAdjustment] = useState(false);

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
    if (adjustmentBranchId) {
      fetchAdjustmentDepartments(adjustmentBranchId);
    } else {
      setAdjustmentDepartments([]);
      setAdjustmentDepartmentId('');
      setAdjustmentPreview(null);
      setSelectedAdjustmentProductIds([]);
    }
  }, [adjustmentBranchId]);

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

  const fetchAdjustmentDepartments = async (branchId) => {
    try {
      const data = await masterAPI.getDepartmentsByBranch(branchId);
      setAdjustmentDepartments(data || []);
    } catch (error) {
      console.error('Error fetching adjustment departments:', error);
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

  const handleSyncSalesFromClickHouse = async () => {
    if (!movementStartDate || !movementEndDate) {
      alert('กรุณาเลือกช่วงวันที่ก่อน');
      return;
    }
    try {
      setSyncingSales(true);
      const response = await recipesAPI.syncUsageToInventory({
        start: movementStartDate,
        end: movementEndDate,
        branchId: selectedBranch || undefined
      });
      const data = response?.data ?? response;
      alert(
        `อัปเดตขายออกจาก ClickHouse แล้ว\n` +
        `บันทึกใหม่ ${formatNumber(data?.applied_deductions || 0)} รายการ\n` +
        `ข้ามที่มีแล้ว ${formatNumber(data?.skipped_existing || 0)} รายการ`
      );
      await loadDashboard();
    } catch (error) {
      console.error('Error syncing sales from ClickHouse:', error);
      alert(error.response?.data?.message || 'ไม่สามารถอัปเดตขายออกจาก ClickHouse ได้');
    } finally {
      setSyncingSales(false);
    }
  };

  const handlePreviewAdjustment = async () => {
    if (!adjustmentDate || !adjustmentDepartmentId) {
      alert('กรุณาเลือกวันที่และแผนกที่จะปรับปรุง');
      return;
    }

    try {
      setLoadingAdjustmentPreview(true);
      const data = await inventoryAPI.getVarianceReport(adjustmentDate, {
        departmentId: adjustmentDepartmentId,
        varianceOnly: true
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      setAdjustmentPreview({
        summary: data?.summary || null,
        items
      });
      setSelectedAdjustmentProductIds(items.map((item) => Number(item.product_id)));
    } catch (error) {
      console.error('Error loading adjustment preview:', error);
      alert(error?.response?.data?.message || 'ไม่สามารถโหลดข้อมูลส่วนต่างได้');
    } finally {
      setLoadingAdjustmentPreview(false);
    }
  };

  const handleApplyAdjustment = async () => {
    if (!adjustmentDate || !adjustmentDepartmentId) {
      alert('กรุณาเลือกวันที่และแผนกที่จะปรับปรุง');
      return;
    }

    const confirmed = window.confirm(
      `ยืนยันการปรับปรุงยอดคงเหลือจากผลนับจริง วันที่ ${adjustmentDate} ใช่หรือไม่?`
    );
    if (!confirmed) return;

    try {
      setApplyingAdjustment(true);
      const result = await inventoryAPI.applyAdjustment(
        adjustmentDate,
        adjustmentDepartmentId,
        selectedAdjustmentProductIds
      );
      alert(
        `ปรับปรุงยอดเรียบร้อย (${result?.data?.total_adjustments || 0} รายการ)` +
          (Number(result?.data?.skipped_already_applied_count || 0) > 0
            ? `\nข้ามรายการที่เคยปรับไปแล้ว ${result.data.skipped_already_applied_count} รายการ`
            : '')
      );
      await handlePreviewAdjustment();
      await loadDashboard();
    } catch (error) {
      console.error('Error applying adjustment:', error);
      alert(error?.response?.data?.message || 'ปรับปรุงยอดไม่สำเร็จ');
    } finally {
      setApplyingAdjustment(false);
    }
  };

  const toggleAdjustmentProduct = (productId) => {
    const normalizedId = Number(productId);
    setSelectedAdjustmentProductIds((prev) => {
      if (prev.includes(normalizedId)) {
        return prev.filter((id) => id !== normalizedId);
      }
      return [...prev, normalizedId];
    });
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
        <div className="mb-8 p-6 rounded-3xl bg-gradient-to-r from-blue-600 to-indigo-700 shadow-lg text-white">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">ระบบคลังสินค้า</h1>
              <p className="text-sm text-blue-100 mt-1 opacity-90">
                ระบบจัดการคลังสินค้าและติดตามสต็อกแบบเรียลไทม์
              </p>
            </div>
            <Button variant="secondary" onClick={() => navigate('/login')} className="bg-white/10 hover:bg-white/20 text-white border-0 backdrop-blur-md">
              ← ย้อนกลับ
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-8">
          <Card className="border-0 shadow-sm bg-white/80 backdrop-blur-md">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  กรองตามสาขา
                </label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border-0 rounded-xl focus:ring-2 focus:ring-blue-500 transition-shadow text-gray-700 font-medium"
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
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  กรองตามแผนก
                </label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border-0 rounded-xl focus:ring-2 focus:ring-blue-500 transition-shadow text-gray-700 font-medium disabled:opacity-50"
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
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  ช่วงวันที่เริ่ม
                </label>
                <Input
                  type="date"
                  value={movementStartDate}
                  onChange={(e) => setMovementStartDate(e.target.value)}
                  className="bg-gray-50 border-0 rounded-xl px-4 py-3 h-[48px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  ช่วงวันที่สิ้นสุด
                </label>
                <Input
                  type="date"
                  value={movementEndDate}
                  onChange={(e) => setMovementEndDate(e.target.value)}
                  className="bg-gray-50 border-0 rounded-xl px-4 py-3 h-[48px]"
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="glass-card rounded-3xl p-6 bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-100/50 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl -mr-10 -mt-10 transition-transform group-hover:scale-150 duration-500"></div>
            <div className="flex items-center justify-between relative z-10">
              <div>
                <p className="text-sm font-semibold text-blue-600/80 tracking-wide">จำนวนสินค้าทั้งหมด</p>
                <p className="text-4xl font-extrabold text-blue-900 mt-2 tracking-tight">
                  {formatNumber(stats?.total_products || 0)}
                </p>
                <p className="text-xs font-medium text-blue-600/60 mt-2 uppercase">รายการในคลัง</p>
              </div>
              <div className="w-16 h-16 rounded-2xl bg-white/60 shadow-sm flex items-center justify-center text-3xl group-hover:scale-110 transition-transform duration-300">
                📦
              </div>
            </div>
          </div>

          <div className="glass-card rounded-3xl p-6 bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-100/50 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl -mr-10 -mt-10 transition-transform group-hover:scale-150 duration-500"></div>
            <div className="flex items-center justify-between relative z-10">
              <div>
                <p className="text-sm font-semibold text-emerald-600/80 tracking-wide">ยอดคงเหลือรวม</p>
                <p className="text-4xl font-extrabold text-emerald-900 mt-2 tracking-tight">
                  {formatNumber(stats?.total_quantity || 0)}
                </p>
                <p className="text-xs font-medium text-emerald-600/60 mt-2 uppercase">หน่วย (ทั้งหมด)</p>
              </div>
              <div className="w-16 h-16 rounded-2xl bg-white/60 shadow-sm flex items-center justify-center text-3xl group-hover:scale-110 transition-transform duration-300">
                📊
              </div>
            </div>
          </div>

          <div className="glass-card rounded-3xl p-6 bg-gradient-to-br from-rose-50 to-rose-100/50 border border-rose-100/50 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl -mr-10 -mt-10 transition-transform group-hover:scale-150 duration-500"></div>
            <div className="flex items-center justify-between relative z-10">
              <div>
                <p className="text-sm font-semibold text-rose-600/80 tracking-wide">สินค้าต่ำกว่า Min</p>
                <p className="text-4xl font-extrabold text-rose-600 mt-2 tracking-tight drop-shadow-sm">
                  {formatNumber(stats?.low_stock_count || 0)}
                </p>
                <p className="text-xs font-medium text-rose-600/60 mt-2 uppercase">รายการที่ต้องสั่งเพิ่ม</p>
              </div>
              <div className="w-16 h-16 rounded-2xl bg-white/60 shadow-sm flex items-center justify-center text-3xl group-hover:scale-110 transition-transform duration-300">
                ⚠️
              </div>
            </div>
          </div>
        </div>

        {/* Movements */}
        <div className="mb-8 p-6 rounded-3xl bg-white border border-gray-100 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-indigo-500 to-emerald-400"></div>
          <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pl-4">
            <div>
              <h2 className="text-xl font-bold text-gray-800 tracking-tight">
                รวมการเคลื่อนไหว
              </h2>
              <p className="text-sm text-gray-500 mt-1 font-medium">
                {formatDateThai(movementStart)} ถึง {formatDateThai(movementEnd)}
              </p>
            </div>
            <Button
              onClick={handleSyncSalesFromClickHouse}
              disabled={syncingSales || loading}
              className="bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-200 border-0 rounded-xl px-6 py-2.5 transition-all active:scale-95"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                {syncingSales ? 'กำลังเชื่อมข้อมูลซิงค์...' : 'ดึงตัดสต็อกขาย'}
              </div>
            </Button>
          </div>

          {movementItems.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 pl-4">
              {movementItems.map((movement) => (
                <div
                  key={movement.transaction_type}
                  className={`rounded-2xl p-4 transition-all hover:-translate-y-1 hover:shadow-md border border-transparent hover:border-black/5 ${getTransactionTypeColor(movement.transaction_type).replace('bg-', 'bg-opacity-50 bg-')}`}
                >
                  <p className="text-sm font-semibold opacity-80 tracking-wide">
                    {getTransactionTypeLabel(movement.transaction_type)}
                  </p>
                  <div className="flex items-baseline gap-1 mt-2">
                    <p className="text-3xl font-black tracking-tighter">{movement.count}</p>
                    <span className="text-xs font-medium opacity-60">ครั้ง</span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-current border-opacity-10">
                    <p className="text-xs font-bold opacity-80">
                      รวม {formatNumber(movement.total_quantity)} หน่วย
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="pl-4 py-8 flex flex-col items-center justify-center text-center bg-gray-50 rounded-2xl mx-4 my-2 border border-dashed border-gray-200">
              <span className="text-4xl mb-3 opacity-20">📭</span>
              <p className="text-gray-500 font-medium">{movementEmptyMessage}</p>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-6 ml-2">
            <div className="w-1.5 h-6 bg-blue-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-gray-800 tracking-tight">ฟังก์ชันคลังสินค้า</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6">
            {/* My Stock — หน้าร้านใช้ดูแผนกตัวเอง */}
            {user?.department_id && (
              <button
                onClick={() => navigate('/inventory/my-stock')}
                className="group flex flex-col items-center p-6 bg-white rounded-3xl shadow-sm border-2 border-green-200 hover:shadow-xl hover:border-green-400 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="absolute top-2 right-2 text-[10px] bg-green-500 text-white px-1.5 py-0.5 rounded-full font-bold">ฉัน</div>
                <div className="w-16 h-16 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform duration-300 shadow-inner">
                  🏪
                </div>
                <span className="text-sm font-bold text-gray-800 z-10">ยอดแผนกฉัน</span>
                <span className="text-xs text-gray-400 mt-1 font-medium z-10">ดูสต็อกของแผนกตัวเอง</span>
              </button>
            )}
            <button
              onClick={() => navigate('/inventory/balance')}
              className="group flex flex-col items-center p-6 bg-white rounded-3xl shadow-sm border border-gray-100 hover:shadow-xl hover:border-blue-100 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform duration-300 shadow-inner">
                📦
              </div>
              <span className="text-sm font-bold text-gray-800 z-10">ยอดคงเหลือ</span>
              <span className="text-xs text-gray-400 mt-1 font-medium z-10">ดูจำนวนของในคลัง</span>
            </button>

            <button
              onClick={() => navigate('/inventory/movements')}
              className="group flex flex-col items-center p-6 bg-white rounded-3xl shadow-sm border border-gray-100 hover:shadow-xl hover:border-emerald-100 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-500 flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform duration-300 shadow-inner">
                📝
              </div>
              <span className="text-sm font-bold text-gray-800 z-10">การเคลื่อนไหว</span>
              <span className="text-xs text-gray-400 mt-1 font-medium z-10">บันทึก เข้า-ออก</span>
            </button>

            <button
              onClick={() => navigate('/inventory/balance')}
              className="group flex flex-col items-center p-6 bg-white rounded-3xl shadow-sm border border-gray-100 hover:shadow-xl hover:border-purple-100 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="w-16 h-16 rounded-2xl bg-purple-50 text-purple-500 flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform duration-300 shadow-inner">
                🗂️
              </div>
              <span className="text-sm font-bold text-gray-800 z-10">บัตรคุมสต็อก</span>
              <span className="text-xs text-gray-400 mt-1 font-medium z-10">รายงาน Stock Card</span>
            </button>

            <button
              onClick={() => navigate('/inventory/variance')}
              className="group flex flex-col items-center p-6 bg-white rounded-3xl shadow-sm border border-gray-100 hover:shadow-xl hover:border-orange-100 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-orange-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="w-16 h-16 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform duration-300 shadow-inner">
                📊
              </div>
              <span className="text-sm font-bold text-gray-800 z-10">Stock Variance</span>
              <span className="text-xs text-gray-400 mt-1 font-medium z-10">ตรวจสอบส่วนต่าง</span>
            </button>

            <button
              onClick={() => navigate('/inventory/settings')}
              className="group flex flex-col items-center p-6 bg-white rounded-3xl shadow-sm border border-gray-100 hover:shadow-xl hover:border-gray-200 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-gray-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="w-16 h-16 rounded-2xl bg-gray-50 text-gray-600 flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform duration-300 shadow-inner">
                ⚙️
              </div>
              <span className="text-sm font-bold text-gray-800 z-10">ตั้งค่า</span>
              <span className="text-xs text-gray-400 mt-1 font-medium z-10">ขีดต่ำสุด-สูงสุด</span>
            </button>
          </div>
        </div>

        {/* Stock Adjustment */}
        <div className="mb-10 bg-white rounded-3xl shadow-sm border border-orange-100 p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center text-xl shadow-inner">
                🎯
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 tracking-tight">ปรับปรุงจากการนับสินค้าจริง</h2>
                <p className="text-sm text-gray-500 font-medium">
                  ใช้ผลนับจริง (Variance) เพื่ออัปเดตยอดคงเหลือในระบบทันที
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate('/inventory/variance')}
              className="border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl"
            >
              เปิดรายงานเต็ม
            </Button>
          </div>

          <div className="bg-orange-50/50 rounded-2xl p-6 border border-orange-100/50 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-widest mb-2">
                  วันที่นับจริง
                </label>
                <Input
                  type="date"
                  value={adjustmentDate}
                  onChange={(e) => {
                    setAdjustmentDate(e.target.value);
                    setAdjustmentPreview(null);
                    setSelectedAdjustmentProductIds([]);
                  }}
                  className="bg-white border-gray-200 rounded-xl shadow-sm h-[46px]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-widest mb-2">
                  สาขา
                </label>
                <select
                  value={adjustmentBranchId}
                  onChange={(e) => {
                    setAdjustmentBranchId(e.target.value);
                    setAdjustmentPreview(null);
                    setSelectedAdjustmentProductIds([]);
                  }}
                  className="w-full h-[46px] px-4 bg-white border border-gray-200 shadow-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm font-medium"
                >
                  <option value="">เลือกสาขา</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-widest mb-2">
                  แผนก
                </label>
                <select
                  value={adjustmentDepartmentId}
                  onChange={(e) => {
                    setAdjustmentDepartmentId(e.target.value);
                    setAdjustmentPreview(null);
                    setSelectedAdjustmentProductIds([]);
                  }}
                  className="w-full h-[46px] px-4 bg-white border border-gray-200 shadow-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm font-medium disabled:bg-gray-100 disabled:opacity-50"
                  disabled={!adjustmentBranchId}
                >
                  <option value="">เลือกแผนก</option>
                  {adjustmentDepartments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <Button
                  onClick={handlePreviewAdjustment}
                  disabled={loadingAdjustmentPreview || !adjustmentDepartmentId || !adjustmentDate}
                  className="w-full h-[46px] bg-gray-900 hover:bg-gray-800 text-white border-0 shadow-md rounded-xl transition-all font-semibold"
                >
                  {loadingAdjustmentPreview ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      กำลังโหลด
                    </span>
                  ) : 'ตรวจสอบส่วนต่าง'}
                </Button>
              </div>
            </div>
          </div>

          {adjustmentPreview && (
            <div className="animate-fade-slide-up border border-orange-200 rounded-2xl p-6 bg-white overflow-hidden shadow-lg shadow-orange-500/5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100/50">
                  <p className="text-xs font-bold text-orange-800/60 uppercase tracking-widest mb-1">รายการที่มีส่วนต่าง</p>
                  <p className="text-3xl font-black text-orange-600">
                    {formatNumber(adjustmentPreview.summary?.items_with_variance || 0)}
                  </p>
                </div>
                <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100/50">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">จำนวนที่นับทั้งหมด</p>
                  <p className="text-3xl font-black text-gray-800">
                    {formatNumber(adjustmentPreview.summary?.total_items || 0)}
                  </p>
                </div>
                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100/50">
                  <p className="text-xs font-bold text-blue-800/60 uppercase tracking-widest mb-1">มูลค่าส่วนต่าง</p>
                  <p className="text-3xl font-black text-blue-700">
                    ฿{formatNumber(Math.abs(adjustmentPreview.summary?.total_variance_value || 0))}
                  </p>
                </div>
              </div>

              {Array.isArray(adjustmentPreview.items) && adjustmentPreview.items.length > 0 ? (
                <div className="mb-6 border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 text-sm font-bold text-gray-700 flex justify-between items-center">
                    <span>เลือกรายการเพื่อปรับปรุงยอด</span>
                    <span className="bg-orange-100 text-orange-800 py-1 px-3 rounded-full text-xs">
                      เลือกแล้ว: {selectedAdjustmentProductIds.length}/{adjustmentPreview.items.length}
                    </span>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 custom-scrollbar">
                    {adjustmentPreview.items.map((item) => {
                      const pid = Number(item.product_id);
                      const selected = selectedAdjustmentProductIds.includes(pid);
                      return (
                        <label
                          key={`${pid}-${item.department_id}`}
                          className={`flex items-start gap-4 px-5 py-4 cursor-pointer transition-colors ${selected ? 'bg-orange-50/30' : 'hover:bg-gray-50/50'}`}
                        >
                          <div className="pt-1">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleAdjustmentProduct(pid)}
                              className="w-5 h-5 rounded text-orange-600 focus:ring-orange-500 border-gray-300 transition-shadow"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-gray-900 mb-1">
                              {item.product_name}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-gray-500 mt-2 bg-gray-50 rounded-lg p-2.5">
                              <span className="flex whitespace-nowrap"><span className="opacity-70 mr-1.5 w-[50px]">เวลาเช็ค:</span><span className="text-gray-900">{formatDateTimeThai(item.checked_at)}</span></span>
                              <span className="flex whitespace-nowrap"><span className="opacity-70 mr-1.5 w-[35px]">ระบบ:</span><span className="text-gray-900">{formatNumber(item.system_quantity)} {item.unit_abbr}</span></span>
                              <span className="flex whitespace-nowrap"><span className="opacity-70 mr-1.5 w-[42px]">นับจริง:</span><span className="text-blue-600 font-bold">{formatNumber(item.counted_quantity)} {item.unit_abbr}</span></span>
                              <span className="flex whitespace-nowrap ml-auto bg-white px-2 py-0.5 rounded shadow-sm">
                                <span className="opacity-70 mr-1.5">ผลต่าง:</span>
                                <span className={`font-bold ${Number(item.variance || 0) > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {Number(item.variance || 0) > 0 ? '+' : ''}{formatNumber(item.variance)} {item.unit_abbr}
                                </span>
                              </span>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="mb-6 py-10 flex flex-col items-center justify-center text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <span className="text-4xl mb-3 opacity-20">👍</span>
                  <p className="text-gray-500 font-medium">ไม่พบรายการที่มีส่วนต่าง<br />(สต็อกตรงกันพอดี)</p>
                </div>
              )}

              <Button
                onClick={handleApplyAdjustment}
                disabled={
                  applyingAdjustment ||
                  selectedAdjustmentProductIds.length <= 0
                }
                className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 shadow-md shadow-orange-500/20 text-white font-bold h-12 text-base rounded-xl transition-all active:scale-[0.98] border-0"
              >
                {applyingAdjustment ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    กำลังประมวลผลการปรับปรุงสต็อก...
                  </span>
                ) : (
                  `ยืนยันอัปเดตสต็อกตามจริงจำนวน ${selectedAdjustmentProductIds.length} รายการ`
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Low Stock Items */}
        {lowStockItems.length > 0 && (
          <div className="bg-white rounded-3xl shadow-sm border border-red-100 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-red-500/5 rounded-full blur-3xl -mr-20 -mt-20 z-0"></div>
            <div className="p-6 relative z-10 border-b border-gray-100 bg-white/50 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center text-lg shadow-inner">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 tracking-tight">
                      สินค้าที่ต่ำกว่า Min (10 อันดับแรก)
                    </h2>
                    <p className="text-xs text-gray-500 font-medium mt-0.5">สินค้าที่ต้องใกล้หมด จำเป็นต้องเติม</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => navigate('/inventory/balance?low_stock=true')}
                  className="rounded-xl border-gray-200 hover:bg-gray-50 text-gray-600"
                >
                  <span className="hidden sm:inline">ดูทั้งหมด</span>
                  <span className="sm:hidden">ทั้งหมด</span>
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto relative z-10 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50/80 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="text-left py-4 px-6 font-bold">สินค้า</th>
                    <th className="text-left py-4 px-6 font-bold">แผนกจัดเก็บ</th>
                    <th className="text-right py-4 px-6 font-bold text-blue-600">คงเหลือในระบบ</th>
                    <th className="text-right py-4 px-6 font-bold">จุดสั่งซื้อ (Min)</th>
                    <th className="text-right py-4 px-6 font-bold text-red-500">จำนวนที่ต้องสั่ง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lowStockItems.map((item, index) => {
                    const needed = Math.max(0, (item.max_quantity || item.min_quantity || 0) - item.quantity);
                    return (
                      <tr key={`${item.product_id}-${item.department_id}`} className="hover:bg-red-50/20 transition-colors group">
                        <td className="py-4 px-6">
                          <div className="font-bold text-gray-900 flex items-center gap-2">
                            {index < 3 && <span className="text-[10px] w-5 h-5 bg-red-100 text-red-600 rounded-full flex items-center justify-center font-black">{index + 1}</span>}
                            {item.product_name}
                          </div>
                          <div className="text-xs text-gray-400 mt-1 flex items-center gap-1.5 font-medium">
                            <span className="inline-block w-1.5 h-1.5 bg-gray-300 rounded-full"></span>
                            {item.supplier_name}
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-600">
                            {item.department_name}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span className="font-black text-gray-900 group-hover:text-blue-600 transition-colors">
                            {formatNumber(item.quantity)} <span className="text-xs font-medium text-gray-400 ml-0.5">{item.unit_abbr}</span>
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right font-semibold text-gray-400">
                          {formatNumber(item.min_quantity)} <span className="text-xs font-medium opacity-70 ml-0.5">{item.unit_abbr}</span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span className="inline-flex items-center gap-1.5 bg-red-50 text-red-600 px-3 py-1.5 rounded-lg font-black shadow-sm border border-red-100/50">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                            {formatNumber(needed)} <span className="text-xs font-bold opacity-80">{item.unit_abbr}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};
