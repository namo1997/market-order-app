import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { stockCheckAPI } from '../../../api/stock-check';
import { masterAPI } from '../../../api/master';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Input } from '../../../components/common/Input';
import { Modal } from '../../../components/common/Modal';
import { parseCsv } from '../../../utils/csv';
import { BackToSettings } from '../../../components/common/BackToSettings';

const parseProductGroups = (raw, fallbackId, fallbackName) => {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      parsed = [];
    }
  }

  const list = Array.isArray(parsed) ? parsed : [];
  const normalized = list
    .map((item) => {
      if (item && typeof item === 'object') {
        const id = Number(item.id);
        const name = String(item.name || '').trim();
        return Number.isFinite(id) ? { id, name } : null;
      }
      const id = Number(item);
      return Number.isFinite(id) ? { id, name: '' } : null;
    })
    .filter(Boolean);

  if (normalized.length > 0) {
    return normalized;
  }

  const id = Number(fallbackId);
  if (Number.isFinite(id)) {
    return [{ id, name: String(fallbackName || '').trim() }];
  }

  return [];
};

const normalizeQuantityDisplay = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return Number.isInteger(parsed) ? String(parsed) : String(parsed).replace(/\.?0+$/, '');
};

const normalizeMultiplierDisplay = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '1';
  return String(parsed).replace(/\.?0+$/, '');
};

export const StockTemplateManagement = ({
  embedded = false,
  departmentId: externalDepartmentId = '',
  departmentName: externalDepartmentName = '',
  branchName: externalBranchName = '',
  categories: externalCategories = []
}) => {
  const [searchParams] = useSearchParams();
  const [units, setUnits] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [templates, setTemplates] = useState([]);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [templateFilter, setTemplateFilter] = useState('');
  const [templateSupplierFilter, setTemplateSupplierFilter] = useState('');
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [productSupplierFilter, setProductSupplierFilter] = useState('');
  const [showDailyOnly, setShowDailyOnly] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState({});
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkUpdatingDaily, setBulkUpdatingDaily] = useState(false);
  const [bulkUpdatingNoLimit, setBulkUpdatingNoLimit] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [addCategoryId, setAddCategoryId] = useState('');
  const [limitModalItem, setLimitModalItem] = useState(null);
  const [limitMinQty, setLimitMinQty] = useState('0');
  const [limitMaxQty, setLimitMaxQty] = useState('0');
  const [limitSaving, setLimitSaving] = useState(false);
  const fileInputRef = useRef(null);
  const queryAppliedRef = useRef(false);
  const noLimitCacheRef = useRef({});
  const queryDepartmentId = embedded ? null : searchParams.get('departmentId');

  useEffect(() => {
    if (!embedded) {
      fetchDepartments();
    }
    fetchUnits();
  }, [embedded]);

  useEffect(() => {
    if (!queryDepartmentId || queryAppliedRef.current || embedded) return;
    queryAppliedRef.current = true;
    handleSelectDepartment(queryDepartmentId);
  }, [queryDepartmentId, embedded]);

  useEffect(() => {
    if (!embedded) return;
    handleSelectDepartment(externalDepartmentId);
  }, [embedded, externalDepartmentId]);

  useEffect(() => {
    if (!embedded) return;
    setCategoryOptions(externalCategories || []);
  }, [embedded, externalCategories]);

  const fetchDepartments = async () => {
    try {
      const data = await masterAPI.getDepartments();
      setDepartments(data || []);
    } catch (error) {
      console.error('Error fetching departments:', error);
      alert('ไม่สามารถโหลดรายการแผนกได้');
    }
  };

  const fetchUnits = async () => {
    try {
      const data = await masterAPI.getUnits();
      setUnits(data || []);
    } catch (error) {
      console.error('Error fetching units:', error);
      setUnits([]);
    }
  };

  const fetchTemplates = async (departmentId) => {
    try {
      setLoading(true);
      const data = await stockCheckAPI.getTemplateByDepartment(departmentId);
      const normalized = (data || []).map((item) => ({
        ...item,
        min_quantity: normalizeQuantityDisplay(item.min_quantity),
        required_quantity: normalizeQuantityDisplay(item.required_quantity),
        check_to_base_multiplier:
          Number(item.check_to_base_multiplier || 1) > 0
            ? Number(item.check_to_base_multiplier || 1)
            : 1
      }));
      setTemplates(normalized);
    } catch (error) {
      console.error('Error fetching templates:', error);
      alert('ไม่สามารถโหลดสินค้าประจำหมวดได้');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableProducts = async (departmentId) => {
    try {
      setLoadingProducts(true);
      const data = await stockCheckAPI.getAvailableProducts(departmentId);
      const normalized = (data || []).map((product) => {
        const groups = parseProductGroups(
          product.product_groups_json,
          product.supplier_id,
          product.supplier_name
        );
        const groupNames = groups
          .map((group) => String(group.name || '').trim())
          .filter(Boolean);
        return {
          ...product,
          product_groups: groups,
          product_group_ids: groups.map((group) => group.id),
          supplier_name:
            groupNames.join(', ') ||
            String(product.supplier_name || '').trim() ||
            'ไม่ระบุกลุ่มสินค้า'
        };
      });
      setAvailableProducts(normalized);
      setSelectedProducts({});
    } catch (error) {
      console.error('Error fetching available products:', error);
      alert('ไม่สามารถโหลดรายการสินค้าได้');
    } finally {
      setLoadingProducts(false);
    }
  };

  const fetchCategories = async (departmentId) => {
    if (!departmentId) {
      setCategoryOptions([]);
      return;
    }
    try {
      const data = await stockCheckAPI.getCategoriesByDepartment(departmentId);
      setCategoryOptions(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
      setCategoryOptions([]);
    }
  };

  const handleSelectDepartment = (departmentId) => {
    setSelectedDepartment(departmentId);
    setTemplateFilter('');
    setTemplateSupplierFilter('');
    setTemplateCategoryFilter('');
    setProductFilter('');
    setProductSupplierFilter('');
    setSelectedProducts({});
    setAddCategoryId('');

    if (!departmentId) {
      setTemplates([]);
      setAvailableProducts([]);
      if (!embedded) {
        setCategoryOptions([]);
      }
      return;
    }

    fetchTemplates(departmentId);
    fetchAvailableProducts(departmentId);
    if (!embedded) {
      fetchCategories(departmentId);
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
    const confirmed = window.confirm('ต้องการลบสินค้านี้ออกจากสินค้าประจำหมวดหรือไม่?');
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
    const categoryId =
      updates.category_id !== undefined ? updates.category_id : current.category_id;
    const normalizedCategoryId =
      categoryId === '' || categoryId === null || categoryId === undefined
        ? null
        : Number(categoryId);
    const checkInputUnitIdRaw =
      updates.check_input_unit_id !== undefined
        ? updates.check_input_unit_id
        : current.check_input_unit_id;
    const normalizedCheckInputUnitId =
      checkInputUnitIdRaw === '' || checkInputUnitIdRaw === null || checkInputUnitIdRaw === undefined
        ? null
        : Number(checkInputUnitIdRaw);
    const multiplierRaw =
      updates.check_to_base_multiplier !== undefined
        ? updates.check_to_base_multiplier
        : current.check_to_base_multiplier;
    const normalizedCheckToBaseMultiplier = normalizedCheckInputUnitId
      ? Number(multiplierRaw || 1)
      : 1;

    if (maxQty < 0 || minQty < 0) return;
    if (maxQty > 0 && maxQty < minQty) {
      alert('ค่า Max ต้องมากกว่าหรือเท่ากับ Min');
      return;
    }
    if (
      normalizedCheckInputUnitId &&
      (!Number.isFinite(normalizedCheckToBaseMultiplier) || normalizedCheckToBaseMultiplier <= 0)
    ) {
      alert('ตัวคูณหน่วยเช็คต้องมากกว่า 0');
      return;
    }

    try {
      await stockCheckAPI.updateTemplate(
        id,
        maxQty,
        normalizedCategoryId,
        minQty,
        dailyRequired,
        normalizedCheckInputUnitId,
        normalizedCheckToBaseMultiplier
      );
    } catch (error) {
      console.error('Error updating template:', error);
      alert('แก้ไขค่าคงเหลือไม่สำเร็จ');
      await fetchTemplates(selectedDepartment);
    }
  };

  const handleOpenLimitModal = (item) => {
    if (!item) return;
    setLimitModalItem(item);
    setLimitMinQty(String(normalizeQuantityDisplay(item.min_quantity ?? 0)));
    setLimitMaxQty(String(normalizeQuantityDisplay(item.required_quantity ?? 0)));
  };

  const handleCloseLimitModal = () => {
    setLimitModalItem(null);
    setLimitMinQty('0');
    setLimitMaxQty('0');
  };

  const handleSaveLimits = async () => {
    if (!limitModalItem) return;
    const minQty = Number(limitMinQty || 0);
    const maxQty = Number(limitMaxQty || 0);
    if (!Number.isFinite(minQty) || !Number.isFinite(maxQty) || minQty < 0 || maxQty < 0) {
      alert('กรุณากรอกตัวเลขที่ถูกต้อง');
      return;
    }
    if (maxQty > 0 && maxQty < minQty) {
      alert('ค่า Max ต้องมากกว่าหรือเท่ากับ Min');
      return;
    }
    try {
      setLimitSaving(true);
      updateTemplateField(limitModalItem.id, 'min_quantity', normalizeQuantityDisplay(minQty));
      updateTemplateField(limitModalItem.id, 'required_quantity', normalizeQuantityDisplay(maxQty));
      await handleSaveTemplate(limitModalItem.id, {
        min_quantity: minQty,
        required_quantity: maxQty
      });
      handleCloseLimitModal();
    } finally {
      setLimitSaving(false);
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

  const handleSetDailyRequiredAll = async () => {
    if (!selectedDepartment || bulkUpdatingDaily) return;
    const targets = filteredTemplates.filter((item) => !item.daily_required);
    if (targets.length === 0) return;

    try {
      setBulkUpdatingDaily(true);
      setTemplates((prev) =>
        prev.map((item) =>
          targets.some((target) => target.id === item.id)
            ? { ...item, daily_required: 1 }
            : item
        )
      );
      await Promise.all(
        targets.map((item) =>
          stockCheckAPI.updateTemplate(
            item.id,
            Number(item.required_quantity || 0),
            undefined,
            Number(item.min_quantity || 0),
            true
          )
        )
      );
    } catch (error) {
      console.error('Error updating daily required (all):', error);
      alert('อัปเดตสินค้ามูลค่าสูงทั้งหมดไม่สำเร็จ');
      await fetchTemplates(selectedDepartment);
    } finally {
      setBulkUpdatingDaily(false);
    }
  };

  const handleSetNoLimitAll = async () => {
    if (!selectedDepartment || bulkUpdatingNoLimit) return;
    const targets = filteredTemplates.filter((item) => {
      const minValue = Number(item.min_quantity || 0);
      const maxValue = Number(item.required_quantity || 0);
      return !(minValue === 0 && maxValue === 0);
    });
    if (targets.length === 0) return;

    const confirmed = window.confirm(
      'ต้องการตั้งค่า "ไม่มี Max/Min" ให้ทุกรายการที่แสดงอยู่ใช่หรือไม่?'
    );
    if (!confirmed) return;

    try {
      setBulkUpdatingNoLimit(true);
      targets.forEach((item) => {
        noLimitCacheRef.current[item.id] = {
          min_quantity: Number(item.min_quantity || 0),
          required_quantity: Number(item.required_quantity || 0)
        };
      });
      setTemplates((prev) =>
        prev.map((item) =>
          targets.some((target) => target.id === item.id)
            ? { ...item, min_quantity: 0, required_quantity: 0 }
            : item
        )
      );
      await Promise.all(
        targets.map((item) =>
          stockCheckAPI.updateTemplate(
            item.id,
            0,
            undefined,
            0,
            Boolean(item.daily_required)
          )
        )
      );
    } catch (error) {
      console.error('Error updating no limit (all):', error);
      alert('อัปเดตไม่มี Max/Min ทั้งหมดไม่สำเร็จ');
      await fetchTemplates(selectedDepartment);
      await fetchTemplates(selectedDepartment);
    } finally {
      setBulkUpdatingNoLimit(false);
    }
  };

  const handleDeleteAllFiltered = async () => {
    if (!selectedDepartment || bulkDeleting) return;

    // Use filteredTemplates directly as it respects current filters
    const targets = filteredTemplates;
    if (targets.length === 0) return;

    const confirmed = window.confirm(
      `ต้องการลบสินค้าทั้งหมดที่แสดงอยู่ (${targets.length} รายการ) ออกจากหมวดสินค้านี้ใช่หรือไม่?\n\nการลบนี้จะส่งผลเฉพาะรายการที่แสดงอยู่ตามตัวกรองปัจจุบัน`
    );
    if (!confirmed) return;

    try {
      setBulkDeleting(true);
      const ids = targets.map(item => item.id);
      await stockCheckAPI.deleteTemplates(ids);

      alert(`ลบข้อมูล ${targets.length} รายการเรียบร้อยแล้ว`);
      await fetchTemplates(selectedDepartment);
      await fetchAvailableProducts(selectedDepartment);
    } catch (error) {
      console.error('Error deleting all filtered:', error);
      alert('ลบข้อมูลทั้งหมดไม่สำเร็จ');
      await fetchTemplates(selectedDepartment);
    } finally {
      setBulkDeleting(false);
    }
  };

  const updateTemplateField = (id, field, value) => {
    setTemplates((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const sanitizeMultiplierInput = (value) => {
    if (value === '' || value === null || value === undefined) return '';
    return String(value)
      .replace(',', '.')
      .replace(/[^0-9.]/g, '')
      .replace(/(\..*?)\..*/g, '$1');
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
      const normalizedCategoryId =
        addCategoryId === '' || addCategoryId === null || addCategoryId === undefined
          ? undefined
          : Number(addCategoryId);
      await Promise.all(
        payload.map((item) =>
          stockCheckAPI.addToTemplate(
            selectedDepartment,
            item.product_id,
            item.required_quantity,
            normalizedCategoryId,
            0,
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
  const selectedDeptName = embedded ? externalDepartmentName : (selectedDept?.name || '');
  const selectedBranchName = embedded ? externalBranchName : (selectedDept?.branch_name || '');

  const filteredProducts = useMemo(() => {
    const term = productFilter.trim().toLowerCase();
    if (!term && !productSupplierFilter) return availableProducts;
    return availableProducts.filter((product) => {
      const name = product.name || '';
      const code = product.code || '';
      const supplierName = product.supplier_name || '';
      const selectedGroupId = Number(productSupplierFilter);
      const productGroupIds = Array.isArray(product.product_group_ids)
        ? product.product_group_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : [];
      const matchesSupplier =
        !productSupplierFilter ||
        productGroupIds.includes(selectedGroupId) ||
        String(product.supplier_id || 'none') === String(productSupplierFilter);
      return (
        matchesSupplier &&
        (
          name.toLowerCase().includes(term) ||
          code.toLowerCase().includes(term) ||
          supplierName.toLowerCase().includes(term)
        )
      );
    });
  }, [availableProducts, productFilter, productSupplierFilter]);

  const filteredTemplates = useMemo(() => {
    const term = templateFilter.trim().toLowerCase();
    if (!term && !templateSupplierFilter && !templateCategoryFilter && !showDailyOnly) return templates;
    return templates.filter((item) => {
      const name = item.product_name || '';
      const supplierName = item.supplier_name || '';
      const categoryName = item.category_name || '';
      const unit = item.unit_abbr || '';
      const matchesDaily = !showDailyOnly || Boolean(item.daily_required);
      const matchesSearch =
        name.toLowerCase().includes(term) ||
        supplierName.toLowerCase().includes(term) ||
        categoryName.toLowerCase().includes(term) ||
        unit.toLowerCase().includes(term);
      const matchesSupplier =
        !templateSupplierFilter ||
        String(item.supplier_id || '') === String(templateSupplierFilter);
      const matchesCategory =
        !templateCategoryFilter ||
        (templateCategoryFilter === 'none'
          ? !item.category_id
          : String(item.category_id || '') === String(templateCategoryFilter));
      return matchesSearch && matchesSupplier && matchesCategory && matchesDaily;
    });
  }, [templates, templateFilter, templateSupplierFilter, templateCategoryFilter, showDailyOnly]);

  const templateSuppliers = useMemo(() => {
    const suppliers = new Map();
    templates.forEach((item) => {
      const key = item.supplier_id || 'none';
      const name = item.supplier_name || 'ไม่ระบุกลุ่มสินค้า';
      if (!suppliers.has(key)) {
        suppliers.set(key, { id: key, name });
      }
    });
    return Array.from(suppliers.values()).sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'th')
    );
  }, [templates]);

  const productSuppliers = useMemo(() => {
    const suppliers = new Map();
    availableProducts.forEach((item) => {
      const groups = Array.isArray(item.product_groups) ? item.product_groups : [];
      if (groups.length === 0) {
        const key = item.supplier_id || 'none';
        const name = item.supplier_name || 'ไม่ระบุกลุ่มสินค้า';
        if (!suppliers.has(key)) {
          suppliers.set(key, { id: key, name });
        }
        return;
      }
      groups.forEach((group) => {
        const key = group.id;
        const name = group.name || `กลุ่ม #${group.id}`;
        if (!suppliers.has(key)) {
          suppliers.set(key, { id: key, name });
        }
      });
    });
    return Array.from(suppliers.values()).sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'th')
    );
  }, [availableProducts]);

  const selectedCount = useMemo(
    () => Object.values(selectedProducts).filter((entry) => entry?.selected).length,
    [selectedProducts]
  );

  const content = (
    <div className={embedded ? 'space-y-6' : 'w-full'}>
      {!embedded && (
        <div className="mb-3">
          <BackToSettings />
        </div>
      )}
      <div className="flex flex-col gap-2 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className={`${embedded ? 'text-xl' : 'text-2xl'} font-bold text-gray-900`}>
              {embedded ? 'สินค้าประจำหมวด' : 'จัดการสินค้าประจำหมวด'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {embedded
                ? 'ผูกหมวดสินค้าให้กับรายการของประจำในแผนกที่เลือก'
                : 'เลือกแผนก แล้วเพิ่ม/ลบสินค้าได้ทันที'}
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

      {!embedded && (
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
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-6">
        <div className="space-y-4 min-w-0">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">สินค้าประจำหมวด</h2>
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
                  placeholder="ชื่อสินค้า / หมวด / หน่วยนับ"
                />
                <div className="w-full sm:w-56">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    กลุ่มสินค้า
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
                <label className="flex items-center gap-2 text-xs text-gray-600 pb-2 sm:pb-0">
                  <input
                    type="checkbox"
                    checked={showDailyOnly}
                    onChange={(e) => setShowDailyOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  เฉพาะสินค้ามูลค่าสูง
                </label>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTemplateCategoryFilter('')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                    !templateCategoryFilter
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300'
                  }`}
                >
                  ทุกหมวด
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateCategoryFilter('none')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                    templateCategoryFilter === 'none'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300'
                  }`}
                >
                  ไม่ระบุหมวด
                </button>
                {categoryOptions.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setTemplateCategoryFilter(String(category.id))}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                      String(templateCategoryFilter) === String(category.id)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300'
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {!selectedDepartment && (
            <Card className="text-center py-10 text-gray-500">
              กรุณาเลือกแผนกเพื่อจัดการสินค้าประจำหมวด
            </Card>
          )}

          {selectedDepartment && loading && (
            <Card className="text-center py-10 text-gray-500">
              กำลังโหลด...
            </Card>
          )}

          {selectedDepartment && !loading && templates.length === 0 && (
            <Card className="text-center py-10 text-gray-500">
              ยังไม่มีสินค้าประจำหมวด
            </Card>
          )}

          {selectedDepartment && !loading && filteredTemplates.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-3 py-2 w-[34%]">สินค้า</th>
                      <th className="text-left px-2 py-2 w-[22%]">หมวด</th>
                      <th className="text-left px-2 py-2 w-[24%]">หน่วยเช็ค</th>
                      <th className="text-center px-2 py-2 w-[10%]">ตั้งค่า Max/Min</th>
                      <th className="text-center px-2 py-2 w-[6%]">
                        <div className="flex flex-col items-center gap-1">
                          <span>มูลค่าสูง</span>
                          <button
                            type="button"
                            onClick={handleSetDailyRequiredAll}
                            disabled={bulkUpdatingDaily || filteredTemplates.length === 0}
                            className="text-[10px] text-blue-600 hover:text-blue-700 disabled:opacity-50"
                          >
                            เลือกทั้งหมด
                          </button>
                        </div>
                      </th>
                      <th className="text-center px-2 py-2 w-[4%]">
                        <div className="flex flex-col items-center gap-1">
                          <span>ลบ</span>
                          <button
                            type="button"
                            onClick={handleDeleteAllFiltered}
                            disabled={bulkDeleting || filteredTemplates.length === 0}
                            className="text-[10px] text-red-600 hover:text-red-700 disabled:opacity-50 font-bold"
                            title="ลบทั้งหมดที่แสดงอยู่"
                          >
                            ลบทั้งหมด
                          </button>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredTemplates.map((item) => {
                      const dailyRequired = Boolean(item.daily_required);
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
                          <td className="px-2 py-2">
                            <select
                              value={item.category_id ?? ''}
                              onChange={(e) => {
                                const nextValue =
                                  e.target.value === '' ? null : Number(e.target.value);
                                updateTemplateField(item.id, 'category_id', nextValue);
                                handleSaveTemplate(item.id, { category_id: nextValue });
                              }}
                              className="w-full min-w-[180px] px-2 py-1 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                              disabled={categoryOptions.length === 0}
                            >
                              <option value="">ไม่ระบุหมวด</option>
                              {categoryOptions.map((category) => (
                                <option key={category.id} value={category.id}>
                                  {category.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <div className="space-y-1">
                              <select
                                value={item.check_input_unit_id ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const nextUnitId = raw === '' ? null : Number(raw);
                                  const nextMultiplier = 1;
                                  updateTemplateField(item.id, 'check_input_unit_id', nextUnitId);
                                  updateTemplateField(item.id, 'check_to_base_multiplier', nextMultiplier);
                                  handleSaveTemplate(item.id, {
                                    check_input_unit_id: nextUnitId,
                                    check_to_base_multiplier: nextMultiplier
                                  });
                                }}
                                className="w-full min-w-[160px] px-2 py-1 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">
                                  หน่วยฐาน ({item.unit_abbr || item.unit_name || '-'})
                                </option>
                                {units.map((unit) => (
                                  <option key={unit.id} value={unit.id}>
                                    {unit.abbreviation || unit.name}
                                  </option>
                                ))}
                              </select>

                              {item.check_input_unit_id ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-slate-500 whitespace-nowrap">
                                    1 {item.check_input_unit_abbr || item.check_input_unit_name || 'หน่วย'}
                                  </span>
                                  <span className="text-[10px] text-slate-500">=</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={normalizeMultiplierDisplay(item.check_to_base_multiplier)}
                                    onChange={(e) => {
                                      const cleaned = sanitizeMultiplierInput(e.target.value);
                                      updateTemplateField(item.id, 'check_to_base_multiplier', cleaned);
                                    }}
                                    onBlur={(e) => {
                                      const parsed = Number(e.target.value || 1);
                                      const safeValue =
                                        Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
                                      updateTemplateField(item.id, 'check_to_base_multiplier', safeValue);
                                      handleSaveTemplate(item.id, {
                                        check_to_base_multiplier: safeValue
                                      });
                                    }}
                                    className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-right text-[11px] font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                  />
                                  <span className="text-[10px] text-slate-500 whitespace-nowrap">
                                    {item.unit_abbr || item.unit_name || 'หน่วยฐาน'}
                                  </span>
                                </div>
                              ) : (
                                <p className="text-[10px] text-slate-400">
                                  บันทึกด้วยหน่วยฐาน
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleOpenLimitModal(item)}
                              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                            >
                              ตั้งค่า
                            </button>
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

        <div className="space-y-4 min-w-0">
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
                <div className="grid grid-cols-1 gap-2 mb-3">
                  <Input
                    label="ค้นหาสินค้า"
                    value={productFilter}
                    onChange={(e) => setProductFilter(e.target.value)}
                    placeholder="ชื่อสินค้า / รหัส / กลุ่มสินค้า"
                  />
                  <div className="w-full">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      เลือกกลุ่มสินค้า
                    </label>
                    <select
                      value={productSupplierFilter}
                      onChange={(e) => setProductSupplierFilter(e.target.value)}
                      className="w-full px-2 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">ทั้งหมด</option>
                      {productSuppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-full">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      หมวดที่จะผูก
                    </label>
                    <select
                      value={addCategoryId}
                      onChange={(e) => setAddCategoryId(e.target.value)}
                      className="w-full px-2 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={categoryOptions.length === 0}
                    >
                      <option value="">ไม่ระบุหมวด</option>
                      {categoryOptions.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
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

      <Modal
        isOpen={Boolean(limitModalItem)}
        onClose={handleCloseLimitModal}
        title={limitModalItem ? `ตั้งค่า Max/Min: ${limitModalItem.product_name}` : 'ตั้งค่า Max/Min'}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Min</label>
              <input
                type="number"
                value={limitMinQty}
                onChange={(e) => setLimitMinQty(e.target.value)}
                min="0"
                step="0.5"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Max</label>
              <input
                type="number"
                value={limitMaxQty}
                onChange={(e) => setLimitMaxQty(e.target.value)}
                min="0"
                step="0.5"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            ถ้าต้องการไม่มี Max/Min ให้ใส่ Min=0 และ Max=0
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleCloseLimitModal}>
              ยกเลิก
            </Button>
            <Button onClick={handleSaveLimits} disabled={limitSaving}>
              {limitSaving ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
  return embedded ? content : <Layout mainClassName="!max-w-none !px-2 md:!px-4">{content}</Layout>;
};
