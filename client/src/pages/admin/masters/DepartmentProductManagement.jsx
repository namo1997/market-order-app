import { useEffect, useMemo, useState } from 'react';
import { departmentProductsAPI } from '../../../api/department-products';
import { masterAPI } from '../../../api/master';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Input } from '../../../components/common/Input';
import { BackToSettings } from '../../../components/common/BackToSettings';

export const DepartmentProductManagement = () => {
  const [departments, setDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [departmentProducts, setDepartmentProducts] = useState([]);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [assignedFilter, setAssignedFilter] = useState('');
  const [availableFilter, setAvailableFilter] = useState('');
  const [selectedProducts, setSelectedProducts] = useState({});
  const [bulkAdding, setBulkAdding] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      const data = await masterAPI.getDepartments();
      setDepartments(data || []);
    } catch (error) {
      console.error('Error fetching departments:', error);
      alert('ไม่สามารถโหลดรายการแผนกได้');
    }
  };

  const fetchDepartmentProducts = async (departmentId) => {
    try {
      setLoading(true);
      const data = await departmentProductsAPI.getDepartmentProducts(departmentId);
      setDepartmentProducts(data || []);
    } catch (error) {
      console.error('Error fetching department products:', error);
      alert('ไม่สามารถโหลดรายการสินค้าแผนกได้');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableProducts = async (departmentId) => {
    try {
      setLoadingProducts(true);
      const data = await departmentProductsAPI.getAvailableProducts(departmentId);
      setAvailableProducts(data || []);
      setSelectedProducts({});
    } catch (error) {
      console.error('Error fetching available products:', error);
      alert('ไม่สามารถโหลดรายการสินค้าได้');
    } finally {
      setLoadingProducts(false);
    }
  };

  const handleSelectDepartment = (departmentId) => {
    setSelectedDepartment(departmentId);
    setAssignedFilter('');
    setAvailableFilter('');
    setSelectedProducts({});

    if (!departmentId) {
      setDepartmentProducts([]);
      setAvailableProducts([]);
      return;
    }

    fetchDepartmentProducts(departmentId);
    fetchAvailableProducts(departmentId);
  };

  const handleCopyFromTemplate = async () => {
    if (!selectedDepartment) return;
    const confirmed = window.confirm(
      'ต้องการคัดลอกจากรายการของประจำ (stock-check) มาเป็นสินค้าแผนกสำหรับสั่งของหรือไม่?'
    );
    if (!confirmed) return;

    try {
      setCopying(true);
      const result = await departmentProductsAPI.copyFromStockTemplate(
        Number(selectedDepartment)
      );
      await fetchDepartmentProducts(selectedDepartment);
      await fetchAvailableProducts(selectedDepartment);
      const inserted = Number(result?.data?.inserted || 0);
      const total = Number(result?.data?.total || 0);
      alert(`คัดลอกสำเร็จ ${inserted} รายการ (ต้นทาง ${total} รายการ)`);
    } catch (error) {
      console.error('Error copying from stock templates:', error);
      alert('คัดลอกไม่สำเร็จ');
    } finally {
      setCopying(false);
    }
  };

  const handleDeleteDepartmentProduct = async (id) => {
    const confirmed = window.confirm('ต้องการลบสินค้านี้ออกจากแผนกหรือไม่?');
    if (!confirmed) return;

    try {
      await departmentProductsAPI.deleteDepartmentProduct(id);
      fetchDepartmentProducts(selectedDepartment);
      fetchAvailableProducts(selectedDepartment);
    } catch (error) {
      console.error('Error deleting department product:', error);
      alert('ลบสินค้าไม่สำเร็จ');
    }
  };

  const getProductKey = (productId) => String(productId);

  const toggleSelectedProduct = (productId) => {
    const key = getProductKey(productId);
    setSelectedProducts((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleSelectAllFiltered = () => {
    const next = {};
    filteredAvailableProducts.forEach((product) => {
      next[getProductKey(product.id)] = true;
    });
    setSelectedProducts((prev) => ({ ...prev, ...next }));
  };

  const handleClearSelected = () => {
    setSelectedProducts({});
  };

  const handleAddSelected = async () => {
    const selectedIds = Object.entries(selectedProducts)
      .filter(([, selected]) => selected)
      .map(([id]) => Number(id));

    if (selectedIds.length === 0) {
      alert('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');
      return;
    }

    try {
      setBulkAdding(true);
      const results = await Promise.allSettled(
        selectedIds.map((productId) =>
          departmentProductsAPI.addDepartmentProduct(
            Number(selectedDepartment),
            productId
          )
        )
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failedCount = results.length - successCount;

      await fetchDepartmentProducts(selectedDepartment);
      await fetchAvailableProducts(selectedDepartment);

      alert(
        `เพิ่มสินค้าเสร็จสิ้น สำเร็จ ${successCount} รายการ` +
          (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : '')
      );
    } catch (error) {
      console.error('Error adding department products:', error);
      alert('เพิ่มสินค้าไม่สำเร็จ');
    } finally {
      setBulkAdding(false);
    }
  };

  const selectedDepartmentInfo = useMemo(() => {
    return departments.find((dept) => String(dept.id) === String(selectedDepartment));
  }, [departments, selectedDepartment]);

  const selectedDeptName = selectedDepartmentInfo?.name || '';
  const selectedBranchName = selectedDepartmentInfo?.branch_name || '';

  const filteredDepartmentProducts = useMemo(() => {
    if (!assignedFilter) return departmentProducts;
    const term = assignedFilter.toLowerCase();
    return departmentProducts.filter((item) => {
      const name = String(item.product_name || '').toLowerCase();
      const supplier = String(item.supplier_name || '').toLowerCase();
      const unit = String(item.unit_abbr || '').toLowerCase();
      const code = String(item.product_code || '').toLowerCase();
      return (
        name.includes(term) ||
        supplier.includes(term) ||
        unit.includes(term) ||
        code.includes(term)
      );
    });
  }, [departmentProducts, assignedFilter]);

  const filteredAvailableProducts = useMemo(() => {
    if (!availableFilter) return availableProducts;
    const term = availableFilter.toLowerCase();
    return availableProducts.filter((item) => {
      const name = String(item.name || '').toLowerCase();
      const supplier = String(item.supplier_name || '').toLowerCase();
      const unit = String(item.unit_abbr || '').toLowerCase();
      const code = String(item.code || '').toLowerCase();
      return (
        name.includes(term) ||
        supplier.includes(term) ||
        unit.includes(term) ||
        code.includes(term)
      );
    });
  }, [availableProducts, availableFilter]);

  const selectedCount = useMemo(
    () => Object.values(selectedProducts).filter(Boolean).length,
    [selectedProducts]
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">สินค้าแผนกสำหรับสั่งของ</h1>
            <p className="text-sm text-gray-500">
              รายการนี้แยกจากระบบเช็คสต็อก ใช้สำหรับการสั่งซื้อเท่านั้น
            </p>
          </div>
          <BackToSettings />
        </div>

        <Card className="mb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">เลือกแผนก</label>
              <select
                value={selectedDepartment}
                onChange={(e) => handleSelectDepartment(e.target.value)}
                className="w-full sm:w-96 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- เลือกแผนก --</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.branch_name} - {dept.name}
                  </option>
                ))}
              </select>
              {selectedDepartment && (
                <div className="mt-3 text-sm text-gray-600">
                  {selectedBranchName} • {selectedDeptName}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyFromTemplate}
                disabled={!selectedDepartment || copying}
              >
                {copying ? 'กำลังคัดลอก...' : 'คัดลอกจากรายการของประจำ'}
              </Button>
              <p className="text-xs text-gray-500 max-w-xs">
                คัดลอกเฉพาะครั้งที่กด ไม่ผูกกับระบบเช็คสต็อก
              </p>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">รายการสินค้าในแผนก</h2>
                  <p className="text-sm text-gray-500">
                    {selectedDepartment ? 'รายการที่พร้อมให้สั่งซื้อ' : 'กรุณาเลือกแผนก'}
                  </p>
                </div>
                {selectedDepartment && (
                  <div className="text-sm text-gray-600">
                    ทั้งหมด {departmentProducts.length} รายการ
                  </div>
                )}
              </div>

              <div className="mt-4">
                <Input
                  label="ค้นหารายการที่มี"
                  value={assignedFilter}
                  onChange={(e) => setAssignedFilter(e.target.value)}
                  placeholder="ชื่อสินค้า / ซัพพลายเออร์ / หน่วยนับ"
                />
              </div>
            </Card>

            {!selectedDepartment && (
              <Card className="text-center py-10 text-gray-500">
                กรุณาเลือกแผนกเพื่อจัดการรายการสินค้า
              </Card>
            )}

            {selectedDepartment && loading && (
              <Card className="text-center py-10 text-gray-500">
                กำลังโหลด...
              </Card>
            )}

            {selectedDepartment && !loading && departmentProducts.length === 0 && (
              <Card className="text-center py-10 text-gray-500">
                ยังไม่มีรายการสินค้าในแผนกนี้
              </Card>
            )}

            {selectedDepartment &&
              !loading &&
              filteredDepartmentProducts.map((item) => (
                <Card key={item.id} className="relative">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">
                        {item.product_name}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {item.supplier_name} • ราคา ฿
                        {parseFloat(item.default_price || 0).toFixed(2)}/{item.unit_abbr}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteDepartmentProduct(item.id)}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      ลบ
                    </button>
                  </div>
                </Card>
              ))}

            {selectedDepartment &&
              !loading &&
              departmentProducts.length > 0 &&
              filteredDepartmentProducts.length === 0 && (
                <Card className="text-center py-10 text-gray-500">
                  ไม่พบรายการที่ค้นหา
                </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">เพิ่มสินค้า</h2>
                  <p className="text-sm text-gray-500">
                    เลือกสินค้าแล้วกดเพิ่มทันที
                  </p>
                </div>
                <div className="text-sm text-gray-600">
                  เลือกแล้ว {selectedCount} รายการ
                </div>
              </div>

              {!selectedDepartment ? (
                <div className="text-center py-10 text-gray-500">
                  กรุณาเลือกแผนกก่อน
                </div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-end gap-2 mb-3">
                    <Input
                      label="ค้นหาสินค้า"
                      value={availableFilter}
                      onChange={(e) => setAvailableFilter(e.target.value)}
                      placeholder="ชื่อสินค้า / รหัส / ซัพพลายเออร์"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleSelectAllFiltered}
                        disabled={filteredAvailableProducts.length === 0}
                      >
                        เลือกทั้งหมด
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleClearSelected}
                        disabled={selectedCount === 0}
                      >
                        ล้างที่เลือก
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-lg divide-y max-h-[460px] overflow-y-auto">
                    {loadingProducts && (
                      <div className="p-4 text-center text-gray-500">กำลังโหลด...</div>
                    )}
                    {!loadingProducts && filteredAvailableProducts.length === 0 && (
                      <div className="p-4 text-center text-gray-500">
                        ไม่พบรายการสินค้า
                      </div>
                    )}
                    {!loadingProducts &&
                      filteredAvailableProducts.map((product) => {
                        const key = getProductKey(product.id);
                        const selected = Boolean(selectedProducts[key]);

                        return (
                          <div key={product.id} className="p-3 flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleSelectedProduct(product.id)}
                              className="h-4 w-4"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {product.name}
                              </p>
                              <p className="text-xs text-gray-500">
                                {product.supplier_name} • {product.unit_abbr}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span className="text-sm text-gray-500">
                      แสดง {filteredAvailableProducts.length} รายการ
                    </span>
                    <Button
                      onClick={handleAddSelected}
                      disabled={bulkAdding || selectedCount === 0}
                    >
                      {bulkAdding
                        ? 'กำลังเพิ่ม...'
                        : `เพิ่มที่เลือก (${selectedCount})`}
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
};
