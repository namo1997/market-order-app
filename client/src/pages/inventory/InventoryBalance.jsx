import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { inventoryAPI } from '../../api/inventory';
import { masterAPI } from '../../api/master';
import { useAuth } from '../../contexts/AuthContext';

export const InventoryBalance = () => {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isStockCardMode = location.pathname === '/inventory/stock-card';
  const [balances, setBalances] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const requestSeqRef = useRef(0);

  const [filters, setFilters] = useState({
    branchId: '',
    departmentId: '',
    supplierId: '',
    search: '',
    lowStock: searchParams.get('low_stock') === 'true',
    highValueOnly: isStockCardMode
      ? false
      : (searchParams.get('high_value_only') === 'false' ? false : true),
    recipeLinkedOnly: searchParams.get('recipe_linked_only') === 'true',
    includePendingTransfer: false
  });

  useEffect(() => {
    fetchMasterData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    if (filters.branchId) {
      fetchDepartments(filters.branchId);
    } else {
      setDepartments([]);
    }
  }, [filters.branchId, isAdmin]);

  // พิมพ์ค้นหาแล้วรอสักครู่ค่อยยิง request (ไม่ยิงทุกตัวอักษร)
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.search === searchInput ? prev : { ...prev, search: searchInput }));
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // โหลดข้อมูลครั้งเดียวต่อการเปลี่ยน filter/หน้า
  useEffect(() => {
    loadBalances(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, currentPage]);

  const fetchMasterData = async () => {
    try {
      const [branchData, supplierData] = await Promise.all([
        isAdmin ? masterAPI.getBranches() : Promise.resolve([]),
        masterAPI.getProductGroups()
      ]);
      setBranches(branchData || []);
      setSuppliers(supplierData || []);
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

  const loadBalances = async (page = currentPage) => {
    const requestSeq = ++requestSeqRef.current;
    try {
      setLoading(true);
      // ผู้ใช้ทั่วไปดูได้เฉพาะแผนกตัวเอง (server บังคับเช่นกัน)
      const scopedFilters = isAdmin
        ? filters
        : { ...filters, branchId: '', departmentId: user?.department_id || '' };
      const result = await inventoryAPI.getBalances({ ...scopedFilters, page, limit: 100 });
      if (requestSeq !== requestSeqRef.current) return; // มี request ใหม่กว่าแล้ว
      setBalances(result?.data || []);
      setPagination(result?.pagination || null);
    } catch (error) {
      if (requestSeq !== requestSeqRef.current) return;
      console.error('Error loading balances:', error);
      alert(error?.response?.data?.message || 'ไม่สามารถโหลดข้อมูลได้');
    } finally {
      if (requestSeq === requestSeqRef.current) setLoading(false);
    }
  };

  const formatNumber = (num) => {
    return Number(num || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  };

  const getStockStatus = (quantity, minQty, maxQty) => {
    const qty = Number(quantity || 0);
    const min = Number(minQty || 0);
    const max = Number(maxQty || 0);

    if (qty < 0) {
      return { label: 'ติดลบ', color: 'bg-red-600 text-white' };
    }
    if (qty === 0) {
      return { label: 'หมด', color: 'bg-red-100 text-red-700' };
    }
    if (min > 0 && qty < min) {
      return { label: 'ใกล้หมด', color: 'bg-red-100 text-red-700' };
    }
    if (max > 0 && qty >= max) {
      return { label: 'ปลอดภัย', color: 'bg-green-100 text-green-700' };
    }
    if (max > 0 && qty < max) {
      return { label: 'ปานกลาง', color: 'bg-yellow-100 text-yellow-700' };
    }
    return { label: 'ปกติ', color: 'bg-gray-100 text-gray-700' };
  };

  const handleViewStockCard = (productId, departmentId) => {
    navigate(`/inventory/stock-card/${productId}/${departmentId}`);
  };

  // เปลี่ยน filter แล้วกลับไปหน้า 1 (React batch เป็น render เดียว → request เดียว)
  const handleFilterChange = (newFilter) => {
    setFilters(prev => ({ ...prev, ...newFilter }));
    setCurrentPage(1);
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {isStockCardMode ? 'บัตรคุมสต็อก' : 'ยอดคงเหลือสินค้า'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {isStockCardMode
                ? 'เลือกสินค้า แล้วกด "ดูบัตรคุม" เพื่อเปิดประวัติการเคลื่อนไหว'
                : 'แสดงยอดคงเหลือ โดยเริ่มจากสินค้ามูลค่าสูงก่อน'}
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/inventory')}>
            ← ย้อนกลับ
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {isAdmin ? (
            <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                สาขา
              </label>
              <select
                value={filters.branchId}
                onChange={(e) => handleFilterChange({ branchId: e.target.value, departmentId: '' })}
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
                onChange={(e) => handleFilterChange({ departmentId: e.target.value })}
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
            </>
            ) : (
              <div className="md:col-span-1 lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  แผนก
                </label>
                <div className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-700">
                  {user?.department || '-'}{user?.branch ? ` · ${user.branch}` : ''}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                กลุ่มสินค้า
              </label>
              <select
                value={filters.supplierId}
                onChange={(e) => handleFilterChange({ supplierId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ค้นหา
              </label>
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="ชื่อสินค้า หรือ รหัส"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {!isStockCardMode && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!filters.highValueOnly}
                  onChange={(e) =>
                    handleFilterChange({ highValueOnly: !e.target.checked })
                  }
                  className="rounded"
                />
                แสดงสินค้าทั้งหมด
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={filters.lowStock}
                onChange={(e) => handleFilterChange({ lowStock: e.target.checked })}
                className="rounded"
              />
              แสดงเฉพาะสินค้าที่ต่ำกว่า Min
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={filters.recipeLinkedOnly}
                onChange={(e) => handleFilterChange({ recipeLinkedOnly: e.target.checked })}
                className="rounded"
              />
              แสดงเฉพาะสินค้าที่ผูกสูตรแล้ว
            </label>
            {!isStockCardMode && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={filters.includePendingTransfer}
                  onChange={(e) =>
                    handleFilterChange({ includePendingTransfer: e.target.checked })
                  }
                  className="rounded"
                />
                รวมยอดโอนค้างรับ (คงเหลือโดยประมาณ)
              </label>
            )}
          </div>
        </Card>

        {/* Results */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {pagination && Number(pagination.total) > 0
                ? `ผลลัพธ์: ${Number(pagination.total).toLocaleString('th-TH')} รายการ (หน้า ${pagination.page}/${Math.max(1, Number(pagination.total_pages) || 1)})`
                : `ผลลัพธ์: ${balances.length} รายการ`}
            </h2>
            <span className="text-xs text-gray-500">
              {filters.highValueOnly ? 'กำลังแสดง: สินค้ามูลค่าสูง' : 'กำลังแสดง: ทุกสินค้า'}
            </span>
          </div>

          {loading ? (
            <div className="text-center py-10 text-gray-500">กำลังโหลด...</div>
          ) : balances.length === 0 ? (
            <div className="text-center py-10 text-gray-500">ไม่พบข้อมูล</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-3">สินค้า</th>
                      <th className="text-left px-4 py-3">สาขา/แผนก</th>
                      <th className="text-left px-4 py-3">กลุ่มสินค้า</th>
                      <th className="text-right px-4 py-3">
                        {filters.includePendingTransfer ? 'คงเหลือจริง' : 'คงเหลือ'}
                      </th>
                      {filters.includePendingTransfer && (
                        <>
                          <th className="text-right px-4 py-3">โอนออกค้างรับ</th>
                          <th className="text-right px-4 py-3">โอนเข้าค้างรับ</th>
                          <th className="text-right px-4 py-3">คงเหลือโดยประมาณ</th>
                        </>
                      )}
                      <th className="text-right px-4 py-3">Min</th>
                      <th className="text-right px-4 py-3">Max</th>
                      <th className="text-center px-4 py-3">สถานะ</th>
                      <th className="text-center px-4 py-3">ดำเนินการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {balances.map((item) => {
                      const status = getStockStatus(item.quantity, item.min_quantity, item.max_quantity);
                      return (
                        <tr key={`${item.product_id}-${item.department_id}`} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{item.product_name}</div>
                            <div className="text-xs text-gray-500">{item.product_code}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-gray-900">{item.branch_name}</div>
                            <div className="text-xs text-gray-500">{item.department_name}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {item.supplier_name || '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-semibold ${Number(item.quantity || 0) < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                              {formatNumber(item.quantity)} {item.unit_abbr}
                            </span>
                          </td>
                          {filters.includePendingTransfer && (
                            <>
                              <td className="px-4 py-3 text-right text-orange-700">
                                {formatNumber(item.pending_transfer_out)} {item.unit_abbr}
                              </td>
                              <td className="px-4 py-3 text-right text-blue-700">
                                {formatNumber(item.pending_transfer_in)} {item.unit_abbr}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className={`font-semibold ${Number(item.estimated_quantity || 0) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                                  {formatNumber(item.estimated_quantity)} {item.unit_abbr}
                                </span>
                              </td>
                            </>
                          )}
                          <td className="px-4 py-3 text-right text-gray-600">
                            {formatNumber(item.min_quantity)} {item.unit_abbr}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {formatNumber(item.max_quantity)} {item.unit_abbr}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${status.color}`}>
                              {status.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => handleViewStockCard(item.product_id, item.department_id)}
                              className="text-blue-600 hover:text-blue-700 text-xs font-medium"
                            >
                              ดูบัตรคุม
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {pagination && pagination.total_pages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <span className="text-sm text-gray-500">
                    แสดง {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} จาก {pagination.total.toLocaleString('th-TH')} รายการ
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={!pagination.has_prev || loading}
                      className="px-3 py-1 rounded border text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      ← ก่อนหน้า
                    </button>

                    {/* หมายเลขหน้า — แสดงสูงสุด 5 หน้า */}
                    {Array.from({ length: Math.min(5, pagination.total_pages) }, (_, i) => {
                      const start = Math.max(1, Math.min(
                        pagination.page - 2,
                        pagination.total_pages - 4
                      ));
                      const pageNum = start + i;
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          disabled={loading}
                          className={`w-8 h-8 rounded text-sm ${
                            pageNum === pagination.page
                              ? 'bg-blue-600 text-white font-semibold'
                              : 'border hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}

                    <button
                      onClick={() => setCurrentPage(p => Math.min(pagination.total_pages, p + 1))}
                      disabled={!pagination.has_next || loading}
                      className="px-3 py-1 rounded border text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      ถัดไป →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </Layout>
  );
};
