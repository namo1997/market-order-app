import { useEffect, useMemo, useRef, useState } from 'react';
import { stockCheckAPI } from '../../../api/stock-check';
import { masterAPI } from '../../../api/master';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Input } from '../../../components/common/Input';
import { parseCsv } from '../../../utils/csv';

export const StockTemplateManagement = () => {
  const [departments, setDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [templates, setTemplates] = useState([]);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productFilter, setProductFilter] = useState('');
  const [selectedProducts, setSelectedProducts] = useState({});
  const [bulkAdding, setBulkAdding] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [selectedTemplateIds, setSelectedTemplateIds] = useState({});
  const [bulkMoveCategoryId, setBulkMoveCategoryId] = useState('');
  const [reorderingCategory, setReorderingCategory] = useState(false);
  const fileInputRef = useRef(null);

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

  const fetchTemplates = async (departmentId) => {
    try {
      setLoading(true);
      const data = await stockCheckAPI.getTemplateByDepartment(departmentId);
      setTemplates(data || []);
    } catch (error) {
      console.error('Error fetching templates:', error);
      alert('ไม่สามารถโหลดรายการของประจำได้');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableProducts = async (departmentId) => {
    try {
      setLoadingProducts(true);
      const data = await stockCheckAPI.getAvailableProducts(departmentId);
      setAvailableProducts(data || []);
      setSelectedProducts({});
    } catch (error) {
      console.error('Error fetching available products:', error);
      alert('ไม่สามารถโหลดรายการสินค้าได้');
    } finally {
      setLoadingProducts(false);
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

  const handleSelectDepartment = (departmentId) => {
    setSelectedDepartment(departmentId);
    setProductFilter('');
    setSelectedProducts({});
    setBulkCategoryId('');
    setSelectedTemplateIds({});
    setBulkMoveCategoryId('');

    if (!departmentId) {
      setTemplates([]);
      setAvailableProducts([]);
      setCategories([]);
      return;
    }

    fetchTemplates(departmentId);
    fetchAvailableProducts(departmentId);
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
      await fetchTemplates(selectedDepartment);
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

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleDownloadData = () => {
    if (!selectedDepartment) {
      alert('กรุณาเลือกแผนกก่อนดาวน์โหลด');
      return;
    }

    const csvEscape = (value) => {
      const text = value === null || value === undefined ? '' : String(value);
      if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const headers = [
      'department_id',
      'department_name',
      'branch_name',
      'category_id',
      'category_name',
      'product_id',
      'product_name',
      'supplier_name',
      'unit_abbr',
      'required_quantity',
      'default_price'
    ];

    const rows = templates.map((item) => [
      selectedDepartment,
      selectedDeptName,
      selectedBranchName,
      item.category_id || '',
      item.category_name || '',
      item.product_id,
      item.product_name,
      item.supplier_name,
      item.unit_abbr,
      item.required_quantity,
      item.default_price
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map(csvEscape).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const safeDeptName = (selectedDeptName || selectedDepartment).replace(/\s+/g, '_');
    link.href = URL.createObjectURL(blob);
    link.download = `stock_templates_${safeDeptName}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const { rows } = parseCsv(text);
      const payloads = rows
        .map((row) => ({
          department_id: row.department_id,
          product_id: row.product_id,
          required_quantity: row.required_quantity,
          category_id: row.category_id
        }))
        .filter((row) => row.department_id && row.product_id);

      if (payloads.length === 0) {
        alert('ไม่พบข้อมูลที่นำเข้าได้');
        return;
      }

      const results = await Promise.allSettled(
        payloads.map((payload) =>
          stockCheckAPI.addToTemplate(
            Number(payload.department_id),
            Number(payload.product_id),
            Number(payload.required_quantity || 0),
            payload.category_id ? Number(payload.category_id) : undefined
          )
        )
      );
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failedCount = results.length - successCount;

      if (selectedDepartment) {
        await fetchTemplates(selectedDepartment);
        await fetchAvailableProducts(selectedDepartment);
      }

      alert(
        `นำเข้าเสร็จสิ้น สำเร็จ ${successCount} รายการ` +
          (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : '')
      );
    } catch (error) {
      console.error('Error importing stock templates:', error);
      alert('นำเข้าไม่สำเร็จ');
    }
  };

  const handleUpdateQuantity = async (id, newQuantity) => {
    if (Number.isNaN(newQuantity) || newQuantity < 0) return;

    try {
      await stockCheckAPI.updateTemplate(id, parseFloat(newQuantity));
      fetchTemplates(selectedDepartment);
    } catch (error) {
      console.error('Error updating template:', error);
      alert('แก้ไขจำนวนไม่สำเร็จ');
    }
  };

  const handleUpdateCategory = async (item, categoryId) => {
    const normalizedCategoryId = categoryId ? Number(categoryId) : null;

    try {
      await stockCheckAPI.updateTemplate(
        item.id,
        Number(item.required_quantity || 0),
        normalizedCategoryId
      );
      fetchTemplates(selectedDepartment);
    } catch (error) {
      console.error('Error updating category:', error);
      alert('แก้ไขหมวดสินค้าไม่สำเร็จ');
    }
  };

  const toggleTemplateSelection = (templateId) => {
    setSelectedTemplateIds((prev) => ({
      ...prev,
      [templateId]: !prev[templateId]
    }));
  };

  const handleSelectAllTemplates = () => {
    const next = {};
    templates.forEach((item) => {
      next[item.id] = true;
    });
    setSelectedTemplateIds(next);
  };

  const handleClearTemplateSelection = () => {
    setSelectedTemplateIds({});
  };

  const handleBulkMoveCategory = async () => {
    const selectedIds = Object.entries(selectedTemplateIds)
      .filter(([, selected]) => selected)
      .map(([id]) => Number(id));

    if (selectedIds.length === 0) {
      alert('กรุณาเลือกรายการสินค้าเพื่อย้ายหมวด');
      return;
    }

    const normalizedCategoryId =
      bulkMoveCategoryId === '' ? null : Number(bulkMoveCategoryId);

    try {
      await Promise.all(
        selectedIds.map((templateId) =>
          stockCheckAPI.updateTemplate(templateId, undefined, normalizedCategoryId)
        )
      );
      setSelectedTemplateIds({});
      await fetchTemplates(selectedDepartment);
    } catch (error) {
      console.error('Error bulk moving categories:', error);
      alert('ย้ายหมวดสินค้าไม่สำเร็จ');
    }
  };
  const handleDeleteTemplate = async (id) => {
    const confirmed = window.confirm('ต้องการลบสินค้านี้ออกจากรายการของประจำหรือไม่?');
    if (!confirmed) return;

    try {
      await stockCheckAPI.deleteFromTemplate(id);
      fetchTemplates(selectedDepartment);
      fetchAvailableProducts(selectedDepartment);
    } catch (error) {
      console.error('Error deleting template:', error);
      alert('ลบสินค้าไม่สำเร็จ');
    }
  };

  const getProductKey = (productId) => String(productId);

  const updateSelectedProduct = (productId, updater) => {
    const key = getProductKey(productId);
    setSelectedProducts((prev) => {
      const current = prev[key] || { selected: false, required_quantity: '' };
      const next =
        typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      return { ...prev, [key]: next };
    });
  };

  const toggleSelectedProduct = (productId) => {
    updateSelectedProduct(productId, (current) => {
      const nextSelected = !current.selected;
      const nextQuantity =
        nextSelected && (current.required_quantity === '' || current.required_quantity === null)
          ? '1'
          : current.required_quantity;
      return { ...current, selected: nextSelected, required_quantity: nextQuantity };
    });
  };

  const handleSelectAllFiltered = () => {
    filteredProducts.forEach((product) => {
      updateSelectedProduct(product.id, (current) => ({
        ...current,
        selected: true,
        required_quantity:
          current.required_quantity === '' || current.required_quantity === null
            ? '1'
            : current.required_quantity
      }));
    });
  };

  const handleClearSelected = () => {
    filteredProducts.forEach((product) => {
      updateSelectedProduct(product.id, { selected: false });
    });
  };

  const handleAddSelected = async () => {
    if (!selectedDepartment) {
      alert('กรุณาเลือกแผนกก่อน');
      return;
    }

    const selectedEntries = Object.entries(selectedProducts).filter(
      ([, value]) => value.selected
    );

    if (selectedEntries.length === 0) {
      alert('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');
      return;
    }

    const payload = selectedEntries
      .map(([productId, value]) => ({
        product_id: productId,
        required_quantity: Number(value.required_quantity || 0)
      }))
      .filter((item) => Number.isFinite(item.required_quantity) && item.required_quantity > 0);

    if (payload.length === 0) {
      alert('กรุณาระบุจำนวนที่ต้องการให้มากกว่า 0');
      return;
    }

    try {
      const categoryId = bulkCategoryId ? Number(bulkCategoryId) : undefined;
      setBulkAdding(true);
      await Promise.all(
        payload.map((item) =>
          stockCheckAPI.addToTemplate(
            selectedDepartment,
            item.product_id,
            item.required_quantity,
            categoryId
          )
        )
      );
      await fetchTemplates(selectedDepartment);
      await fetchAvailableProducts(selectedDepartment);
      setSelectedProducts({});
    } catch (error) {
      console.error('Error adding products:', error);
      alert('เพิ่มสินค้าไม่สำเร็จ');
    } finally {
      setBulkAdding(false);
    }
  };

  const selectedDept = departments.find((d) => String(d.id) === String(selectedDepartment));
  const selectedDeptName = selectedDept?.name || '';
  const selectedBranchName = selectedDept?.branch_name || '';

  const filteredProducts = useMemo(() => {
    const term = productFilter.trim().toLowerCase();
    if (!term) return availableProducts;
    return availableProducts.filter((product) => {
      const name = product.name || '';
      const code = product.code || '';
      const supplierName = product.supplier_name || '';
      return (
        name.toLowerCase().includes(term) ||
        code.toLowerCase().includes(term) ||
        supplierName.toLowerCase().includes(term)
      );
    });
  }, [availableProducts, productFilter]);

  const selectedCount = useMemo(
    () => Object.values(selectedProducts).filter((entry) => entry?.selected).length,
    [selectedProducts]
  );

  const selectedTemplateCount = useMemo(
    () => Object.values(selectedTemplateIds).filter(Boolean).length,
    [selectedTemplateIds]
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            จัดการรายการของประจำแต่ละแผนก
          </h1>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleDownloadData}>
              ดาวน์โหลดข้อมูล
            </Button>
            <Button variant="secondary" onClick={handleImportClick}>
              นำเข้า
            </Button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleImportFile}
        />

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            เลือกแผนก
          </label>
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
        </div>

        <Card className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">หมวดสินค้า</h2>
              <p className="text-sm text-gray-500">
                ตั้งค่าหมวดสินค้าเพื่อจัดกลุ่มรายการของประจำในแผนกนี้
              </p>
            </div>
          </div>

          {!selectedDepartment ? (
            <div className="mt-4 text-sm text-gray-500">
              กรุณาเลือกแผนกก่อน
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <Card className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">รายการของประจำ</h2>
                <p className="text-sm text-gray-500">
                  {selectedDepartment
                    ? `${selectedBranchName} - ${selectedDeptName}`
                    : 'กรุณาเลือกแผนก'}
                </p>
              </div>
            {selectedDepartment && (
              <div className="text-sm text-gray-600">
                ทั้งหมด {templates.length} รายการ
              </div>
            )}
          </Card>

          {selectedDepartment && templates.length > 0 && (
            <Card className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-sm text-gray-600">
                เลือกแล้ว {selectedTemplateCount} รายการ
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <select
                  value={bulkMoveCategoryId}
                  onChange={(e) => setBulkMoveCategoryId(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">ย้ายไปหมวด: ไม่ระบุหมวด</option>
                  {sortedCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  onClick={handleBulkMoveCategory}
                  disabled={selectedTemplateCount === 0}
                >
                  ย้ายหมวด
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleSelectAllTemplates}
                  disabled={templates.length === 0}
                >
                  เลือกทั้งหมด
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleClearTemplateSelection}
                  disabled={selectedTemplateCount === 0}
                >
                  ล้างที่เลือก
                </Button>
              </div>
            </Card>
          )}

            {!selectedDepartment && (
              <Card className="text-center py-10 text-gray-500">
                กรุณาเลือกแผนกเพื่อจัดการรายการของประจำ
              </Card>
            )}

            {selectedDepartment && loading && (
              <Card className="text-center py-10 text-gray-500">
                กำลังโหลด...
              </Card>
            )}

            {selectedDepartment && !loading && templates.length === 0 && (
              <Card className="text-center py-10 text-gray-500">
                ยังไม่มีรายการของประจำ
              </Card>
            )}

            {selectedDepartment &&
              !loading &&
              templates.map((item) => (
                <Card key={item.id} className="relative">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedTemplateIds[item.id])}
                          onChange={() => toggleTemplateSelection(item.id)}
                          className="mt-1 h-4 w-4"
                        />
                        <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{item.product_name}</h3>
                        <p className="text-sm text-gray-500">
                          {item.supplier_name} • ราคา ฿
                          {parseFloat(item.default_price || 0).toFixed(2)}/{item.unit_abbr}
                        </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteTemplate(item.id)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        ลบ
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">จำนวนที่ต้องการ</span>
                      <input
                        type="number"
                        value={item.required_quantity}
                        onChange={(e) =>
                          handleUpdateQuantity(item.id, parseFloat(e.target.value) || 0)
                        }
                        min="0"
                        step="0.5"
                        className="w-24 px-2 py-1 border rounded-lg text-center text-sm"
                      />
                      <span className="text-sm text-gray-600">{item.unit_abbr}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">หมวดสินค้า</span>
                      <select
                        value={item.category_id || ''}
                        onChange={(e) => handleUpdateCategory(item, e.target.value)}
                        className="flex-1 px-2 py-1 border rounded-lg text-sm"
                      >
                        <option value="">-- ไม่ระบุหมวด --</option>
                        {sortedCategories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </Card>
              ))}
          </div>

          <div className="space-y-4">
            <Card>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">เพิ่มสินค้า</h2>
                  <p className="text-sm text-gray-500">
                    เลือกหลายรายการแล้วกำหนดจำนวนได้ทันที
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
                      value={productFilter}
                      onChange={(e) => setProductFilter(e.target.value)}
                      placeholder="ชื่อสินค้า / รหัส / ซัพพลายเออร์"
                    />
                    <div className="w-full sm:w-56">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        หมวดสำหรับรายการที่เลือก
                      </label>
                      <select
                        value={bulkCategoryId}
                        onChange={(e) => setBulkCategoryId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      >
                        <option value="">ไม่ระบุหมวด</option>
                        {sortedCategories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleSelectAllFiltered}
                        disabled={filteredProducts.length === 0}
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
                    {!loadingProducts && filteredProducts.length === 0 && (
                      <div className="p-4 text-center text-gray-500">
                        ไม่พบรายการสินค้า
                      </div>
                    )}
                    {!loadingProducts &&
                      filteredProducts.map((product) => {
                        const key = getProductKey(product.id);
                        const current = selectedProducts[key] || {
                          selected: false,
                          required_quantity: ''
                        };

                        return (
                          <div key={product.id} className="p-3 flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={current.selected}
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
                            <input
                              type="number"
                              value={current.required_quantity}
                              onChange={(e) =>
                                updateSelectedProduct(product.id, {
                                  required_quantity: e.target.value
                                })
                              }
                              onFocus={(e) => e.target.select()}
                              min="0"
                              step="0.5"
                              placeholder="จำนวน"
                              disabled={!current.selected}
                              className="w-20 px-2 py-1 border rounded-lg text-center text-sm disabled:bg-gray-100"
                            />
                          </div>
                        );
                      })}
                  </div>

                  <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span className="text-sm text-gray-500">
                      แสดง {filteredProducts.length} รายการ
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
