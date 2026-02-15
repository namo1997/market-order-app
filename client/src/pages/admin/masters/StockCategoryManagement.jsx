import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Input } from '../../../components/common/Input';
import { masterAPI } from '../../../api/master';
import { stockCheckAPI } from '../../../api/stock-check';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { StockTemplateManagement } from './StockTemplateManagement';

export const StockCategoryManagement = () => {
  const [searchParams] = useSearchParams();
  const queryAppliedRef = useRef(false);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [categories, setCategories] = useState([]);
  const [categoryName, setCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [reorderingCategory, setReorderingCategory] = useState(false);

  useEffect(() => {
    fetchBranches();
    fetchDepartments();
  }, []);

  useEffect(() => {
    const queryDepartmentId = searchParams.get('departmentId');
    if (!queryDepartmentId || queryAppliedRef.current || departments.length === 0) return;
    const matched = departments.find(
      (dept) => String(dept.id) === String(queryDepartmentId)
    );
    if (!matched) return;
    queryAppliedRef.current = true;
    setSelectedBranch(String(matched.branch_id));
    handleSelectDepartment(String(matched.id));
  }, [departments, searchParams]);

  const fetchBranches = async () => {
    try {
      const data = await masterAPI.getBranches();
      setBranches(data || []);
    } catch (error) {
      console.error('Error fetching branches:', error);
      alert('ไม่สามารถโหลดรายการสาขาได้');
    }
  };

  const fetchDepartments = async () => {
    try {
      const data = await masterAPI.getDepartments();
      setDepartments(data || []);
    } catch (error) {
      console.error('Error fetching departments:', error);
      alert('ไม่สามารถโหลดรายการแผนกได้');
    }
  };

  const fetchCategories = async (departmentId) => {
    try {
      const data = await stockCheckAPI.getCategoriesByDepartment(departmentId);
      setCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
      alert('ไม่สามารถโหลดรายการหมวดสินค้าได้');
    }
  };

  const handleSelectBranch = (branchId) => {
    setSelectedBranch(branchId);
    setSelectedDepartment('');
    setCategories([]);
  };

  const handleSelectDepartment = (departmentId) => {
    setSelectedDepartment(departmentId);
    if (!departmentId) {
      setCategories([]);
      return;
    }
    fetchCategories(departmentId);
  };

  const handleAddCategory = async () => {
    if (!selectedDepartment) {
      alert('กรุณาเลือกแผนกก่อน');
      return;
    }

    const name = categoryName.trim();
    if (!name) {
      alert('กรุณาระบุชื่อหมวดสินค้า');
      return;
    }

    try {
      setSavingCategory(true);
      await stockCheckAPI.createCategory(selectedDepartment, name);
      setCategoryName('');
      await fetchCategories(selectedDepartment);
    } catch (error) {
      console.error('Error creating category:', error);
      alert('เพิ่มหมวดสินค้าไม่สำเร็จ');
    } finally {
      setSavingCategory(false);
    }
  };

  const startEditCategory = (category) => {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
  };

  const cancelEditCategory = () => {
    setEditingCategoryId(null);
    setEditingCategoryName('');
  };

  const handleSaveCategory = async (categoryId) => {
    const name = editingCategoryName.trim();
    if (!name) {
      alert('กรุณาระบุชื่อหมวดสินค้า');
      return;
    }

    try {
      setSavingCategory(true);
      await stockCheckAPI.updateCategory(categoryId, name);
      setEditingCategoryId(null);
      setEditingCategoryName('');
      await fetchCategories(selectedDepartment);
    } catch (error) {
      console.error('Error updating category:', error);
      alert('แก้ไขหมวดสินค้าไม่สำเร็จ');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (categoryId) => {
    const confirmed = window.confirm('ต้องการลบหมวดสินค้านี้หรือไม่?');
    if (!confirmed) return;

    try {
      await stockCheckAPI.deleteCategory(categoryId);
      await fetchCategories(selectedDepartment);
    } catch (error) {
      console.error('Error deleting category:', error);
      alert('ลบหมวดสินค้าไม่สำเร็จ');
    }
  };

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      if (a.sort_order !== b.sort_order) {
        return (a.sort_order || 0) - (b.sort_order || 0);
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'th');
    });
  }, [categories]);

  const moveCategory = async (categoryId, direction) => {
    if (reorderingCategory) return;
    const ordered = [...sortedCategories];
    const index = ordered.findIndex((category) => category.id === categoryId);
    const swapIndex = direction === 'up' ? index - 1 : index + 1;

    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return;

    const nextOrder = [...ordered];
    const [moved] = nextOrder.splice(index, 1);
    nextOrder.splice(swapIndex, 0, moved);

    const updated = nextOrder.map((category, idx) => ({
      ...category,
      sort_order: idx + 1
    }));

    setCategories(updated);
    setReorderingCategory(true);

    try {
      await Promise.all(
        updated.map((category) =>
          stockCheckAPI.updateCategory(category.id, category.name, category.sort_order)
        )
      );
      await fetchCategories(selectedDepartment);
    } catch (error) {
      console.error('Error reordering categories:', error);
      alert('จัดเรียงหมวดสินค้าไม่สำเร็จ');
      await fetchCategories(selectedDepartment);
    } finally {
      setReorderingCategory(false);
    }
  };

  const filteredDepartments = useMemo(() => {
    if (!selectedBranch) return [];
    return departments.filter(
      (dept) => String(dept.branch_id) === String(selectedBranch)
    );
  }, [departments, selectedBranch]);

  const selectedBranchName =
    branches.find((branch) => String(branch.id) === String(selectedBranch))?.name ||
    '';
  const selectedDepartmentName =
    departments.find((dept) => String(dept.id) === String(selectedDepartment))?.name ||
    '';

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-3">
          <BackToSettings />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ตั้งค่าหมวดสินค้า</h1>
            <p className="text-sm text-gray-500 mt-1">
              เลือกสาขาและแผนกเพื่อเพิ่ม/แก้ไข/จัดเรียงหมวดสินค้า และผูกสินค้าประจำหมวด
            </p>
          </div>
        </div>

        <Card className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                เลือกสาขา
              </label>
              <select
                value={selectedBranch}
                onChange={(e) => handleSelectBranch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">-- เลือกสาขา --</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                เลือกแผนก
              </label>
              <select
                value={selectedDepartment}
                onChange={(e) => handleSelectDepartment(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                disabled={!selectedBranch}
              >
                <option value="">-- เลือกแผนก --</option>
                {filteredDepartments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">หมวดสินค้า</h2>
              <p className="text-sm text-gray-500">
                {selectedDepartment
                  ? `${selectedBranchName} - ${selectedDepartmentName}`
                  : 'กรุณาเลือกแผนกก่อน'}
              </p>
            </div>
          </div>

          {!selectedDepartment ? (
            <div className="mt-4 text-sm text-gray-500">
              กรุณาเลือกสาขาและแผนกเพื่อจัดการหมวดสินค้า
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <Input
                  label="เพิ่มหมวดสินค้า"
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  placeholder="เช่น ของสด, เครื่องปรุง"
                />
                <Button
                  onClick={handleAddCategory}
                  disabled={savingCategory}
                >
                  {savingCategory ? 'กำลังเพิ่ม...' : 'เพิ่มหมวด'}
                </Button>
              </div>

              {sortedCategories.length === 0 ? (
                <div className="text-sm text-gray-500">
                  ยังไม่มีหมวดสินค้าในแผนกนี้
                </div>
              ) : (
                <div className="divide-y">
                  {sortedCategories.map((category, index) => {
                    const isEditingCategory = editingCategoryId === category.id;
                    return (
                      <div
                        key={category.id}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-3"
                      >
                        <div className="flex-1">
                          {isEditingCategory ? (
                            <input
                              type="text"
                              value={editingCategoryName}
                              onChange={(e) => setEditingCategoryName(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            />
                          ) : (
                            <p className="text-sm font-medium text-gray-900">
                              {category.name}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {isEditingCategory ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleSaveCategory(category.id)}
                                disabled={savingCategory}
                              >
                                บันทึก
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={cancelEditCategory}
                                disabled={savingCategory}
                              >
                                ยกเลิก
                              </Button>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => moveCategory(category.id, 'up')}
                                  disabled={reorderingCategory || index === 0}
                                >
                                  ขึ้น
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => moveCategory(category.id, 'down')}
                                  disabled={reorderingCategory || index === sortedCategories.length - 1}
                                >
                                  ลง
                                </Button>
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => startEditCategory(category)}
                              >
                                แก้ไข
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => handleDeleteCategory(category.id)}
                              >
                                ลบ
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="mt-10">
          <StockTemplateManagement
            embedded
            departmentId={selectedDepartment}
            departmentName={selectedDepartmentName}
            branchName={selectedBranchName}
            categories={sortedCategories}
          />
        </div>
      </div>
    </Layout>
  );
};
