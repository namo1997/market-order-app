import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { stockCheckAPI } from '../../../api/stock-check';
import { masterAPI } from '../../../api/master';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Input } from '../../../components/common/Input';
import { parseCsv } from '../../../utils/csv';
import { BackToSettings } from '../../../components/common/BackToSettings';

export const StockTemplateManagement = () => {
  const [searchParams] = useSearchParams();
  const [departments, setDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [templates, setTemplates] = useState([]);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [templateFilter, setTemplateFilter] = useState('');
  const [templateSupplierFilter, setTemplateSupplierFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [selectedProducts, setSelectedProducts] = useState({});
  const [bulkAdding, setBulkAdding] = useState(false);
  const fileInputRef = useRef(null);
  const queryAppliedRef = useRef(false);
  const noLimitCacheRef = useRef({});
  const queryDepartmentId = searchParams.get('departmentId');

  useEffect(() => {
    fetchDepartments();
  }, []);

  useEffect(() => {
    if (!queryDepartmentId || queryAppliedRef.current) return;
    queryAppliedRef.current = true;
    handleSelectDepartment(queryDepartmentId);
  }, [queryDepartmentId]);

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

  const handleSelectDepartment = (departmentId) => {
    setSelectedDepartment(departmentId);
    setTemplateFilter('');
    setTemplateSupplierFilter('');
    setProductFilter('');
    setSelectedProducts({});

    if (!departmentId) {
      setTemplates([]);
      setAvailableProducts([]);
      return;
    }

    fetchTemplates(departmentId);
    fetchAvailableProducts(departmentId);
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
      'product_id',
      'product_name',
      'supplier_name',
      'unit_abbr',
      'required_quantity',
      'min_quantity',
      'default_price'
    ];

    const rows = templates.map((item) => [
      selectedDepartment,
      selectedDeptName,
      selectedBranchName,
      item.product_id,
      item.product_name,
      item.supplier_name,
      item.unit_abbr,
      item.required_quantity,
      item.min_quantity ?? 0,
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
          min_quantity: row.min_quantity
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
            undefined,
            Number(payload.min_quantity || 0)
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

  const handleSaveTemplate = async (id, updates = {}) => {
    const current = templates.find((item) => item.id === id);
    if (!current) return;
    const maxQty = Number(
      updates.required_quantity ?? current.required_quantity ?? 0
    );
    const minQty = Number(
      updates.min_quantity ?? current.min_quantity ?? 0
    );
    const dailyRequired = Boolean(
      updates.daily_required ?? current.daily_required ?? false
    );

    if (maxQty < 0 || minQty < 0) return;
    if (maxQty > 0 && maxQty < minQty) {
      alert('ค่า Max ต้องมากกว่าหรือเท่ากับ Min');
      return;
    }

    try {
      await stockCheckAPI.updateTemplate(id, maxQty, undefined, minQty, dailyRequired);
      fetchTemplates(selectedDepartment);
    } catch (error) {
      console.error('Error updating template:', error);
      alert('แก้ไขค่าคงเหลือไม่สำเร็จ');
    }
  };

  const handleToggleNoLimit = async (item, checked) => {
    if (!item) return;
    const itemId = item.id;
    if (checked) {
      noLimitCacheRef.current[itemId] = {
        min_quantity: Number(item.min_quantity || 0),
        required_quantity: Number(item.required_quantity || 0)
      };
      updateTemplateField(itemId, 'min_quantity', 0);
      updateTemplateField(itemId, 'required_quantity', 0);
      await handleSaveTemplate(itemId, { min_quantity: 0, required_quantity: 0 });
      return;
    }

    const cached = noLimitCacheRef.current[itemId] || {};
    const restoredMin = cached.min_quantity ?? 0;
    const restoredMax = cached.required_quantity ?? 0;
    updateTemplateField(itemId, 'min_quantity', restoredMin);
    updateTemplateField(itemId, 'required_quantity', restoredMax);
    await handleSaveTemplate(itemId, {
      min_quantity: restoredMin,
      required_quantity: restoredMax
    });
  };

  const updateTemplateField = (id, field, value) => {
    setTemplates((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
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
      setBulkAdding(true);
      await Promise.all(
        payload.map((item) =>
          stockCheckAPI.addToTemplate(
            selectedDepartment,
            item.product_id,
            item.required_quantity,
            undefined,
            0
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

  const filteredTemplates = useMemo(() => {
    const term = templateFilter.trim().toLowerCase();
    if (!term && !templateSupplierFilter) return templates;
    return templates.filter((item) => {
      const name = item.product_name || '';
      const supplierName = item.supplier_name || '';
      const unit = item.unit_abbr || '';
      const matchesSearch =
        name.toLowerCase().includes(term) ||
        supplierName.toLowerCase().includes(term) ||
        unit.toLowerCase().includes(term);
      const matchesSupplier =
        !templateSupplierFilter ||
        String(item.supplier_id || '') === String(templateSupplierFilter);
      return matchesSearch && matchesSupplier;
    });
  }, [templates, templateFilter, templateSupplierFilter]);

  const templateSuppliers = useMemo(() => {
    const suppliers = new Map();
    templates.forEach((item) => {
      const key = item.supplier_id || 'none';
      const name = item.supplier_name || 'ไม่ระบุซัพพลายเออร์';
      if (!suppliers.has(key)) {
        suppliers.set(key, { id: key, name });
      }
    });
    return Array.from(suppliers.values()).sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'th')
    );
  }, [templates]);

  const selectedCount = useMemo(
    () => Object.values(selectedProducts).filter((entry) => entry?.selected).length,
    [selectedProducts]
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-3">
          <BackToSettings />
        </div>
        <div className="flex flex-col gap-2 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                จัดการรายการของประจำแต่ละแผนก
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                เลือกแผนก แล้วเพิ่ม/ลบสินค้าได้ทันที
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleDownloadData}>
                ดาวน์โหลดข้อมูล
              </Button>
              <Button variant="secondary" onClick={handleImportClick}>
                นำเข้า
              </Button>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleImportFile}
        />

        <Card className="mb-6">
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
          {selectedDepartment && (
            <div className="mt-3 text-sm text-gray-600">
              {selectedBranchName} • {selectedDeptName}
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">รายการของประจำ</h2>
                  <p className="text-sm text-gray-500">
                    {selectedDepartment ? 'รายการที่อยู่ในแผนกนี้' : 'กรุณาเลือกแผนก'}
                  </p>
                </div>
                {selectedDepartment && (
                  <div className="text-sm text-gray-600">
                    ทั้งหมด {templates.length} รายการ
                  </div>
                )}
              </div>

              <div className="mt-4">
                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                  <Input
                    label="ค้นหารายการที่มี"
                    value={templateFilter}
                    onChange={(e) => setTemplateFilter(e.target.value)}
                    placeholder="ชื่อสินค้า / ซัพพลายเออร์ / หน่วยนับ"
                  />
                  <div className="w-full sm:w-56">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      ซัพพลายเออร์
                    </label>
                    <select
                      value={templateSupplierFilter}
                      onChange={(e) => setTemplateSupplierFilter(e.target.value)}
                      className="w-full px-2 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">ทั้งหมด</option>
                      {templateSuppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </Card>

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

            {selectedDepartment && !loading && filteredTemplates.length > 0 && (
              <Card className="p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="text-left px-3 py-2 w-[34%]">สินค้า</th>
                        <th className="text-left px-3 py-2 w-[20%]">ซัพพลายเออร์</th>
                        <th className="text-right px-2 py-2 w-[9%]">Min</th>
                        <th className="text-right px-2 py-2 w-[9%]">Max</th>
                        <th className="text-center px-2 py-2 w-[9%]">กรอกทุกวัน</th>
                        <th className="text-center px-2 py-2 w-[12%]">ไม่มี Max/Min</th>
                        <th className="text-center px-2 py-2 w-[6%]">ลบ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredTemplates.map((item) => {
                        const minValue = Number(item.min_quantity || 0);
                        const maxValue = Number(item.required_quantity || 0);
                        const dailyRequired = Boolean(item.daily_required);
                        const noLimit = minValue === 0 && maxValue === 0;
                        return (
                          <tr key={item.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-900 truncate">
                                {item.product_name}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                ฿{parseFloat(item.default_price || 0).toFixed(2)}/{item.unit_abbr}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {item.supplier_name || '-'}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <input
                                type="number"
                                value={item.min_quantity ?? 0}
                                onChange={(e) =>
                                  updateTemplateField(
                                    item.id,
                                    'min_quantity',
                                    e.target.value
                                  )
                                }
                                onBlur={(e) =>
                                  handleSaveTemplate(item.id, {
                                    min_quantity: e.target.value
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleSaveTemplate(item.id, {
                                      min_quantity: item.min_quantity,
                                      required_quantity: item.required_quantity
                                    });
                                  }
                                }}
                                min="0"
                                step="0.5"
                                disabled={noLimit}
                                className="w-16 px-2 py-1 border rounded text-xs text-right disabled:bg-gray-100"
                              />
                            </td>
                            <td className="px-2 py-2 text-right">
                              <input
                                type="number"
                                value={item.required_quantity ?? 0}
                                onChange={(e) =>
                                  updateTemplateField(
                                    item.id,
                                    'required_quantity',
                                    e.target.value
                                  )
                                }
                                onBlur={(e) =>
                                  handleSaveTemplate(item.id, {
                                    required_quantity: e.target.value
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleSaveTemplate(item.id, {
                                      min_quantity: item.min_quantity,
                                      required_quantity: item.required_quantity
                                    });
                                  }
                                }}
                                min="0"
                                step="0.5"
                                disabled={noLimit}
                                className="w-16 px-2 py-1 border rounded text-xs text-right disabled:bg-gray-100"
                              />
                            </td>
                            <td className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={dailyRequired}
                                onChange={(e) => {
                                  updateTemplateField(
                                    item.id,
                                    'daily_required',
                                    e.target.checked ? 1 : 0
                                  );
                                  handleSaveTemplate(item.id, {
                                    daily_required: e.target.checked
                                  });
                                }}
                              />
                            </td>
                            <td className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={noLimit}
                                onChange={(e) =>
                                  handleToggleNoLimit(item, e.target.checked)
                                }
                              />
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => handleDeleteTemplate(item.id)}
                                className="text-red-500 hover:text-red-700 text-xs"
                              >
                                ลบ
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
            {selectedDepartment && !loading && templates.length > 0 && filteredTemplates.length === 0 && (
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
                              placeholder="Max"
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
