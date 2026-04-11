import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { masterAPI } from '../../../api/master';
import { productsAPI } from '../../../api/products';

const THAI_BANK_OPTIONS = [
  { code: 'KBANK', name: 'กสิกรไทย (KBank)', accountLength: '10', usersMillions: 23.9 },
  { code: 'SCB', name: 'ไทยพาณิชย์ (SCB)', accountLength: '10', usersMillions: 18.1 },
  { code: 'KTB', name: 'กรุงไทย (Krungthai)', accountLength: '10', usersMillions: 17.8 },
  { code: 'BBL', name: 'กรุงเทพ (Bangkok Bank)', accountLength: '10', usersMillions: 14.0 },
  { code: 'BAY', name: 'กรุงศรีอยุธยา (Krungsri)', accountLength: '10', usersMillions: null },
  { code: 'TTB', name: 'ทหารไทยธนชาต (ttb)', accountLength: '10', usersMillions: null },
  { code: 'GSB', name: 'ออมสิน (GSB)', accountLength: '10-12', usersMillions: null },
  { code: 'BAAC', name: 'ธ.ก.ส. (BAAC)', accountLength: '10-12', usersMillions: null },
  { code: 'UOB', name: 'ยูโอบี (UOB)', accountLength: '10', usersMillions: null },
  { code: 'CIMBT', name: 'ซีไอเอ็มบี ไทย (CIMB Thai)', accountLength: '10', usersMillions: null },
  { code: 'KKP', name: 'เกียรตินาคินภัทร (KKP)', accountLength: '10', usersMillions: null },
  { code: 'LH', name: 'แลนด์ แอนด์ เฮ้าส์ (LH Bank)', accountLength: '10', usersMillions: null },
  { code: 'ICBC', name: 'ไอซีบีซี ไทย (ICBC)', accountLength: '10', usersMillions: null }
].sort((a, b) => {
  const aScore = Number.isFinite(a.usersMillions) ? a.usersMillions : -1;
  const bScore = Number.isFinite(b.usersMillions) ? b.usersMillions : -1;
  if (aScore !== bScore) return bScore - aScore;
  return String(a.name || '').localeCompare(String(b.name || ''), 'th');
});

const getProductGroupIds = (product) => {
  const list = Array.isArray(product?.product_group_ids) && product.product_group_ids.length > 0
    ? product.product_group_ids
    : Array.isArray(product?.supplier_ids) && product.supplier_ids.length > 0
      ? product.supplier_ids
      : [product?.product_group_id ?? product?.supplier_id];

  return Array.from(
    new Set(
      (list || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
};

const extractProducts = (response) => {
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response)) return response;
  return [];
};

export const SupplierMasterManagement = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [productGroups, setProductGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSaving, setProductSaving] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [targetSupplier, setTargetSupplier] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState(new Set());
  const [units, setUnits] = useState([]);
  const [supplierProducts, setSupplierProducts] = useState([]);
  const [supplierProductsLoading, setSupplierProductsLoading] = useState(false);
  const [supplierProductsSearch, setSupplierProductsSearch] = useState('');
  const [savingUnitProductId, setSavingUnitProductId] = useState(null);
  const [supplierUnitDrafts, setSupplierUnitDrafts] = useState({});
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    contact_person: '',
    phone: '',
    address: '',
    line_id: '',
    has_bank_account: false,
    bank_name: '',
    account_number: '',
    account_name: ''
  });

  useEffect(() => {
    fetchSuppliers();
    fetchUnits();
  }, []);

  const fetchSuppliers = async () => {
    try {
      const data = await masterAPI.getSupplierMasters();
      setSuppliers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching supplier masters:', error);
    }
  };

  const fetchUnits = async () => {
    try {
      const data = await masterAPI.getUnits();
      const list = Array.isArray(data) ? data : [];
      setUnits(
        list
          .map((unit) => ({
            id: Number(unit.id),
            name: unit.name || unit.label || '',
            abbr: unit.abbreviation || unit.abbr || ''
          }))
          .filter((unit) => Number.isFinite(unit.id) && unit.id > 0)
          .sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'))
      );
    } catch (error) {
      console.error('Error fetching units:', error);
      setUnits([]);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      contact_person: '',
      phone: '',
      address: '',
      line_id: '',
      has_bank_account: false,
      bank_name: '',
      account_number: '',
      account_name: ''
    });
    setSelectedId(null);
    setIsCreating(false);
  };

  const openCreate = () => {
    resetForm();
    setIsCreating(true);
  };

  const closeEditor = () => {
    resetForm();
  };

  const openEdit = (row) => {
    setFormData({
      name: row.name || '',
      code: row.code || '',
      contact_person: row.contact_person || '',
      phone: row.phone || '',
      address: row.address || '',
      line_id: row.line_id || '',
      has_bank_account: Boolean(Number(row.has_bank_account || 0)),
      bank_name: row.bank_name || '',
      account_number: row.account_number || '',
      account_name: row.account_name || ''
    });
    setSelectedId(row.id);
    setIsCreating(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (formData.has_bank_account) {
        const selectedBank = THAI_BANK_OPTIONS.find((bank) => bank.name === formData.bank_name);
        const expectedLength = selectedBank?.accountLength || '10-12';
        if (!String(formData.bank_name || '').trim()) {
          alert('กรุณาเลือกธนาคาร');
          return;
        }
        if (!String(formData.account_name || '').trim()) {
          alert('กรุณากรอกชื่อบัญชี');
          return;
        }
        const digits = String(formData.account_number || '').replace(/\D/g, '');
        if (!digits) {
          alert('กรุณากรอกเลขบัญชี');
          return;
        }
        if (expectedLength === '10' && digits.length !== 10) {
          alert('เลขบัญชีต้องมี 10 หลัก');
          return;
        }
        if (expectedLength === '10-12' && (digits.length < 10 || digits.length > 12)) {
          alert('เลขบัญชีต้องมี 10-12 หลัก');
          return;
        }
      }

      const payload = formData.has_bank_account
        ? formData
        : {
            ...formData,
            bank_name: '',
            account_number: '',
            account_name: ''
          };
      if (selectedId) {
        await masterAPI.updateSupplierMaster(selectedId, payload);
      } else {
        await masterAPI.createSupplierMaster(payload);
        setIsCreating(false);
      }
      fetchSuppliers();
    } catch (error) {
      console.error('Error saving supplier master:', error);
      alert('บันทึกซัพพลายเออร์ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (row) => {
    if (!confirm(`ต้องการลบซัพพลายเออร์ "${row.name}" ใช่หรือไม่?`)) return;

    try {
      await masterAPI.deleteSupplierMaster(row.id);
      if (Number(selectedId) === Number(row.id)) {
        resetForm();
      }
      fetchSuppliers();
    } catch (error) {
      console.error('Error deleting supplier master:', error);
      alert('ลบซัพพลายเออร์ไม่สำเร็จ');
    }
  };

  const fetchProducts = async () => {
    try {
      setProductsLoading(true);
      const response = await productsAPI.getProducts();
      setProducts(extractProducts(response));
    } catch (error) {
      console.error('Error fetching products:', error);
      alert('โหลดสินค้าไม่สำเร็จ');
    } finally {
      setProductsLoading(false);
    }
  };

  const fetchProductGroups = async () => {
    try {
      const data = await masterAPI.getProductGroups();
      setProductGroups(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching product groups:', error);
      setProductGroups([]);
    }
  };

  const fetchSupplierProducts = async (supplierMasterId) => {
    if (!supplierMasterId) {
      setSupplierProducts([]);
      return;
    }
    try {
      setSupplierProductsLoading(true);
      const response = await productsAPI.getProducts({
        supplierMasterId,
        bypassScope: true
      });
      const items = extractProducts(response);
      setSupplierProducts(items);
      const nextDrafts = {};
      items.forEach((item) => {
        const rawPurchaseUnitId = item?.supplier_purchase_unit_id;
        const rawMultiplier = item?.supplier_purchase_to_base_multiplier;
        const purchaseUnitId =
          rawPurchaseUnitId === undefined || rawPurchaseUnitId === null || rawPurchaseUnitId === ''
            ? ''
            : String(rawPurchaseUnitId);
        const multiplier =
          rawMultiplier === undefined || rawMultiplier === null || rawMultiplier === ''
            ? ''
            : String(rawMultiplier);
        nextDrafts[item.id] = {
          purchase_unit_id: purchaseUnitId,
          purchase_to_base_multiplier: multiplier
        };
      });
      setSupplierUnitDrafts(nextDrafts);
    } catch (error) {
      console.error('Error fetching supplier products:', error);
      setSupplierProducts([]);
      setSupplierUnitDrafts({});
    } finally {
      setSupplierProductsLoading(false);
    }
  };

  const resetProductSelection = () => {
    setSelectedProductIds(new Set());
    setProductSearch('');
    setSelectedGroupId('');
    setTargetSupplier(null);
  };

  const openAssignProducts = (supplier) => {
    setTargetSupplier(supplier);
    setSelectedProductIds(new Set());
    setProductSearch('');
    setIsProductModalOpen(true);
    fetchProducts();
    fetchProductGroups();
  };

  const toggleProductSelection = (productId) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const handleGroupFilterSelect = (groupId) => {
    setSelectedGroupId(groupId);
    setSelectedProductIds(new Set());
  };

  const filteredProducts = products.filter((product) => {
    if (selectedGroupId) {
      const filterGroupId = Number(selectedGroupId);
      const productGroupId = Number(product.product_group_id ?? product.supplier_id);
      if (!Number.isFinite(filterGroupId) || filterGroupId <= 0) return false;
      if (productGroupId !== filterGroupId) return false;
    }

    const search = String(productSearch || '').trim().toLowerCase();
    if (!search) return true;
    const name = String(product.name || '').toLowerCase();
    const code = String(product.code || '').toLowerCase();
    return name.includes(search) || code.includes(search);
  });

  const handleSelectAll = () => {
    const next = new Set();
    filteredProducts.forEach((product) => {
      if (Number(product.supplier_master_id) === Number(targetSupplier?.id)) return;
      next.add(product.id);
    });
    setSelectedProductIds(next);
  };

  const handleSelectUnassigned = () => {
    const next = new Set();
    filteredProducts.forEach((product) => {
      if (!product.supplier_master_id) {
        next.add(product.id);
      }
    });
    setSelectedProductIds(next);
  };

  const handleAssignProducts = async (event) => {
    event.preventDefault();
    if (!targetSupplier?.id) {
      alert('ไม่พบซัพพลายเออร์');
      return;
    }

    const selectedProducts = products.filter((product) => selectedProductIds.has(product.id));
    if (selectedProducts.length === 0) {
      alert('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');
      return;
    }

    setProductSaving(true);
    try {
      const results = await Promise.allSettled(
        selectedProducts.map((product) => {
          const productGroupIds = getProductGroupIds(product);
          return productsAPI.updateProduct(product.id, {
            name: product.name,
            code: product.code,
            default_price: product.default_price,
            unit_id: product.unit_id,
            supplier_id: productGroupIds[0] || null,
            product_group_id: productGroupIds[0] || null,
            supplier_ids: productGroupIds,
            product_group_ids: productGroupIds,
            supplier_master_id: targetSupplier.id,
            is_countable: product.is_countable
          });
        })
      );

      const successCount = results.filter((row) => row.status === 'fulfilled').length;
      const failedCount = results.length - successCount;

      setIsProductModalOpen(false);
      resetProductSelection();
      if (Number(selectedId) === Number(targetSupplier?.id)) {
        fetchSupplierProducts(targetSupplier.id);
      }
      alert(
        `เพิ่มสินค้าเข้า "${targetSupplier.name}" สำเร็จ ${successCount} รายการ` +
        (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : '')
      );
    } catch (error) {
      console.error('Error assigning products to supplier master:', error);
      alert('เพิ่มสินค้าเข้า ซัพพลายเออร์ไม่สำเร็จ');
    } finally {
      setProductSaving(false);
    }
  };

  const getBaseUnitLabel = (product) => {
    const name = product?.unit_name || '';
    const abbr = product?.unit_abbr || '';
    if (name && abbr) return `${name} (${abbr})`;
    return name || abbr || '-';
  };

  const handleSupplierDraftChange = (productId, key, value) => {
    setSupplierUnitDrafts((prev) => ({
      ...prev,
      [productId]: {
        ...(prev[productId] || {}),
        [key]: value
      }
    }));
  };

  const handleSaveSupplierUnitConfig = async (product) => {
    if (!selectedSupplier?.id) return;

    const draft = supplierUnitDrafts[product.id] || {};
    const purchaseUnitRaw = draft.purchase_unit_id;
    const multiplierRaw = draft.purchase_to_base_multiplier;
    const purchaseUnitId =
      purchaseUnitRaw === undefined || purchaseUnitRaw === null || purchaseUnitRaw === ''
        ? null
        : Number(purchaseUnitRaw);
    const baseUnitId = Number(product.unit_id);
    const multiplier =
      multiplierRaw === undefined || multiplierRaw === null || String(multiplierRaw).trim() === ''
        ? null
        : Number(multiplierRaw);

    if (purchaseUnitId !== null && (!Number.isFinite(purchaseUnitId) || purchaseUnitId <= 0)) {
      alert('กรุณาเลือกหน่วยซื้อที่ถูกต้อง');
      return;
    }

    if (
      purchaseUnitId !== null &&
      Number.isFinite(baseUnitId) &&
      purchaseUnitId !== baseUnitId &&
      (multiplier === null || !Number.isFinite(multiplier) || multiplier <= 0)
    ) {
      alert('กรุณากรอกตัวคูณแปลงหน่วย (> 0)');
      return;
    }

    const payload = {
      purchase_unit_id: purchaseUnitId,
      purchase_to_base_multiplier:
        purchaseUnitId === null
          ? null
          : (purchaseUnitId === baseUnitId ? 1 : multiplier)
    };

    try {
      setSavingUnitProductId(product.id);
      const response = await productsAPI.updateSupplierUnitConfig(
        product.id,
        selectedSupplier.id,
        payload
      );
      const result = response?.data || response || {};
      const savedPurchaseUnitId =
        result.purchase_unit_id === undefined || result.purchase_unit_id === null
          ? null
          : Number(result.purchase_unit_id);
      const savedMultiplier =
        result.purchase_to_base_multiplier === undefined || result.purchase_to_base_multiplier === null
          ? null
          : Number(result.purchase_to_base_multiplier);
      const savedUnit = units.find((unit) => Number(unit.id) === savedPurchaseUnitId);

      setSupplierProducts((prev) =>
        prev.map((row) => {
          if (Number(row.id) !== Number(product.id)) return row;
          return {
            ...row,
            supplier_purchase_unit_id: savedPurchaseUnitId,
            supplier_purchase_unit_name: savedUnit?.name || null,
            supplier_purchase_unit_abbr: savedUnit?.abbr || null,
            supplier_purchase_to_base_multiplier: savedMultiplier
          };
        })
      );
      setSupplierUnitDrafts((prev) => ({
        ...prev,
        [product.id]: {
          purchase_unit_id: savedPurchaseUnitId ? String(savedPurchaseUnitId) : '',
          purchase_to_base_multiplier:
            savedMultiplier === null || Number.isNaN(savedMultiplier) ? '' : String(savedMultiplier)
        }
      }));
    } catch (error) {
      console.error('Error saving supplier unit conversion:', error);
      alert('บันทึกการแปลงหน่วยไม่สำเร็จ');
    } finally {
      setSavingUnitProductId(null);
    }
  };

  const filteredSuppliers = useMemo(() => {
    const term = String(searchQuery || '').trim().toLowerCase();
    const source = Array.isArray(suppliers) ? suppliers : [];
    if (!term) {
      return [...source].sort((a, b) =>
        String(a?.name || '').localeCompare(String(b?.name || ''), 'th')
      );
    }
    return source
      .filter((item) => {
        const text = [
          item?.name,
          item?.code,
          item?.contact_person,
          item?.phone,
          item?.line_id,
          item?.address
        ]
          .map((value) => String(value || '').toLowerCase())
          .join(' ');
        return text.includes(term);
      })
      .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'th'));
  }, [suppliers, searchQuery]);

  const panelOpen = Boolean(selectedId) || isCreating;
  const selectedSupplier = useMemo(
    () => suppliers.find((row) => Number(row.id) === Number(selectedId)) || null,
    [suppliers, selectedId]
  );

  useEffect(() => {
    if (!selectedSupplier?.id || isCreating) {
      setSupplierProducts([]);
      setSupplierProductsSearch('');
      setSupplierUnitDrafts({});
      setSavingUnitProductId(null);
      return;
    }
    fetchSupplierProducts(selectedSupplier.id);
  }, [selectedSupplier?.id, isCreating]);

  const filteredSupplierProducts = useMemo(() => {
    const search = String(supplierProductsSearch || '').trim().toLowerCase();
    const source = Array.isArray(supplierProducts) ? supplierProducts : [];
    if (!search) {
      return [...source].sort((a, b) =>
        String(a?.name || '').localeCompare(String(b?.name || ''), 'th')
      );
    }
    return source
      .filter((item) => {
        const text = [
          item?.name,
          item?.code,
          item?.barcode,
          item?.unit_name,
          item?.unit_abbr
        ]
          .map((value) => String(value || '').toLowerCase())
          .join(' ');
        return text.includes(search);
      })
      .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'th'));
  }, [supplierProducts, supplierProductsSearch]);

  const columns = [
    {
      header: 'รหัส',
      accessor: 'code',
      wrap: true,
      render: (row) => (
        <button
          type="button"
          onClick={() => openEdit(row)}
          className="text-left hover:underline text-gray-700"
        >
          {row.code || '-'}
        </button>
      )
    },
    {
      header: 'ชื่อซัพพลายเออร์',
      accessor: 'name',
      wrap: true,
      render: (row) => (
        <button
          type="button"
          onClick={() => openEdit(row)}
          className={`text-left hover:underline ${
            Number(selectedId) === Number(row.id) && !isCreating
              ? 'font-semibold text-blue-700'
              : 'text-gray-900'
          }`}
        >
          {row.name}
        </button>
      )
    }
  ];

  return (
    <Layout mainClassName="!max-w-none !px-3 md:!px-4 !py-3">
      <div className="w-full">
        <div className="mb-3">
          <BackToSettings />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-3 md:p-4 mb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold text-gray-900">จัดการซัพพลายเออร์</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                เลือกรายการฝั่งซ้าย แล้วแก้ไขรายละเอียดฝั่งขวา
              </p>
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              + เพิ่มซัพพลายเออร์
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-gray-500">ทั้งหมด</p>
              <p className="text-base font-semibold text-gray-900">{suppliers.length}</p>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-gray-500">ที่แสดง</p>
              <p className="text-base font-semibold text-gray-900">{filteredSuppliers.length}</p>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-gray-500">โหมดแก้ไข</p>
              <p className="text-base font-semibold text-gray-900">{panelOpen ? 'เปิด' : 'ปิด'}</p>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-gray-500">สถานะ</p>
              <p className="text-base font-semibold text-gray-900">{loading ? 'กำลังบันทึก' : 'พร้อมใช้งาน'}</p>
            </div>
          </div>

          <div className="mt-3">
            <Input
              label="ค้นหาซัพพลายเออร์"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ชื่อ / รหัส / ผู้ติดต่อ / เบอร์ / Line"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-3">
          <div className="min-h-0">
            <DataTable
              columns={columns}
              data={filteredSuppliers}
              dense
              fitColumns
              allowHorizontalScroll={false}
              showActions={false}
            />
          </div>

          <div className="min-h-0">
            {panelOpen ? (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden h-full flex flex-col">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-800">
                      {isCreating ? 'เพิ่มซัพพลายเออร์ใหม่' : 'แก้ไขซัพพลายเออร์'}
                    </h2>
                    {!isCreating && selectedSupplier ? (
                      <p className="text-xs text-gray-500">
                        {selectedSupplier.name} {selectedSupplier.code ? `(${selectedSupplier.code})` : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isCreating && selectedSupplier ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openAssignProducts(selectedSupplier)}
                          className="px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 text-xs font-medium hover:bg-emerald-50"
                        >
                          เพิ่มสินค้า
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(selectedSupplier)}
                          className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50"
                        >
                          ลบซัพพลายเออร์
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={closeEditor}
                      className="text-gray-400 hover:text-gray-700 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-200 text-lg"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4">
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="รหัส"
                        value={formData.code}
                        onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))}
                        placeholder="เว้นว่างให้ระบบกำหนด"
                      />
                      <Input
                        label="ชื่อซัพพลายเออร์"
                        value={formData.name}
                        onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="ผู้ติดต่อ"
                        value={formData.contact_person}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, contact_person: e.target.value }))
                        }
                      />
                      <Input
                        label="เบอร์โทร"
                        value={formData.phone}
                        onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Line ID"
                        value={formData.line_id}
                        onChange={(e) => setFormData((prev) => ({ ...prev, line_id: e.target.value }))}
                      />
                      <Input
                        label="ที่อยู่"
                        value={formData.address}
                        onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                      />
                    </div>

                    <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={Boolean(formData.has_bank_account)}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            has_bank_account: e.target.checked
                          }))
                        }
                      />
                      <span className="text-sm text-gray-700">มีข้อมูลบัญชีธนาคารสำหรับโอน</span>
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อธนาคาร</label>
                        <select
                          value={formData.bank_name}
                          onChange={(e) => setFormData((prev) => ({ ...prev, bank_name: e.target.value }))}
                          disabled={!formData.has_bank_account}
                          className="w-full px-3 py-2 border rounded-lg text-sm bg-white disabled:bg-gray-100"
                        >
                          <option value="">-- เลือกธนาคาร --</option>
                          {THAI_BANK_OPTIONS.map((bank) => (
                            <option key={bank.code} value={bank.name}>
                              {bank.name} ({bank.accountLength} หลัก)
                            </option>
                          ))}
                        </select>
                      </div>
                      <Input
                        label="เลขบัญชี"
                        value={formData.account_number}
                        onChange={(e) => setFormData((prev) => ({ ...prev, account_number: e.target.value }))}
                        disabled={!formData.has_bank_account}
                      />
                      <Input
                        label="ชื่อบัญชี"
                        value={formData.account_name}
                        onChange={(e) => setFormData((prev) => ({ ...prev, account_name: e.target.value }))}
                        disabled={!formData.has_bank_account}
                      />
                    </div>

                    {formData.has_bank_account && (
                      <p className="text-xs text-gray-500">
                        {(() => {
                          const selectedBank = THAI_BANK_OPTIONS.find(
                            (bank) => bank.name === formData.bank_name
                          );
                          if (!selectedBank) return 'เลขบัญชีต้องเป็นตัวเลข 10-12 หลัก';
                          return `เลขบัญชีของธนาคารนี้ควรมี ${selectedBank.accountLength} หลัก`;
                        })()}
                      </p>
                    )}

                    {!isCreating && selectedSupplier ? (
                      <div className="border-t border-gray-100 pt-4 mt-2 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-gray-800">
                            สินค้าในซัพนี้ ({filteredSupplierProducts.length})
                          </h3>
                          {supplierProductsLoading ? (
                            <span className="text-xs text-gray-500">กำลังโหลด...</span>
                          ) : null}
                        </div>
                        <Input
                          label="ค้นหาสินค้าในซัพนี้"
                          value={supplierProductsSearch}
                          onChange={(e) => setSupplierProductsSearch(e.target.value)}
                          placeholder="พิมพ์ชื่อสินค้า / รหัส / บาร์โค้ด"
                        />
                        <div className="rounded-lg border border-gray-200 divide-y">
                          {supplierProductsLoading ? (
                            <div className="px-3 py-6 text-sm text-center text-gray-500">
                              กำลังโหลดรายการสินค้า...
                            </div>
                          ) : filteredSupplierProducts.length === 0 ? (
                            <div className="px-3 py-6 text-sm text-center text-gray-500">
                              ไม่พบสินค้าในซัพพลายเออร์นี้
                            </div>
                          ) : (
                            filteredSupplierProducts.map((product) => (
                              <div key={product.id} className="px-3 py-2.5 space-y-2">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">
                                      {product.name}
                                    </p>
                                    <p className="text-xs text-gray-500 truncate">
                                      หน่วยฐาน: {getBaseUnitLabel(product)}
                                      {product.barcode ? ` • บาร์โค้ด: ${product.barcode}` : ''}
                                    </p>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_auto] gap-2">
                                  <div className="flex items-center gap-2">
                                    <label className="text-[11px] text-gray-500 whitespace-nowrap">
                                      หน่วยซื้อ
                                    </label>
                                    <select
                                      value={supplierUnitDrafts[product.id]?.purchase_unit_id || ''}
                                      onChange={(e) =>
                                        handleSupplierDraftChange(
                                          product.id,
                                          'purchase_unit_id',
                                          e.target.value
                                        )
                                      }
                                      disabled={savingUnitProductId === product.id}
                                      className="flex-1 min-w-0 px-2.5 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-100"
                                    >
                                      <option value="">-- ไม่ระบุ --</option>
                                      {units.map((unit) => (
                                        <option key={unit.id} value={unit.id}>
                                          {unit.name}
                                          {unit.abbr ? ` (${unit.abbr})` : ''}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <label className="text-[11px] text-gray-500 whitespace-nowrap">
                                      ตัวคูณ
                                    </label>
                                    <input
                                      type="number"
                                      step="0.0001"
                                      min="0"
                                      value={supplierUnitDrafts[product.id]?.purchase_to_base_multiplier || ''}
                                      onChange={(e) =>
                                        handleSupplierDraftChange(
                                          product.id,
                                          'purchase_to_base_multiplier',
                                          e.target.value
                                        )
                                      }
                                      disabled={savingUnitProductId === product.id}
                                      className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-100"
                                      placeholder="เช่น 12"
                                    />
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleSaveSupplierUnitConfig(product)}
                                    disabled={savingUnitProductId === product.id}
                                    className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:bg-blue-300"
                                  >
                                    {savingUnitProductId === product.id ? 'กำลังบันทึก...' : 'บันทึกแปลง'}
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={closeEditor}
                        className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
                      >
                        {loading ? 'กำลังบันทึก...' : isCreating ? 'บันทึกซัพพลายเออร์' : 'บันทึกการแก้ไข'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-500">
                เลือกซัพพลายเออร์จากฝั่งซ้าย หรือกด “เพิ่มซัพพลายเออร์” เพื่อเริ่มกรอกข้อมูล
              </div>
            )}
          </div>
        </div>

        <Modal
          isOpen={isProductModalOpen}
          onClose={() => {
            if (productSaving) return;
            setIsProductModalOpen(false);
            resetProductSelection();
          }}
          title="เพิ่มสินค้าเข้า ซัพพลายเออร์"
          size="large"
        >
          <form onSubmit={handleAssignProducts} className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              ซัพพลายเออร์: <span className="font-medium">{targetSupplier?.name || '-'}</span>
            </div>
            <Input
              label="ค้นหาสินค้า"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="พิมพ์ชื่อหรือรหัสสินค้า"
            />
            <div className="rounded-lg border border-gray-200 px-3 py-2">
              <p className="text-xs text-gray-500 mb-2">ตัวกรองตามกลุ่มสินค้า</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleGroupFilterSelect('')}
                  className={`rounded-lg px-3 py-1.5 text-xs border transition ${
                    !selectedGroupId
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  ทั้งหมด
                </button>
                {productGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => handleGroupFilterSelect(String(group.id))}
                    className={`rounded-lg px-3 py-1.5 text-xs border transition ${
                      String(selectedGroupId) === String(group.id)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <div>เลือกแล้ว {selectedProductIds.size} รายการ</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSelectUnassigned}
                  className="rounded-full border border-gray-200 px-3 py-1 text-gray-600 hover:bg-gray-50"
                >
                  เลือกเฉพาะที่ยังไม่ระบุซัพพลายเออร์
                </button>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="rounded-full border border-gray-200 px-3 py-1 text-gray-600 hover:bg-gray-50"
                >
                  เลือกทั้งหมด
                </button>
              </div>
            </div>
            <div className="border rounded-lg max-h-[360px] overflow-y-auto">
              {productsLoading ? (
                <div className="px-4 py-6 text-center text-gray-500">กำลังโหลดสินค้า...</div>
              ) : (
                <div className="divide-y">
                  {filteredProducts.map((product) => {
                    const isAssigned = Number(product.supplier_master_id) === Number(targetSupplier?.id);
                    const isSelected = selectedProductIds.has(product.id);
                    return (
                      <label
                        key={product.id}
                        className={`flex items-center gap-3 px-4 py-3 text-sm ${
                          isAssigned ? 'text-gray-400' : 'text-gray-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={isAssigned}
                          checked={isSelected}
                          onChange={() => toggleProductSelection(product.id)}
                        />
                        <div className="flex-1">
                          <div className="font-medium">{product.name}</div>
                          <div className="text-xs text-gray-500">
                            {product.code || '-'} • {product.unit_abbr || product.unit_name || '-'}
                            {product.barcode ? ` • บาร์โค้ด: ${product.barcode}` : ''}
                            {product.qr_code ? ` • QR: ${product.qr_code}` : ''}
                            {product.supplier_master_name
                              ? ` • ปัจจุบัน: ${product.supplier_master_name}`
                              : ' • ยังไม่ระบุซัพพลายเออร์'}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <div className="px-4 py-6 text-center text-gray-500">ไม่พบสินค้า</div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setIsProductModalOpen(false);
                  resetProductSelection();
                }}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                disabled={productSaving}
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={productSaving}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-emerald-300"
              >
                {productSaving ? 'กำลังบันทึก...' : 'บันทึกการเพิ่มสินค้า'}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </Layout>
  );
};
