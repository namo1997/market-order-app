import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';
import { productsAPI } from '../../api/products';
import { useAuth } from '../../contexts/AuthContext';
import { ordersAPI } from '../../api/orders';

const todayString = new Date().toISOString().split('T')[0];

const formatDisplayDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('th-TH');
};

const formatDisplayTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit'
  });
};

const toNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeSupplierOptions = (payload) => {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return list
    .map((item) => ({
      id: item?.id ?? item?.supplier_id ?? item?.product_group_id ?? null,
      name: item?.name ?? item?.supplier_name ?? item?.product_group_name ?? ''
    }))
    .filter((item) => item.id !== null && item.name);
};

const isItemSaved = (item) => Boolean(item.received_at) || Boolean(item.saved_local);
const MANUAL_REASON_OPTIONS = [
  { value: 'wrong-purchase', label: 'ไม่ได้สั่งแต่ซื้อผิด' },
  { value: 'off-cycle', label: 'สั่งนอกรอบ' },
  { value: 'other', label: 'อื่นๆ' }
];

export const ReceiveOrders = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('receive');
  const [date, setDate] = useState(todayString);
  const [receiveScope, setReceiveScope] = useState('mine');
  const [items, setItems] = useState([]);
  const [historyItems, setHistoryItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingSupplierId, setSavingSupplierId] = useState(null);
  const [savingItemKey, setSavingItemKey] = useState(null);
  const [editingItemKeys, setEditingItemKeys] = useState([]);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualSupplierId, setManualSupplierId] = useState(null);
  const [manualProducts, setManualProducts] = useState([]);
  const [manualLoadingProducts, setManualLoadingProducts] = useState(false);
  const [manualProductsLoaded, setManualProductsLoaded] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualProductSearch, setManualProductSearch] = useState('');
  const [manualProductMenuOpen, setManualProductMenuOpen] = useState(false);
  const [createProductSearch, setCreateProductSearch] = useState('');
  const [createProductMenuOpen, setCreateProductMenuOpen] = useState(false);
  const [createLastMatchedName, setCreateLastMatchedName] = useState('');
  const [createDraftItems, setCreateDraftItems] = useState([]);
  const [manualReason, setManualReason] = useState('wrong-purchase');
  const [manualOtherReason, setManualOtherReason] = useState('');
  const [createSuppliers, setCreateSuppliers] = useState([]);
  const [createSuppliersLoading, setCreateSuppliersLoading] = useState(false);
  const [createSupplierId, setCreateSupplierId] = useState('');
  const [manualForm, setManualForm] = useState({
    product_id: '',
    received_quantity: ''
  });

  if (isAdmin) {
    return <Navigate to="/admin/orders" replace />;
  }

  const normalizeItems = (data) => {
    if (!Array.isArray(data)) return [];
    return data.map((item) => {
      // ใช้ product_id เป็น key หลักสำหรับ branch scope
      const itemKey = receiveScope === 'branch'
        ? `product_${item.product_id}_${item.supplier_id || 'none'}`
        : `item_${item.order_item_id}`;

      return {
        ...item,
        item_key: itemKey,
        saved_local: false,
        received_quantity:
          item.received_quantity === null || item.received_quantity === undefined
            ? ''
            : String(item.received_quantity),
        is_received: Boolean(item.is_received)
      };
    });
  };

  const extractItems = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.data)) return payload.data;
    return [];
  };

  const extractProducts = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.data)) return payload.data;
    return [];
  };

  const resetManualForm = () => {
    setManualForm({
      product_id: '',
      received_quantity: ''
    });
    setManualProductSearch('');
    setManualProductMenuOpen(false);
    setManualReason('wrong-purchase');
    setManualOtherReason('');
  };

  const loadManualProducts = async ({ supplierId, supplierMasterId } = {}) => {
    try {
      setManualLoadingProducts(true);
      const filters = {};
      if (supplierId !== undefined && supplierId !== null) {
        filters.supplierId = supplierId;
      }
      if (supplierMasterId !== undefined && supplierMasterId !== null) {
        filters.supplierMasterId = supplierMasterId;
      }
      filters.bypassScope = true;
      const response = await productsAPI.getProducts(filters);
      const productList = extractProducts(response);
      setManualProducts(Array.isArray(productList) ? productList : []);
      setManualProductsLoaded(true);
    } catch (error) {
      console.error('Error loading products for manual receive:', error);
      alert('ไม่สามารถโหลดรายการสินค้าได้');
      setManualProducts([]);
      setManualProductsLoaded(false);
    } finally {
      setManualLoadingProducts(false);
    }
  };

  const loadCreateSuppliers = async () => {
    try {
      setCreateSuppliersLoading(true);
      const supplierRows = await productsAPI.getSupplierMasters();
      const options = normalizeSupplierOptions(supplierRows).sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), 'th')
      );
      setCreateSuppliers(options);
    } catch (error) {
      console.error('Error loading suppliers for create receiving:', error);
      alert('ไม่สามารถโหลดซัพพลายเออร์ได้');
      setCreateSuppliers([]);
    } finally {
      setCreateSuppliersLoading(false);
    }
  };

  const normalizeScanToken = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');

  const findProductByScanCode = (rawCode, sourceProducts = manualProducts) => {
    const target = normalizeScanToken(rawCode);
    if (!target) return null;
    return sourceProducts.find((product) => {
      const candidates = [
        product?.barcode,
        product?.qr_code,
        product?.code
      ];
      return candidates.some((value) => normalizeScanToken(value) === target);
    }) || null;
  };

  const handleCreateSupplierChange = async (value) => {
    setCreateSupplierId(value);
    setManualForm((prev) => ({ ...prev, product_id: '' }));
    setCreateProductSearch('');
    setCreateProductMenuOpen(false);
    setCreateLastMatchedName('');
    setCreateDraftItems([]);
    setManualProducts([]);
    setManualProductsLoaded(false);

    const supplierMasterId = Number(value);
    if (!Number.isFinite(supplierMasterId)) {
      return;
    }
    await loadManualProducts({ supplierMasterId });
  };

  const addOrIncrementCreateDraftItem = (product) => {
    if (!product?.id) return;
    setCreateDraftItems((prev) => {
      const productIdText = String(product.id);
      const existingIndex = prev.findIndex((item) => String(item.product_id) === productIdText);
      if (existingIndex >= 0) {
        return prev.map((item, index) =>
          index === existingIndex
            ? {
              ...item,
              received_quantity: String((Number(item.received_quantity) || 0) + 1)
            }
            : item
        );
      }
      return [
        ...prev,
        {
          product_id: productIdText,
          product_name: product.name || '-',
          product_code: product.code || '',
          barcode: product.barcode || '',
          unit_label: product.unit_abbr || product.unit_name || '',
          received_quantity: '1'
        }
      ];
    });
  };

  const handleSelectCreateProduct = (product) => {
    addOrIncrementCreateDraftItem(product);
    setCreateLastMatchedName(product?.name || '');
    setCreateProductSearch('');
    setCreateProductMenuOpen(false);
  };

  const handleCreateProductLookupSubmit = () => {
    const keyword = String(createProductSearch || '').trim();
    if (!keyword) return;

    if (!createSupplierId) {
      alert('กรุณาเลือกซัพพลายเออร์ก่อน');
      return;
    }
    if (manualLoadingProducts) {
      alert('กำลังโหลดสินค้า กรุณารอสักครู่');
      return;
    }
    if (!Array.isArray(manualProducts) || manualProducts.length === 0) {
      alert('ยังไม่มีรายการสินค้าในซัพพลายเออร์นี้');
      return;
    }

    const exactMatched = findProductByScanCode(keyword, manualProducts);
    if (exactMatched) {
      handleSelectCreateProduct(exactMatched);
      return;
    }

    const oneMatch = filteredCreateProducts.length === 1 ? filteredCreateProducts[0] : null;
    if (oneMatch) {
      handleSelectCreateProduct(oneMatch);
      return;
    }

    setCreateProductMenuOpen(true);
  };

  const handleCreateDraftQuantityChange = (productId, value) => {
    setCreateDraftItems((prev) =>
      prev.map((item) =>
        String(item.product_id) === String(productId)
          ? {
            ...item,
            received_quantity: value
          }
          : item
      )
    );
  };

  const handleRemoveCreateDraftItem = (productId) => {
    setCreateDraftItems((prev) =>
      prev.filter((item) => String(item.product_id) !== String(productId))
    );
  };

  const handleSaveCreateDraftItems = async () => {
    if (!Number.isFinite(Number(createSupplierId))) {
      alert('กรุณาเลือกซัพพลายเออร์ก่อน');
      return;
    }
    if (createDraftItems.length === 0) {
      alert('ยังไม่มีรายการที่ต้องการรับสินค้า');
      return;
    }

    const invalidItem = createDraftItems.find((item) => {
      const qty = Number(item.received_quantity);
      return !Number.isFinite(qty) || qty <= 0;
    });
    if (invalidItem) {
      alert(`กรุณาตรวจสอบจำนวนสินค้า: ${invalidItem.product_name}`);
      return;
    }

    try {
      setManualSaving(true);
      for (const item of createDraftItems) {
        await ordersAPI.createManualReceivingItem({
          date,
          product_id: Number(item.product_id),
          received_quantity: Number(item.received_quantity)
        });
      }
      setCreateDraftItems([]);
      setCreateProductSearch('');
      setCreateProductMenuOpen(false);
      setCreateLastMatchedName('');
      await handleLoadHistory();
    } catch (error) {
      console.error('Error creating manual receiving items:', error);
      alert(error.response?.data?.message || 'บันทึกรับสินค้าไม่สำเร็จ');
    } finally {
      setManualSaving(false);
    }
  };

  const handleLoadItems = async () => {
    try {
      setLoading(true);
      const response = await ordersAPI.getReceivingItems(date, receiveScope);
      const rawItems = extractItems(response);
      setItems(normalizeItems(rawItems));
      setEditingItemKeys([]);
    } catch (error) {
      console.error('Error loading receiving items:', error);
      alert(error.response?.data?.message || 'ไม่สามารถโหลดรายการรับของได้');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadHistory = async () => {
    try {
      setHistoryLoading(true);
      const response = await ordersAPI.getReceivingHistory({
        date,
        scope: receiveScope
      });
      const rawItems = extractItems(response);
      setHistoryItems(Array.isArray(rawItems) ? rawItems : []);
    } catch (error) {
      console.error('Error loading receiving history:', error);
      alert(error.response?.data?.message || 'ไม่สามารถโหลดประวัติการรับสินค้าได้');
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSelectTab = (tabKey) => {
    if (tabKey === 'create') {
      setActiveTab('receive');
      return;
    }
    setActiveTab(tabKey);
    if (tabKey === 'create') {
      setManualModalOpen(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'receive') {
      handleLoadItems();
      return;
    }
    if (activeTab === 'history') {
      handleLoadHistory();
      return;
    }
    // create tab removed
  }, [activeTab, date, receiveScope]);

  const handleItemQuantityChange = (itemKey, value) => {
    setItems((prev) =>
      prev.map((item) =>
        item.item_key === itemKey
          ? {
            ...item,
            received_quantity: value,
            is_received: value !== ''
          }
          : item
      )
    );
  };

  const saveReceivingItems = async (
    targetItems,
    {
      supplierId = null,
      itemKey = null,
      silentSuccess = false,
      reloadAfterSave = true,
      onSuccess = null
    } = {}
  ) => {
    if (targetItems.length === 0) {
      alert('ไม่มีรายการให้บันทึก');
      return;
    }

    try {
      setSaving(true);
      setSavingSupplierId(supplierId);
      setSavingItemKey(itemKey);

      const payload = targetItems.map((item) => {
        if (receiveScope === 'branch') {
          // สำหรับ branch scope: ส่งข้อมูลสินค้าที่รวมแล้ว
          return {
            product_id: item.product_id,
            supplier_id: item.supplier_id,
            received_quantity: toNumber(item.received_quantity),
            is_received: item.is_received,
            order_item_ids: item.order_item_ids, // ids ของ order_items ทั้งหมด
            items_data: item.items_data // ข้อมูลสำหรับแบ่งสัดส่วน
          };
        } else {
          // สำหรับ mine scope: ส่งแบบเดิม
          return {
            order_item_id: item.order_item_id,
            received_quantity: toNumber(item.received_quantity),
            is_received: item.is_received
          };
        }
      });

      await ordersAPI.updateReceivingItems(payload, receiveScope);
      const targetKeys = new Set(
        targetItems
          .map((item) => item.item_key)
          .filter(Boolean)
      );
      if (targetKeys.size > 0) {
        setEditingItemKeys((prev) => prev.filter((key) => !targetKeys.has(key)));
      }
      if (typeof onSuccess === 'function') {
        onSuccess();
      }
      if (reloadAfterSave) {
        handleLoadItems();
      }
      if (!silentSuccess) {
        alert('บันทึกรับของแล้ว');
      }
    } catch (error) {
      console.error('Error saving receiving items:', error);
      alert('บันทึกรับของไม่สำเร็จ');
    } finally {
      setSaving(false);
      setSavingSupplierId(null);
      setSavingItemKey(null);
    }
  };

  const handleSaveSupplier = (supplierId) => {
    const supplierItems = items.filter(
      (item) => String(item.supplier_id || 'none') === String(supplierId || 'none')
    );
    saveReceivingItems(supplierItems, { supplierId });
  };

  const handleOpenManualModal = async (supplierId) => {
    setManualSupplierId(supplierId);
    resetManualForm();
    setManualProducts([]);
    setManualProductsLoaded(false);
    setManualModalOpen(true);

    const supplierParam =
      supplierId && String(supplierId) !== 'none' ? Number(supplierId) : undefined;
    await loadManualProducts(
      supplierParam !== undefined ? { supplierId: supplierParam } : {}
    );
  };

  const handleCreateManualItem = async () => {
    const productId = Number(manualForm.product_id);
    const receivedQuantity = Number(manualForm.received_quantity);
    const shouldUseReason = activeTab !== 'create';
    const reasonLabel = MANUAL_REASON_OPTIONS.find((option) => option.value === manualReason)?.label;
    const otherReasonText = manualOtherReason.trim();
    const reasonText = shouldUseReason
      ? (manualReason === 'other' ? otherReasonText : reasonLabel)
      : '';
    const selectedCreateSupplierId = Number(createSupplierId);

    if (activeTab === 'create' && !Number.isFinite(selectedCreateSupplierId)) {
      alert('กรุณาเลือกซัพพลายเออร์ก่อน');
      return;
    }

    if (!Number.isFinite(productId)) {
      alert('กรุณาเลือกสินค้า');
      return;
    }
    if (!Number.isFinite(receivedQuantity) || receivedQuantity <= 0) {
      alert('กรุณากรอกจำนวนรับให้มากกว่า 0');
      return;
    }
    if (shouldUseReason && !reasonText) {
      alert('กรุณาระบุหมายเหตุ');
      return;
    }

    try {
      setManualSaving(true);
      const payload = {
        date,
        product_id: productId,
        received_quantity: receivedQuantity
      };
      if (shouldUseReason && reasonText) {
        payload.receive_notes = reasonText;
      }

      await ordersAPI.createManualReceivingItem(payload);
      setManualModalOpen(false);
      setManualProductMenuOpen(false);
      resetManualForm();
      await handleLoadItems();
      if (activeTab === 'history') {
        await handleLoadHistory();
      }
    } catch (error) {
      console.error('Error creating manual receiving item:', error);
      alert(error.response?.data?.message || 'เพิ่มสินค้านอกใบสั่งไม่สำเร็จ');
    } finally {
      setManualSaving(false);
    }
  };

  const handleSaveSingleItem = (item) => {
    const orderedQty = Number(item.quantity || 0);
    const currentQty = toNumber(item.received_quantity);
    const isCustomQty = currentQty !== null && Number((currentQty - orderedQty).toFixed(2)) !== 0;
    const quantityToSave = isCustomQty ? currentQty : orderedQty;

    if (quantityToSave === null) {
      alert('กรุณากรอกจำนวนรับก่อนบันทึก');
      return;
    }

    const nextItem = {
      ...item,
      received_quantity: String(quantityToSave),
      is_received: true
    };

    saveReceivingItems([nextItem], {
      supplierId: item.supplier_id || null,
      itemKey: item.item_key,
      silentSuccess: true,
      reloadAfterSave: false,
      onSuccess: () => {
        setItems((prev) =>
          prev.map((row) =>
            row.item_key === item.item_key
              ? {
                ...row,
                received_quantity: String(quantityToSave),
                is_received: true,
                received_at: row.received_at || new Date().toISOString(),
                saved_local: true
              }
              : row
          )
        );
      }
    });
  };

  const handleStartEditItem = (itemKey) => {
    setEditingItemKeys((prev) => (prev.includes(itemKey) ? prev : [...prev, itemKey]));
  };

  const grouped = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      const supplierId = item.supplier_id || 'none';
      const supplierName = item.supplier_name || 'ไม่ระบุกลุ่มสินค้า';
      if (!map.has(supplierId)) {
        map.set(supplierId, {
          supplier_id: supplierId,
          supplier_name: supplierName,
          items: []
        });
      }
      map.get(supplierId).items.push(item);
    });

    return Array.from(map.values())
      .map((supplier) => ({
        ...supplier,
        items: [...supplier.items].sort((a, b) => {
          const aSaved = isItemSaved(a);
          const bSaved = isItemSaved(b);
          if (aSaved !== bSaved) return aSaved ? 1 : -1;
          return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th');
        })
      }))
      .sort((a, b) =>
        String(a.supplier_name || '').localeCompare(String(b.supplier_name || ''), 'th')
      );
  }, [items]);

  const groupedHistory = useMemo(() => {
    const map = new Map();

    historyItems.forEach((item) => {
      const parsedDate = item.received_at ? new Date(item.received_at) : null;
      const dateKey =
        parsedDate && !Number.isNaN(parsedDate.getTime())
          ? parsedDate.toISOString().split('T')[0]
          : 'unknown';

      if (!map.has(dateKey)) {
        map.set(dateKey, {
          date: dateKey,
          items: []
        });
      }

      map.get(dateKey).items.push(item);
    });

    return Array.from(map.values())
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) =>
          String(b.received_at || '').localeCompare(String(a.received_at || ''))
        )
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [historyItems]);

  const filteredCreateProducts = useMemo(() => {
    const searchText = normalizeScanToken(createProductSearch);
    const source = Array.isArray(manualProducts) ? manualProducts : [];
    if (!searchText) return source.slice(0, 30);
    return source
      .filter((product) => {
        const tokenText = normalizeScanToken(
          `${product.name || ''} ${product.code || ''} ${product.barcode || ''} ${product.qr_code || ''}`
        );
        return tokenText.includes(searchText);
      })
      .slice(0, 30);
  }, [manualProducts, createProductSearch]);

  const filteredManualProducts = useMemo(() => {
    const searchText = String(manualProductSearch || '').trim().toLowerCase();
    const source = Array.isArray(manualProducts) ? manualProducts : [];
    if (!searchText) return source.slice(0, 30);
    return source
      .filter((product) =>
        `${product.name || ''} ${product.code || ''}`.toLowerCase().includes(searchText)
      )
      .slice(0, 30);
  }, [manualProducts, manualProductSearch]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto w-full">
        <div className="mb-4">
          <Button
            variant="secondary"
            onClick={() => navigate('/function-select')}
          >
            ← ย้อนกลับ
          </Button>
        </div>

        <Card className="mb-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleSelectTab('receive')}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                activeTab === 'receive'
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              การรับสินค้า
            </button>
            <button
              type="button"
              onClick={() => handleSelectTab('history')}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              ประวัติการรับสินค้า
            </button>
          </div>
        </Card>

        <Card className="mb-4">
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                {activeTab === 'history'
                  ? 'วันที่ประวัติรับสินค้า'
                  : 'วันที่รับของ'}
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-2">ขอบเขตรับสินค้า</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="receiveScope"
                    value="mine"
                    checked={receiveScope === 'mine'}
                    onChange={() => setReceiveScope('mine')}
                    className="h-4 w-4 text-blue-600"
                  />
                  รับเฉพาะคำสั่งซื้อของฉัน
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="receiveScope"
                    value="branch"
                    checked={receiveScope === 'branch'}
                    onChange={() => setReceiveScope('branch')}
                    className="h-4 w-4 text-blue-600"
                  />
                  รับสินค้าทั้งสาขา
                </label>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                ถ้าเลือกทั้งสาขา รายการจะรวมทุกแผนกในสาขาเดียวกัน
              </p>
            </div>

            {/* โหลดข้อมูลอัตโนมัติตามแท็บ/วันที่ */}
          </div>
        </Card>

        {activeTab === 'receive' ? (
          loading ? (
            <Loading />
          ) : grouped.length === 0 ? (
            <div className="text-center text-gray-500 py-12">ยังไม่มีรายการรับของ</div>
          ) : (
            <div className="space-y-4">
              {grouped.map((supplier) => {
                const totalItems = supplier.items.length;
                const completedItems = supplier.items.filter((item) => {
                  const orderedQty = Number(item.quantity || 0);
                  const receivedQty = toNumber(item.received_quantity);
                  if (receivedQty === null) return false;
                  return Number((receivedQty - orderedQty).toFixed(2)) === 0;
                }).length;

                return (
                  <Card key={supplier.supplier_id}>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {supplier.supplier_name}
                        </h3>
                        <p className="text-xs text-gray-500">
                          รับแล้ว {completedItems}/{totalItems} รายการ
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => handleOpenManualModal(supplier.supplier_id)}
                          disabled={saving}
                        >
                          เพิ่มสินค้า
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => handleSaveSupplier(supplier.supplier_id)}
                          disabled={saving}
                        >
                          {saving && String(savingSupplierId) === String(supplier.supplier_id)
                            ? 'กำลังบันทึก...'
                            : 'บันทึกรับของกลุ่มสินค้านี้'}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {supplier.items.map((item) => {
                        const orderedQty = Number(item.quantity || 0);
                        const receivedQty = toNumber(item.received_quantity);
                        const isEditing = editingItemKeys.includes(item.item_key);
                        const isLocked = Boolean(item.received_at) && !isEditing;
                        const canShowEditButton = Boolean(item.received_at) && !isEditing;
                        const diff =
                          receivedQty === null ? null : Number((receivedQty - orderedQty).toFixed(2));
                        const isCustomQty = diff !== null && diff !== 0;
                        const isShort = diff !== null && diff < 0;
                        const purchaseShortReason = String(item.purchase_reason || '').trim();

                        const unitLabel = item.unit_abbr || item.unit_name || '';
                        const inputStateClass =
                          diff === 0
                            ? 'border-green-300 text-green-700'
                            : isShort
                              ? 'border-amber-300 text-amber-700'
                              : 'border-gray-200 text-gray-700';

                        return (
                          <div
                            key={item.item_key}
                            className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm whitespace-nowrap"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-gray-900">
                                {item.product_name}
                              </span>
                              {isShort ? (
                                <span className="block text-xs text-amber-700">
                                  ขาด {Math.abs(diff)} {unitLabel}
                                </span>
                              ) : null}
                              {isShort && purchaseShortReason ? (
                                <span className="mt-0.5 block whitespace-normal break-words text-[11px] text-slate-500">
                                  เหตุผลที่ซื้อขาด: {purchaseShortReason}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-500">
                              {orderedQty} {unitLabel}
                            </div>
                            <input
                              type="number"
                              step="0.01"
                              value={item.received_quantity}
                              onChange={(e) => handleItemQuantityChange(item.item_key, e.target.value)}
                              disabled={isLocked}
                              className={`w-10 rounded-lg border px-1.5 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                isLocked
                                  ? diff === 0
                                    ? 'bg-green-50 text-green-700 border-green-300'
                                    : isShort
                                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                                      : 'border-gray-200 bg-gray-100 text-gray-500'
                                  : inputStateClass
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                canShowEditButton
                                  ? handleStartEditItem(item.item_key)
                                  : handleSaveSingleItem(item)
                              }
                              disabled={saving}
                              className={`h-8 flex items-center justify-center rounded-lg border text-green-600 ${
                                canShowEditButton
                                  ? 'px-2.5 text-xs font-semibold min-w-[56px]'
                                  : isCustomQty
                                    ? 'px-2.5 text-xs font-semibold min-w-[56px]'
                                    : 'w-8'
                              } ${
                                saving
                                  ? 'border-gray-200 bg-gray-100 text-gray-400'
                                  : canShowEditButton
                                    ? 'border-amber-200 text-black hover:bg-amber-50'
                                    : 'border-gray-200 hover:bg-green-50'
                              }`}
                              title={
                                canShowEditButton
                                  ? 'แก้ไขรายการที่บันทึกแล้ว'
                                  : isCustomQty
                                    ? 'บันทึกจำนวนที่กรอก'
                                    : 'บันทึกตามจำนวนที่สั่ง'
                              }
                            >
                              {saving && savingItemKey === item.item_key
                                ? '...'
                                : canShowEditButton
                                  ? 'แก้ไข'
                                  : isCustomQty
                                    ? 'บันทึก'
                                    : '✓'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </div>
          )
        ) : activeTab === 'create' ? (
          <Card>
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900">สร้างการรับสินค้า</h3>
              <p className="text-xs text-gray-500 mt-1">
                ใช้สำหรับรับสินค้าเข้าระบบโดยไม่ต้องมีการสั่งของก่อน
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">ซัพพลายเออร์</label>
                <select
                  value={createSupplierId}
                  onChange={(e) => handleCreateSupplierChange(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={createSuppliersLoading || manualSaving}
                >
                  <option value="">เลือกซัพพลายเออร์</option>
                  {createSuppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                {!createSuppliersLoading && createSuppliers.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">ยังไม่มีข้อมูลซัพพลายเออร์ในระบบ</p>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-500">ค้นหา / ยิงบาร์โค้ดสินค้า</label>
                {manualLoadingProducts ? (
                  <div className="text-sm text-gray-500">กำลังโหลดสินค้า...</div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={createProductSearch}
                      onFocus={() => setCreateProductMenuOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => setCreateProductMenuOpen(false), 120);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          handleCreateProductLookupSubmit();
                        }
                      }}
                      onChange={(e) => {
                        const searchValue = e.target.value;
                        setCreateProductSearch(searchValue);
                        setCreateProductMenuOpen(true);
                      }}
                      placeholder={
                        createSupplierId
                          ? 'ยิงบาร์โค้ด หรือพิมพ์ชื่อ/รหัสสินค้า'
                          : 'เลือกซัพพลายเออร์ก่อน'
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={!createSupplierId}
                    />
                    {createProductMenuOpen && (
                      <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                        {filteredCreateProducts.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-gray-500">ไม่พบสินค้า</div>
                        ) : (
                          filteredCreateProducts.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              className="w-full border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-gray-50"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectCreateProduct(product);
                              }}
                            >
                              <div className="font-medium text-gray-900">{product.name}</div>
                              {product.code || product.barcode || product.qr_code ? (
                                <div className="text-xs text-gray-500">
                                  {product.code ? `รหัส ${product.code}` : ''}
                                  {product.barcode ? ` • บาร์โค้ด ${product.barcode}` : ''}
                                  {product.qr_code ? ` • QR ${product.qr_code}` : ''}
                                </div>
                              ) : null}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  ยิงโค้ดแล้วกด Enter จะเพิ่มจำนวนให้อัตโนมัติ 1 ชิ้น
                </p>
                {createLastMatchedName ? (
                  <p className="mt-1 text-xs text-emerald-700">เพิ่มแล้ว: {createLastMatchedName}</p>
                ) : null}
              </div>

              <Card className="bg-gray-50">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-900">
                    รายการที่กำลังรับ ({createDraftItems.length})
                  </h4>
                </div>
                {createDraftItems.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    ยังไม่มีรายการสินค้า (ยิงบาร์โค้ดหรือพิมพ์ค้นหาเพื่อเพิ่มรายการ)
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {createDraftItems.map((item) => (
                      <div
                        key={`create_draft_${item.product_id}`}
                        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{item.product_name}</p>
                          {(item.product_code || item.barcode) && (
                            <p className="truncate text-[11px] text-gray-500">
                              {item.product_code ? `รหัส ${item.product_code}` : ''}
                              {item.barcode ? ` • บาร์โค้ด ${item.barcode}` : ''}
                            </p>
                          )}
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.received_quantity}
                          onChange={(e) =>
                            handleCreateDraftQuantityChange(item.product_id, e.target.value)
                          }
                          className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="w-10 text-center text-xs text-gray-500">
                          {item.unit_label || '-'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCreateDraftItem(item.product_id)}
                          className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          ลบ
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCreateDraftItems([]);
                    setCreateProductSearch('');
                    setCreateProductMenuOpen(false);
                    setCreateLastMatchedName('');
                  }}
                  disabled={manualSaving}
                >
                  ล้างข้อมูล
                </Button>
                <Button
                  onClick={handleSaveCreateDraftItems}
                  disabled={manualSaving || manualLoadingProducts || createDraftItems.length === 0}
                >
                  {manualSaving ? 'กำลังบันทึก...' : 'บันทึกรับสินค้า'}
                </Button>
              </div>
            </div>
          </Card>
        ) : historyLoading ? (
          <Loading />
        ) : groupedHistory.length === 0 ? (
          <div className="text-center text-gray-500 py-12">ยังไม่มีประวัติการรับสินค้า</div>
        ) : (
          <div className="space-y-4">
            {groupedHistory.map((group) => (
              <Card key={group.date}>
                <div className="mb-3">
                  <h3 className="text-base font-semibold text-gray-900">
                    {group.date === 'unknown' ? 'ไม่ระบุวันที่' : formatDisplayDate(group.date)}
                  </h3>
                  <p className="text-xs text-gray-500">{group.items.length} รายการ</p>
                </div>
                <div className="space-y-2">
                  {group.items.map((item) => {
                    const receivedQty = toNumber(item.received_quantity);
                    const unitLabel = item.unit_abbr || item.unit_name || '';
                    return (
                      <div
                        key={`history_${item.order_item_id}_${item.received_at || ''}`}
                        className="rounded-lg border border-gray-100 px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 break-words">
                              {item.product_name}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {item.supplier_name || 'ไม่ระบุกลุ่มสินค้า'}
                              {item.received_by_name ? ` • รับโดย ${item.received_by_name}` : ''}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {item.order_number ? `ออเดอร์ ${item.order_number} • ` : ''}
                              เวลา {formatDisplayTime(item.received_at)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-emerald-700">
                              {receivedQty === null ? '-' : receivedQty} {unitLabel}
                            </p>
                          </div>
                        </div>
                        {item.receive_notes ? (
                          <p className="mt-1 text-xs text-amber-700 break-words">{item.receive_notes}</p>
                        ) : null}
                        {item.purchase_reason ? (
                          <p className="mt-1 text-xs text-slate-500 break-words">
                            เหตุผลที่ซื้อขาด: {item.purchase_reason}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      <Modal
        isOpen={manualModalOpen}
        onClose={() => {
          if (manualSaving) return;
          setManualModalOpen(false);
          setManualProductMenuOpen(false);
        }}
        title="เพิ่มสินค้านอกใบสั่ง"
        size="small"
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">สินค้า</label>
            {manualLoadingProducts ? (
              <div className="text-sm text-gray-500">กำลังโหลดสินค้า...</div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={manualProductSearch}
                  onFocus={() => setManualProductMenuOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setManualProductMenuOpen(false), 120);
                  }}
                  onChange={(e) => {
                    const searchValue = e.target.value;
                    setManualProductSearch(searchValue);
                    setManualProductMenuOpen(true);
                    setManualForm((prev) => ({ ...prev, product_id: '' }));
                  }}
                  placeholder="พิมพ์ชื่อหรือรหัสสินค้า"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {manualProductMenuOpen && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                    {filteredManualProducts.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">ไม่พบสินค้า</div>
                    ) : (
                      filteredManualProducts.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          className="w-full border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-gray-50"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setManualForm((prev) => ({ ...prev, product_id: String(product.id) }));
                            setManualProductSearch(
                              product.code ? `${product.name} (${product.code})` : product.name
                            );
                            setManualProductMenuOpen(false);
                          }}
                        >
                          <div className="font-medium text-gray-900">{product.name}</div>
                          {product.code ? (
                            <div className="text-xs text-gray-500">{product.code}</div>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">จำนวนที่รับจริง</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={manualForm.received_quantity}
              onChange={(e) =>
                setManualForm((prev) => ({ ...prev, received_quantity: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">หมายเหตุ</label>
            <div className="space-y-1.5 rounded-lg border border-gray-200 p-3">
              {MANUAL_REASON_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="manualReason"
                    value={option.value}
                    checked={manualReason === option.value}
                    onChange={() => {
                      setManualReason(option.value);
                      if (option.value !== 'other') {
                        setManualOtherReason('');
                      }
                    }}
                    className="h-4 w-4 text-blue-600"
                  />
                  {option.label}
                </label>
              ))}
              {manualReason === 'other' ? (
                <input
                  type="text"
                  value={manualOtherReason}
                  onChange={(e) => setManualOtherReason(e.target.value)}
                  placeholder="ระบุหมายเหตุเพิ่มเติม"
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : null}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              onClick={() => {
                setManualModalOpen(false);
                setManualProductMenuOpen(false);
              }}
              disabled={manualSaving}
            >
              ยกเลิก
            </Button>
            <Button onClick={handleCreateManualItem} disabled={manualSaving || manualLoadingProducts}>
              {manualSaving ? 'กำลังบันทึก...' : 'เพิ่มสินค้า'}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
};
