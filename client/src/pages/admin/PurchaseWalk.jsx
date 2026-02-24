import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { adminAPI } from '../../api/admin';
import { ordersAPI } from '../../api/orders';
import { productsAPI } from '../../api/products';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';

const toLocalDateString = (date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().split('T')[0];
};

const getTomorrowString = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return toLocalDateString(tomorrow);
};

const MANUAL_PURCHASE_KEY = 'purchaseWalkManualItems';

const groupPurchaseItems = (items) => {
  const suppliersMap = new Map();
  const parseNotes = (value) =>
    String(value || '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);

  items.forEach((item) => {
    const supplierId = item.supplier_id || 'none';
    const supplierName = item.supplier_name || 'ไม่ระบุกลุ่มสินค้า';

    if (!suppliersMap.has(supplierId)) {
      suppliersMap.set(supplierId, {
        id: supplierId,
        name: supplierName,
        products: [],
        branchNames: new Set(),
        departmentNames: new Set()
      });
    }

    const supplier = suppliersMap.get(supplierId);
    if (item.branch_name) supplier.branchNames.add(item.branch_name);
    if (item.department_name) supplier.departmentNames.add(item.department_name);
    const existing = supplier.products.find(
      (product) => product.product_id === item.product_id
    );

    if (!existing) {
      const unitPrice =
        item.actual_price ??
        item.yesterday_actual_price ??
        item.last_actual_price ??
        item.last_requested_price ??
        item.requested_price ??
        null;

      supplier.products.push({
        product_id: item.product_id,
        product_name: item.product_name,
        unit_abbr: item.unit_abbr,
        total_quantity: 0,
        actual_quantity: 0,
        actual_price: null,
        unit_price: unitPrice,
        purchase_reason: item.purchase_reason || null,
        latest_price:
          item.last_actual_price ??
          item.last_requested_price ??
          item.requested_price ??
          item.yesterday_actual_price ??
          item.actual_price ??
          null,
        is_purchased: true,
        hasActualQuantity: false,
        _buyerNoteSet: new Set()
      });
    }

    const product = supplier.products.find(
      (entry) => entry.product_id === item.product_id
    );
    product.total_quantity += Number(item.quantity || 0);
    parseNotes(item.notes).forEach((note) => product._buyerNoteSet.add(note));

    if (item.actual_quantity !== null && item.actual_quantity !== undefined) {
      product.actual_quantity += Number(item.actual_quantity || 0);
      product.hasActualQuantity = true;
    }

    if (item.actual_price !== null && item.actual_price !== undefined) {
      product.unit_price = item.actual_price;
    }

    if (!item.is_purchased) {
      product.is_purchased = false;
    }

    if (!product.purchase_reason && item.purchase_reason) {
      product.purchase_reason = item.purchase_reason;
    }
  });

  const suppliers = Array.from(suppliersMap.values()).map((supplier) => ({
    ...supplier,
    branch_names: Array.from(supplier.branchNames).filter(Boolean),
    department_names: Array.from(supplier.departmentNames).filter(Boolean),
    products: supplier.products.map((product) => {
      const { _buyerNoteSet, ...restProduct } = product;
      const actualQuantity = product.hasActualQuantity
        ? product.actual_quantity
        : product.total_quantity;
      const unitPrice =
        product.unit_price === null || product.unit_price === undefined
          ? null
          : Number(product.unit_price || 0);
      const totalPrice =
        unitPrice === null ? null : Number(actualQuantity || 0) * unitPrice;

      return {
        ...restProduct,
        buyer_notes: Array.from(_buyerNoteSet || []).join(' | '),
        actual_quantity: actualQuantity,
        actual_price: totalPrice
      };
    })
  }));

  return suppliers;
};

const loadManualPurchases = () => {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(MANUAL_PURCHASE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.warn('Failed to load manual purchases', error);
    return {};
  }
};

const saveManualPurchases = (data) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MANUAL_PURCHASE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save manual purchases', error);
  }
};

const normalizeManualItem = (item) => ({
  product_id: item.product_id,
  base_product_id: item.base_product_id || item.product_id,
  product_name: item.product_name || 'สินค้าเพิ่มเติม',
  unit_abbr: item.unit_abbr || '',
  unit_name: item.unit_name || '',
  total_quantity: Number(item.total_quantity || 0),
  actual_quantity: Number(item.actual_quantity || 0),
  actual_price:
    item.actual_price === '' || item.actual_price === null
      ? null
      : Number(item.actual_price || 0),
  unit_price: null,
  purchase_reason: item.purchase_reason || null,
  latest_price: null,
  is_purchased: Boolean(item.is_purchased),
  hasActualQuantity: true,
  buyer_notes: '',
  is_manual: true
});

const mergeManualItems = (suppliers, date) => {
  if (suppliers.length === 0) return suppliers;
  const manualMap = loadManualPurchases();
  const dateMap = manualMap?.[date] || {};

  return suppliers.map((supplier) => {
    const manualItemsRaw = dateMap[String(supplier.id)] || [];
    if (manualItemsRaw.length === 0) return supplier;
    const manualItems = manualItemsRaw.map(normalizeManualItem);
    const fixed = supplier.products.filter((product) => product.is_fixed_fee);
    const rest = supplier.products.filter((product) => !product.is_fixed_fee);
    return {
      ...supplier,
      products: [...fixed, ...manualItems, ...rest]
    };
  });
};

const roundMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num);
};

const getProductTotalAmount = (product) => {
  const actualQty = Number(
    product.actual_quantity ?? product.total_quantity ?? 0
  );
  if (!Number.isFinite(actualQty) || actualQty <= 0) {
    return 0;
  }
  if (product.actual_price !== null && product.actual_price !== undefined && product.actual_price !== '') {
    return roundMoney(Number(product.actual_price || 0));
  }
  if (product.unit_price !== null && product.unit_price !== undefined && product.unit_price !== '') {
    return roundMoney(Number(product.unit_price || 0) * actualQty);
  }
  return 0;
};

const getProductUnitPrice = (product) => {
  const actualQty = Number(
    product.actual_quantity ?? product.total_quantity ?? 0
  );
  if (!Number.isFinite(actualQty) || actualQty <= 0) {
    return null;
  }
  if (product.actual_price !== null && product.actual_price !== undefined && product.actual_price !== '') {
    return Number(product.actual_price || 0) / actualQty;
  }
  if (product.unit_price !== null && product.unit_price !== undefined && product.unit_price !== '') {
    return Number(product.unit_price || 0);
  }
  return null;
};

const formatMoney = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }
  return roundMoney(Number(value || 0)).toLocaleString('th-TH');
};

const PRINT_HEIGHT_MM = 285;
const MM_TO_PX = 96 / 25.4;
const PRINT_TARGET_PX = PRINT_HEIGHT_MM * MM_TO_PX;

const formatNameList = (names) => {
  if (!Array.isArray(names) || names.length === 0) return '-';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} และอีก ${names.length - 1} รายการ`;
};

export const PurchaseWalk = () => {
  const [selectedDate, setSelectedDate] = useState(getTomorrowString());
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orderStatus, setOrderStatus] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [editingMap, setEditingMap] = useState({});
  const [editingBackup, setEditingBackup] = useState({});
  const [completing, setCompleting] = useState(false);
  const [activeTab, setActiveTab] = useState('walk');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [printSupplierId, setPrintSupplierId] = useState('');
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [printScale, setPrintScale] = useState(1);
  const [printRequested, setPrintRequested] = useState(false);
  const printRef = useRef(null);
  const [reasonModal, setReasonModal] = useState({
    open: false,
    supplierId: null,
    productId: null,
    productName: ''
  });
  const [reasonChoice, setReasonChoice] = useState('');
  const [reasonCustom, setReasonCustom] = useState('');
  const [summaryModal, setSummaryModal] = useState({
    open: false,
    supplier: null
  });
  const [manualModal, setManualModal] = useState({
    open: false,
    supplierId: null,
    productId: '',
    productName: '',
    quantity: '1',
    price: ''
  });
  const [manualProducts, setManualProducts] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSuggestionsOpen, setManualSuggestionsOpen] = useState(false);
  const [incompleteModal, setIncompleteModal] = useState({
    open: false,
    supplierName: '',
    items: []
  });
  const [searchQuery, setSearchQuery] = useState('');
  const todayString = toLocalDateString(new Date());
  const isTodaySelected = selectedDate === todayString;
  const isOrderOpen = orderStatus?.is_open === true || orderStatus?.is_open === 1;

  const shortageReasons = [
    { id: 'expensive', label: 'สินค้าแพง' },
    { id: 'out_of_stock', label: 'สินค้าขาดตลาด' },
    { id: 'buy_later', label: 'มาซื้ออีกครั้ง' },
    { id: 'customer_cancel', label: 'ผู้สั่งซื้อยกเลิก' },
    { id: 'other', label: 'อื่นๆ (พิมพ์เอง)' }
  ];

  useEffect(() => {
    fetchData();
  }, [selectedDate]);

  useEffect(() => {
    if (suppliers.length === 0) {
      setSelectedSupplierId('');
      return;
    }
    const exists = suppliers.some(
      (supplier) => String(supplier.id) === String(selectedSupplierId)
    );
    if (!exists) {
      setSelectedSupplierId(String(suppliers[0].id));
    }
  }, [suppliers, selectedSupplierId]);

  useEffect(() => {
    if (!printSupplierId) return;
    const exists = suppliers.some(
      (supplier) => String(supplier.id) === String(printSupplierId)
    );
    if (!exists) {
      setPrintSupplierId('');
    }
  }, [suppliers, printSupplierId]);

  useEffect(() => {
    const handleAfterPrint = () => {
      setIsPrintMode(false);
      setPrintRequested(false);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const statusRes = await ordersAPI.getOrderStatus(selectedDate);
      const statusData = statusRes?.data ?? statusRes;
      setOrderStatus(statusData);

      if (statusData?.is_open) {
        setSuppliers([]);
        setEditingMap({});
        setEditingBackup({});
        return;
      }

      const response = await adminAPI.getOrderItems(selectedDate);
      const items = Array.isArray(response.data) ? response.data : [];
      const grouped = groupPurchaseItems(items);
      const merged = mergeManualItems(grouped, selectedDate);
      setSuppliers(merged);
      setEditingMap({});
      setEditingBackup({});
    } catch (error) {
      console.error('Error fetching purchase data:', error);
      setSuppliers([]);
      setOrderStatus(null);
    } finally {
      setLoading(false);
    }
  };

  const persistManualItemsForSupplier = (nextSuppliers, supplierId) => {
    const manualMap = loadManualPurchases();
    const dateKey = selectedDate;
    if (!manualMap[dateKey]) manualMap[dateKey] = {};
    const supplier = nextSuppliers.find(
      (entry) => String(entry.id) === String(supplierId)
    );
    const manualItems = supplier
      ? supplier.products.filter((product) => product.is_manual).map((item) => ({
          ...normalizeManualItem(item),
          is_manual: true
        }))
      : [];
    if (manualItems.length > 0) {
      manualMap[dateKey][supplierId] = manualItems;
    } else if (manualMap[dateKey]) {
      delete manualMap[dateKey][supplierId];
    }
    saveManualPurchases(manualMap);
  };

  const updateProduct = (supplierId, productId, updates) => {
    setSuppliers((prev) => {
      const next = prev.map((supplier) => {
        if (supplier.id !== supplierId) return supplier;
        return {
          ...supplier,
          products: supplier.products.map((product) =>
            product.product_id === productId ? { ...product, ...updates } : product
          )
        };
      });
      persistManualItemsForSupplier(next, supplierId);
      return next;
    });
  };

  const openManualModal = (supplierId) => {
    setManualModal({
      open: true,
      supplierId,
      productId: '',
      productName: '',
      quantity: '1',
      price: ''
    });
    setManualProducts([]);
  };

  const closeManualModal = () => {
    setManualModal({
      open: false,
      supplierId: null,
      productId: '',
      productName: '',
      quantity: '1',
      price: ''
    });
    setManualProducts([]);
    setManualSuggestionsOpen(false);
  };

  useEffect(() => {
    const fetchManualProducts = async () => {
      if (!manualModal.open || !manualModal.supplierId) return;
      try {
        setManualLoading(true);
        const response = await productsAPI.getProducts({
          supplierId: manualModal.supplierId
        });
        const data = Array.isArray(response?.data) ? response.data : response?.data?.data;
        const products = Array.isArray(data) ? data : [];
        setManualProducts(products);
      } catch (error) {
        console.error('Error fetching products for manual add:', error);
        setManualProducts([]);
      } finally {
        setManualLoading(false);
      }
    };

    fetchManualProducts();
  }, [manualModal.open, manualModal.supplierId]);

  const handleAddManualItem = () => {
    if (!manualModal.supplierId) return;
    const selectedProduct = manualProducts.find(
      (product) => String(product.id) === String(manualModal.productId)
    );
    if (!selectedProduct) {
      alert('กรุณาเลือกสินค้าจากรายการ');
      return;
    }
    const quantity = Number(manualModal.quantity || 1);
    const price =
      manualModal.price === '' || manualModal.price === null
        ? null
        : Number(manualModal.price || 0);
    const manualItem = {
      product_id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      base_product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      unit_abbr: selectedProduct.unit_abbr || selectedProduct.unit_name || '',
      unit_name: selectedProduct.unit_name || selectedProduct.unit_abbr || '',
      total_quantity: Number.isFinite(quantity) ? quantity : 1,
      actual_quantity: Number.isFinite(quantity) ? quantity : 1,
      actual_price: Number.isFinite(price) ? price : null,
      unit_price: null,
      purchase_reason: null,
      latest_price: null,
      is_purchased: false,
      hasActualQuantity: true,
      is_manual: true
    };

    setSuppliers((prev) => {
      const next = prev.map((supplier) => {
        if (String(supplier.id) !== String(manualModal.supplierId)) return supplier;
        const fixed = supplier.products.filter((product) => product.is_fixed_fee);
        const rest = supplier.products.filter((product) => !product.is_fixed_fee);
        return {
          ...supplier,
          products: [...fixed, manualItem, ...rest]
        };
      });
      persistManualItemsForSupplier(next, manualModal.supplierId);
      return next;
    });

    closeManualModal();
  };

  const removeManualItem = (supplierId, productId) => {
    setSuppliers((prev) => {
      const next = prev.map((supplier) => {
        if (supplier.id !== supplierId) return supplier;
        return {
          ...supplier,
          products: supplier.products.filter((product) => product.product_id !== productId)
        };
      });
      persistManualItemsForSupplier(next, supplierId);
      return next;
    });
  };

  const makeEditKey = (supplierId, productId) => `${supplierId}-${productId}`;

  const startEdit = (supplierId, product) => {
    const key = makeEditKey(supplierId, product.product_id);
    setEditingMap((prev) => ({ ...prev, [key]: true }));
    setEditingBackup((prev) => ({
      ...prev,
      [key]: {
        actual_quantity: product.actual_quantity,
        actual_price: product.actual_price
      }
    }));
  };

  const ensureEditing = (supplierId, product) => {
    const key = makeEditKey(supplierId, product.product_id);
    if (!product.is_purchased) return;
    if (editingMap[key]) return;
    startEdit(supplierId, product);
  };

  const cancelEdit = (supplierId, product) => {
    const key = makeEditKey(supplierId, product.product_id);
    const backup = editingBackup[key];
    if (backup) {
      updateProduct(supplierId, product.product_id, {
        actual_quantity: backup.actual_quantity,
        actual_price: backup.actual_price
      });
    }
    setEditingMap((prev) => ({ ...prev, [key]: false }));
  };

  const handleMarkPurchased = async (supplierId, product, overrideReason) => {
    const key = makeEditKey(supplierId, product.product_id);
    const parsedActualPrice =
      product.actual_price === '' || product.actual_price === null
        ? null
        : Number(product.actual_price);
    if (parsedActualPrice === 0) {
      alert('ไม่สามารถบันทึกได้เมื่อราคาเป็น 0 บาท');
      return;
    }
    const normalizedActualPrice =
      parsedActualPrice !== null &&
      Number.isFinite(parsedActualPrice) &&
      parsedActualPrice > 0
        ? parsedActualPrice
        : null;
    const parsedActualQuantity =
      product.actual_quantity === '' || product.actual_quantity === null
        ? null
        : Number(product.actual_quantity);
    const actualQuantity =
      parsedActualQuantity !== null && Number.isFinite(parsedActualQuantity)
        ? parsedActualQuantity
        : null;
    const totalQuantity = Number(product.total_quantity || 0);
    const normalizedActualQuantity =
      actualQuantity === null || actualQuantity === undefined
        ? totalQuantity
        : Number(actualQuantity || 0);
    const priceForSave =
      normalizedActualQuantity > 0
        ? normalizedActualPrice
        : null;

    if (product.is_fixed_fee || product.is_manual) {
      setSavingId(product.product_id);
      updateProduct(supplierId, product.product_id, {
        actual_price: priceForSave,
        actual_quantity: normalizedActualQuantity,
        is_purchased: true,
        purchase_reason: null
      });
      setEditingMap((prev) => ({ ...prev, [key]: false }));
      setSavingId(null);
      return;
    }
    const isEnough = normalizedActualQuantity >= totalQuantity;
    const reasonValue =
      overrideReason !== undefined ? overrideReason : product.purchase_reason;

    if (!isEnough && (!reasonValue || String(reasonValue).trim() === '')) {
      setReasonChoice('');
      setReasonCustom('');
      setReasonModal({
        open: true,
        supplierId,
        productId: product.product_id,
        productName: product.product_name || ''
      });
      return;
    }
    const normalizedReason = isEnough ? null : reasonValue;
    const shouldMarkPurchased = isEnough || Boolean(normalizedReason);

    try {
      setSavingId(product.product_id);
      await adminAPI.recordPurchaseByProduct({
        date: selectedDate,
        product_id: product.product_id,
        actual_price: priceForSave,
        actual_quantity: actualQuantity,
        is_purchased: shouldMarkPurchased,
        purchase_reason: normalizedReason
      });
      updateProduct(supplierId, product.product_id, {
        actual_price: priceForSave,
        actual_quantity: normalizedActualQuantity,
        is_purchased: shouldMarkPurchased,
        purchase_reason: normalizedReason
      });
      setEditingMap((prev) => ({ ...prev, [key]: false }));
    } catch (error) {
      console.error('Error recording purchase:', error);
      alert('เกิดข้อผิดพลาดในการบันทึกการซื้อ');
    } finally {
      setSavingId(null);
    }
  };

  const handleResetPurchase = async (supplierId, product) => {
    const confirmed = window.confirm(
      `ยกเลิกการบันทึก "${product.product_name}" แล้วกลับไปสั่งซื้อใหม่ใช่หรือไม่?`
    );
    if (!confirmed) return;

    try {
      setSavingId(product.product_id);
      if (product.is_fixed_fee || product.is_manual) {
        updateProduct(supplierId, product.product_id, {
          actual_price: null,
          actual_quantity: product.actual_quantity ?? product.total_quantity ?? 1,
          is_purchased: false,
          purchase_reason: null
        });
        return;
      }
      await adminAPI.recordPurchaseByProduct({
        date: selectedDate,
        product_id: product.product_id,
        actual_price: null,
        actual_quantity: null,
        is_purchased: false,
        purchase_reason: null
      });
      await fetchData();
    } catch (error) {
      console.error('Error resetting purchase:', error);
      alert('เกิดข้อผิดพลาดในการยกเลิกการบันทึก');
    } finally {
      setSavingId(null);
    }
  };

  const selectedSupplier = suppliers.find(
    (supplier) => String(supplier.id) === String(selectedSupplierId)
  );
  const hasItems = suppliers.some((supplier) => supplier.products.length > 0);
  const displaySuppliers =
    isPrintMode && printSupplierId
      ? suppliers.filter((supplier) => String(supplier.id) === String(printSupplierId))
      : suppliers;
  const printSupplier = displaySuppliers.length === 1 ? displaySuppliers[0] : null;
  const printItems = printSupplier?.products ?? [];
  const printColumns = printItems.length > 70 ? 3 : 2;
  const printColumnSize = Math.ceil(printItems.length / printColumns);
  const printColumnsData = Array.from({ length: printColumns }, (_, index) =>
    printItems.slice(index * printColumnSize, (index + 1) * printColumnSize)
  );
  const printTotal = roundMoney(
    printItems.reduce(
      (sum, product) => sum + getProductTotalAmount(product),
      0
    )
  );
  const printBranchLabel = formatNameList(printSupplier?.branch_names);
  const printDepartmentLabel = formatNameList(printSupplier?.department_names);
  const printDocNo = printSupplier
    ? `PW-${selectedDate.replaceAll('-', '')}-${printSupplier.id}`
    : '-';
  useLayoutEffect(() => {
    if (!isPrintMode || !printSupplier) {
      setPrintScale(1);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const content = printRef.current;
      if (!content) return;
      const height = content.scrollHeight || 0;
      if (!height) return;
      const autoScale = Math.min(1, Math.max(0.12, PRINT_TARGET_PX / height)) * 0.98;
      setPrintScale(Number(autoScale.toFixed(2)));
    });
    return () => cancelAnimationFrame(raf);
  }, [isPrintMode, printSupplier, printItems.length, printColumns, printColumnSize]);

  useEffect(() => {
    if (!printRequested || !isPrintMode || !printSupplier) return;
    const timer = setTimeout(() => {
      window.print();
      setPrintRequested(false);
    }, 80);
    return () => clearTimeout(timer);
  }, [printRequested, isPrintMode, printScale, printSupplier]);

  const handleCompletePurchases = async () => {
    if (!selectedSupplier) return;
    const missing = selectedSupplier.products.filter((product) => !product.is_purchased);
    if (missing.length > 0) {
      setIncompleteModal({
        open: true,
        supplierName: selectedSupplier.name || '',
        items: missing
      });
      return;
    }
    const confirmed = window.confirm(
      `ยืนยันซื้อของเสร็จสำหรับกลุ่มสินค้า \"${selectedSupplier.name}\"?\nระบบจะอัปเดตคำสั่งซื้อที่ซื้อครบเป็นสถานะซื้อเรียบร้อย`
    );
    if (!confirmed) return;

    try {
      setCompleting(true);
      const response = await adminAPI.completePurchasesByProductGroup(
        selectedDate,
        selectedSupplier.id
      );
      const updated = response?.data?.updated ?? response?.data?.data?.updated ?? response?.updated ?? 0;
      alert(`อัปเดตคำสั่งซื้อสำเร็จ ${updated} รายการ`);
      await fetchData();
      setActiveTab('mine');
    } catch (error) {
      console.error('Error completing purchases:', error);
      alert(error.response?.data?.message || 'เกิดข้อผิดพลาดในการอัปเดตสถานะคำสั่งซื้อ');
    } finally {
      setCompleting(false);
    }
  };

  const openSummaryModal = (supplier) => {
    setSummaryModal({ open: true, supplier });
  };

  const openReasonModal = (supplierId, product) => {
    const matched = shortageReasons.find(
      (reason) => reason.label === product.purchase_reason
    );
    if (matched) {
      setReasonChoice(matched.id);
      setReasonCustom('');
    } else if (product.purchase_reason) {
      setReasonChoice('other');
      setReasonCustom(product.purchase_reason);
    } else {
      setReasonChoice('');
      setReasonCustom('');
    }
    setReasonModal({
      open: true,
      supplierId,
      productId: product.product_id,
      productName: product.product_name || ''
    });
  };

  const handleConfirmReason = async () => {
    const selected = shortageReasons.find((reason) => reason.id === reasonChoice);
    const reasonText =
      reasonChoice === 'other'
        ? reasonCustom.trim()
        : selected?.label || '';

    if (!reasonText) {
      alert('โปรดระบุเหตุผล');
      return;
    }

    const supplier = suppliers.find(
      (entry) => String(entry.id) === String(reasonModal.supplierId)
    );
    const product = supplier?.products.find(
      (entry) => entry.product_id === reasonModal.productId
    );

    if (!product) {
      setReasonModal({ open: false, supplierId: null, productId: null, productName: '' });
      return;
    }

    setReasonModal({ open: false, supplierId: null, productId: null, productName: '' });
    await handleMarkPurchased(supplier.id, product, reasonText);
  };

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <style>{`
          @media print {
            @page {
              size: A4 portrait;
              margin: 6mm;
            }
            html, body {
              width: 210mm;
              height: 297mm;
            }
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .print-area {
              width: 198mm;
              height: 285mm;
              overflow: visible;
            }
            .print-scale {
              transform: scale(var(--print-scale, 1));
              transform-origin: top left;
              width: calc(100% / var(--print-scale, 1));
              height: auto;
              overflow: visible;
            }
            .print-document {
              font-size: 10.5px;
              line-height: 1.2;
              color: #111;
              display: flex;
              flex-direction: column;
              min-height: 100%;
            }
            .print-document table {
              width: 100%;
              border-collapse: collapse;
              break-inside: avoid;
            }
            .print-document th,
            .print-document td {
              border: 1px solid #111;
              padding: 3px 4px;
              vertical-align: top;
            }
            .print-columns {
              display: grid;
              grid-template-columns: repeat(var(--print-columns, 2), minmax(0, 1fr));
              gap: 6px;
            }
            .print-signatures {
              margin-top: auto;
              page-break-inside: avoid;
            }
            .print-muted {
              color: #555;
            }
            .print-item-main,
            .print-item-sub {
              display: block;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              max-width: 100%;
            }
            .print-item-sub {
              font-size: 9.5px;
              color: #555;
            }
          }
          @media screen {
            .print-preview-area {
              position: absolute;
              left: -10000px;
              top: 0;
              width: 198mm;
              height: 285mm;
              overflow: visible;
            }
            .print-preview-area .print-scale {
              transform: scale(var(--print-scale, 1));
              transform-origin: top left;
              width: calc(100% / var(--print-scale, 1));
              height: auto;
              overflow: visible;
            }
            .print-preview-area .print-document {
              font-size: 10.5px;
              line-height: 1.2;
              color: #111;
              display: flex;
              flex-direction: column;
              min-height: 100%;
            }
            .print-preview-area table {
              width: 100%;
              border-collapse: collapse;
              break-inside: avoid;
            }
            .print-preview-area th,
            .print-preview-area td {
              border: 1px solid #111;
              padding: 3px 4px;
              vertical-align: top;
            }
            .print-preview-area .print-columns {
              display: grid;
              grid-template-columns: repeat(var(--print-columns, 2), minmax(0, 1fr));
              gap: 6px;
            }
            .print-preview-area .print-signatures {
              margin-top: auto;
              page-break-inside: avoid;
            }
            .print-preview-area .print-muted {
              color: #555;
            }
            .print-preview-area .print-item-main,
            .print-preview-area .print-item-sub {
              display: block;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              max-width: 100%;
            }
            .print-preview-area .print-item-sub {
              font-size: 9.5px;
              color: #555;
            }
          }
        `}</style>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">เดินซื้อของตามกลุ่มสินค้า</h1>
            <p className="text-sm text-gray-500">รวมสินค้าเพื่อซื้อให้ครบในวันเดียว</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">วันที่</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
              />
            </div>
            {isTodaySelected && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ⚠️ คุณกำลังสั่งของเมื่อวาน (ปกติสั่งวันนี้ซื้อพรุ่งนี้)
              </div>
            )}
            {activeTab === 'walk' && suppliers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suppliers.map((supplier) => (
                  <button
                    key={supplier.id}
                    onClick={() => setSelectedSupplierId(String(supplier.id))}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border transition shadow-sm ${
                      String(selectedSupplierId) === String(supplier.id)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {supplier.name}
                  </button>
                ))}
              </div>
            )}
            <Button
              onClick={handleCompletePurchases}
              disabled={!hasItems || completing}
              variant="success"
            >
              {completing ? 'กำลังอัปเดต...' : 'ยืนยันซื้อของเสร็จแล้ว'}
            </Button>
            {activeTab === 'mine' && (
              <div className="flex items-center gap-2">
                <select
                  value={printSupplierId}
                  onChange={(e) => setPrintSupplierId(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                >
                  <option value="">เลือกกลุ่มสินค้า</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={() => {
                    if (!printSupplierId) {
                      alert('กรุณาเลือกกลุ่มสินค้าก่อนพิมพ์');
                      return;
                    }
                    setIsPrintMode(true);
                    setPrintRequested(true);
                  }}
                  variant="secondary"
                  disabled={!printSupplierId}
                >
                  พิมพ์สำหรับบัญชี
                </Button>
              </div>
            )}
          </div>
        </div>

        {isOrderOpen && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            ยังไม่สามารถเดินซื้อของได้จนกว่าจะ “ปิดรับออเดอร์” ของวันที่เลือก
          </div>
        )}

        {isOrderOpen ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
            กรุณาปิดรับออเดอร์ก่อนเพื่อเริ่มเดินซื้อของ
          </div>
        ) : suppliers.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
            ไม่มีรายการที่ต้องซื้อ
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4 print:hidden">
              <button
                onClick={() => setActiveTab('walk')}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                  activeTab === 'walk'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                เดินซื้อของ
              </button>
              <button
                onClick={() => setActiveTab('mine')}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                  activeTab === 'mine'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                การซื้อของฉัน
              </button>
            </div>

            {activeTab === 'walk' ? (
              <div className="space-y-6">
                {!selectedSupplier ? (
                  <div className="text-center py-10 text-gray-500 bg-white rounded-lg shadow-sm">
                    กรุณาเลือกกลุ่มสินค้าก่อน
                  </div>
                ) : (
                  (() => {
                    const supplier = selectedSupplier;
                    const pending = supplier.products.filter((p) => !p.is_purchased);
                    const done = supplier.products.filter((p) => p.is_purchased);

                    return (
                      <Card key={supplier.id}>
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <h2 className="text-xl font-bold text-gray-900">{supplier.name}</h2>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openSummaryModal(supplier)}
                              className="px-3 py-1.5 text-xs font-semibold border rounded-lg text-gray-700 hover:bg-gray-50"
                            >
                              ดูออเดอร์ทั้งหมด
                            </button>
                            <button
                              type="button"
                              onClick={() => openManualModal(supplier.id)}
                              className="px-3 py-1.5 text-xs font-semibold border border-blue-200 rounded-lg text-blue-700 hover:bg-blue-50"
                            >
                              + เพิ่มสินค้า
                            </button>
                          </div>
                        </div>

                        {pending.length === 0 && done.length > 0 && (
                          <div className="text-sm text-green-600 mb-4">ซื้อครบแล้ว</div>
                        )}

                        <div className="mb-4">
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="ค้นหาสินค้า..."
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div className="space-y-4">
                          {[...pending, ...done]
                            .filter((product) => {
                              if (!searchQuery) return true;
                              return String(product.product_name || '')
                                .toLowerCase()
                                .includes(searchQuery.toLowerCase());
                            })
                            .map((product) => {
                            const editKey = makeEditKey(supplier.id, product.product_id);
                            const isEditing = Boolean(editingMap[editKey]);
                            const orderedQty = Number(product.total_quantity || 0);
                            const actualQty = Number(product.actual_quantity || 0);
                            const diff = Number((actualQty - orderedQty).toFixed(2));
                            const diffAbs = Math.abs(diff);
                            const unitLabel = product.unit_abbr || '';
                            const quantityText =
                              product.actual_quantity === null || product.actual_quantity === undefined
                                ? ''
                                : String(product.actual_quantity);
                            const baseQuantityWidth = Math.max(
                              4,
                              Math.ceil((quantityText.length + 1) * 1.33)
                            );
                            const quantityWidth = Math.ceil(baseQuantityWidth * 4 / 3);
                            const statusText =
                              diff === 0 ? '0' : diff > 0 ? `+${diffAbs}` : `-${diffAbs}`;
                            const statusColor =
                              diff === 0
                                ? 'text-emerald-600'
                                : diff > 0
                                  ? 'text-amber-600'
                                  : 'text-red-600';
                            const hasPriceInput =
                              product.actual_price !== '' &&
                              product.actual_price !== null &&
                              product.actual_price !== undefined;
                            const parsedRowPrice = hasPriceInput
                              ? Number(product.actual_price)
                              : null;
                            const isZeroPriceInput =
                              parsedRowPrice !== null &&
                              Number.isFinite(parsedRowPrice) &&
                              parsedRowPrice === 0;
                            const isDone = product.is_purchased;
                            const canSave = !isDone || isEditing;

                            return (
                              <div
                                key={product.product_id}
                                className={`border-b py-2 last:border-b-0 ${
                                  isDone ? 'opacity-60' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-gray-900 whitespace-normal break-words">
                                      {product.product_name}
                                      {product.is_manual && (
                                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                          เพิ่ม
                                        </span>
                                      )}
                                      {unitLabel && (
                                        <span className="ml-2 text-[10px] text-gray-400">
                                          {unitLabel}
                                        </span>
                                      )}
                                    </p>
                                    {product.buyer_notes ? (
                                      <p className="text-xs text-gray-500 mt-0.5 whitespace-normal break-words">
                                        {product.buyer_notes}
                                      </p>
                                    ) : null}
                                    {diff < 0 && (
                                      <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-2">
                                        <span>เหตุผล: {product.purchase_reason || '-'}</span>
                                        <button
                                          type="button"
                                          onClick={() => openReasonModal(supplier.id, product)}
                                          className="text-xs text-blue-600 hover:text-blue-700"
                                        >
                                          แก้ไขเหตุผล
                                        </button>
                                      </p>
                                    )}
                                  </div>
                                  <span
                                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor} bg-gray-50`}
                                  >
                                    {statusText}
                                  </span>
                                  <div
                                    className="flex-shrink-0"
                                    style={{ width: `${quantityWidth}ch` }}
                                  >
                                    <Input
                                      type="number"
                                      value={product.actual_quantity}
                                      onChange={(e) => {
                                        ensureEditing(supplier.id, product);
                                        updateProduct(supplier.id, product.product_id, {
                                          actual_quantity: e.target.value
                                        });
                                      }}
                                      onFocus={(e) => {
                                        ensureEditing(supplier.id, product);
                                        e.target.select();
                                      }}
                                      min="0"
                                      step="0.1"
                                      placeholder="จำนวน"
                                      style={{ textAlign: 'right' }}
                                      disabled={isDone && !isEditing}
                                    />
                                  </div>
                                  <div className="w-16">
                                    <Input
                                      type="number"
                                      value={product.actual_price ?? ''}
                                      onChange={(e) => {
                                        ensureEditing(supplier.id, product);
                                        updateProduct(supplier.id, product.product_id, {
                                          actual_price: e.target.value
                                        });
                                      }}
                                      onFocus={(e) => {
                                        ensureEditing(supplier.id, product);
                                        e.target.select();
                                      }}
                                      min="0"
                                      step="0.01"
                                      placeholder="ราคา"
                                      style={{
                                        textAlign: 'right',
                                        fontSize: '0.875rem',
                                        paddingLeft: '0.5rem',
                                        paddingRight: '0.5rem'
                                      }}
                                      disabled={isDone && !isEditing}
                                    />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {isEditing && (
                                      <Button
                                        onClick={() => cancelEdit(supplier.id, product)}
                                        variant="secondary"
                                        size="sm"
                                        disabled={savingId === product.product_id}
                                      >
                                        ยกเลิก
                                      </Button>
                                    )}
                                    {!isEditing && isDone && (
                                      <>
                                        <Button
                                          onClick={() => handleResetPurchase(supplier.id, product)}
                                          variant="secondary"
                                          size="sm"
                                          disabled={savingId === product.product_id}
                                        >
                                          ยกเลิก
                                        </Button>
                                        <Button
                                          onClick={() => startEdit(supplier.id, product)}
                                          variant="secondary"
                                          size="sm"
                                          disabled={savingId === product.product_id}
                                          aria-label="แก้ไข"
                                        >
                                          <svg
                                            className="w-4 h-4"
                                            viewBox="0 0 20 20"
                                            fill="none"
                                            stroke="currentColor"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth="1.5"
                                              d="M4 13.5V16h2.5l7.1-7.1-2.5-2.5L4 13.5zM12.6 5.4l2 2"
                                            />
                                          </svg>
                                        </Button>
                                      </>
                                    )}
                                    {canSave && (
                                      <Button
                                        onClick={() => handleMarkPurchased(supplier.id, product)}
                                        variant="success"
                                        size="sm"
                                        disabled={savingId === product.product_id || isZeroPriceInput}
                                        aria-label="บันทึก"
                                      >
                                        ✓
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                {isZeroPriceInput ? (
                                  <p className="text-xs text-red-500 mt-1">ราคา 0 บาท บันทึกไม่ได้</p>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    );
                  })()
                )}
              </div>
            ) : (
              <div
                className={`space-y-6 print:space-y-2 print-area ${
                  isPrintMode ? 'print-preview-area' : ''
                }`}
                style={
                  isPrintMode
                    ? { '--print-scale': printScale, '--print-columns': printColumns }
                    : undefined
                }
              >
                <div className={isPrintMode ? 'block print:block' : 'hidden print:block'}>
                  <div ref={printRef} className="print-document print-scale">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-base font-bold">ใบรับสินค้า / บันทึกการซื้อ</div>
                        <div className="text-xs print-muted">
                          เอกสารภายในสำหรับฝ่ายบัญชี
                        </div>
                      </div>
                      <div className="text-xs text-right">
                        <div>เลขที่เอกสาร: {printDocNo}</div>
                        <div>วันที่: {selectedDate}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mt-2 print:mt-1">
                      <div>กลุ่มสินค้า: {printSupplier?.name || '-'}</div>
                      <div>สาขา: {printBranchLabel}</div>
                      <div>แผนก: {printDepartmentLabel}</div>
                      <div>อ้างอิงใบสั่งซื้อ/ใบส่งของ: ____________________</div>
                    </div>
                    <div className="mt-2 print:mt-1">
                      <div className="print-columns">
                        {printColumnsData.map((columnItems, columnIndex) => (
                          <table key={`print-col-${columnIndex}`} className="text-xs">
                            <thead>
                              <tr>
                                <th style={{ width: '56%' }}>รายการสินค้า</th>
                                <th style={{ width: '14%', textAlign: 'right' }}>
                                  หน่วยละ
                                </th>
                                <th style={{ width: '16%', textAlign: 'right' }}>
                                  จำนวนรับจริง
                                </th>
                                <th style={{ width: '14%', textAlign: 'right' }}>
                                  ราคารวม
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {printItems.length === 0 && columnIndex === 0 && (
                                <tr>
                                  <td colSpan={4} className="text-center print-muted">
                                    ไม่มีรายการ
                                  </td>
                                </tr>
                              )}
                              {columnItems.map((product, index) => {
                                const actualQty = Number(product.actual_quantity || 0);
                                const unitLabel = product.unit_abbr || '';
                                const totalAmount = getProductTotalAmount(product);
                                const unitPrice = getProductUnitPrice(product);
                                const rowNo =
                                  columnIndex * printColumnSize + index + 1;
                                return (
                                  <tr key={product.product_id}>
                                    <td>
                                      <div className="print-item-main">{rowNo}. {product.product_name}</div>
                                      {product.buyer_notes ? <div className="print-item-sub">{product.buyer_notes}</div> : null}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                      {unitPrice !== null ? `฿${formatMoney(unitPrice)}` : '-'}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                      {actualQty} {unitLabel}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                      ฿{formatMoney(totalAmount)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        ))}
                      </div>
                      {printItems.length > 0 && (
                        <table className="text-xs mt-1">
                          <tbody>
                            <tr>
                              <td
                                className="text-right font-semibold"
                                style={{ width: '82%' }}
                              >
                                รวมทั้งสิ้น
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                ฿{formatMoney(printTotal)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                    <div className="mt-1 text-xs">
                      จำนวนรายการ: {printItems.length} รายการ
                    </div>
                    <div className="mt-1 text-xs">
                      หมายเหตุ: _______________________________________________________
                    </div>
                    <div className="print-signatures grid grid-cols-4 gap-3 mt-3 print:mt-2 text-center text-[10px]">
                      {[
                        'ผู้ส่งสินค้า/ผู้ขาย',
                        'ผู้รับสินค้า',
                        'ผู้ตรวจสอบ',
                        'ผู้อนุมัติ'
                      ].map((label) => (
                        <div key={label}>
                          <div className="border-b border-gray-800 h-4 mb-1" />
                          <div>{label}</div>
                          <div className="print-muted">วันที่ ____/____/______</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="print:hidden">
                  <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    <span>ยอดรวมการซื้อของฉัน</span>
                    <span className="text-lg font-semibold">
                      ฿
                      {formatMoney(
                        displaySuppliers.reduce(
                          (sum, supplier) =>
                            sum +
                            supplier.products.reduce(
                              (subSum, product) => subSum + getProductTotalAmount(product),
                              0
                            ),
                          0
                        )
                      )}
                    </span>
                  </div>
                  {displaySuppliers.map((supplier) => (
                    <Card key={supplier.id}>
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <h2 className="text-xl font-bold text-gray-900">{supplier.name}</h2>
                          <p className="text-xs text-gray-500">
                            รวม ฿
                            {formatMoney(
                              supplier.products.reduce(
                                (sum, product) => sum + getProductTotalAmount(product),
                                0
                              )
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openSummaryModal(supplier)}
                          className="px-3 py-1.5 text-xs font-semibold border rounded-lg text-gray-700 hover:bg-gray-50 print:hidden"
                        >
                          ดูออเดอร์ทั้งหมด
                        </button>
                      </div>
                      <div className="space-y-3">
                        <div className="grid grid-cols-[1fr_110px_120px] text-xs font-semibold text-gray-500 border-b pb-2">
                          <span>รายการสินค้า</span>
                          <span className="text-right">จำนวนรับจริง</span>
                          <span className="text-right">ราคารวม</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 print:grid-cols-2">
                          {supplier.products.map((product) => {
                            const actualQty = Number(product.actual_quantity || 0);
                            const unitLabel = product.unit_abbr || '';
                            const totalAmount = getProductTotalAmount(product);
                            const unitPrice = getProductUnitPrice(product);

                            return (
                              <div
                                key={product.product_id}
                                className="rounded-lg border border-gray-100 px-3 py-2"
                              >
                                <div className="grid grid-cols-[1fr_110px_120px] items-center text-sm gap-2">
                                  <span className="font-semibold text-gray-900 whitespace-normal break-words">
                                    <span className="block">{product.product_name}</span>
                                    {product.buyer_notes ? (
                                      <span className="block text-xs font-normal text-gray-500">
                                        {product.buyer_notes}
                                      </span>
                                    ) : null}
                                    <span className="block text-xs font-normal text-gray-500">
                                      หน่วยละ {unitPrice !== null ? `฿${formatMoney(unitPrice)}` : '-'}
                                    </span>
                                  </span>
                                  <span className="text-right text-gray-700">
                                    {actualQty} {unitLabel}
                                  </span>
                                  <span className="text-right text-gray-700">
                                    ฿{formatMoney(totalAmount)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="grid grid-cols-[1fr_110px_120px] text-sm font-semibold border-t pt-2">
                          <span>รวม</span>
                          <span />
                          <span className="text-right">
                            ฿
                            {formatMoney(
                              supplier.products.reduce(
                                (sum, product) => sum + getProductTotalAmount(product),
                                0
                              )
                            )}
                          </span>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={reasonModal.open}
        onClose={() =>
          setReasonModal({ open: false, supplierId: null, productId: null, productName: '' })
        }
        title="โปรดระบุเหตุผลที่ได้ของไม่ครบ"
        size="medium"
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            รายการ: {reasonModal.productName || '-'}
          </div>
          <div className="space-y-2">
            {shortageReasons.map((reason) => (
              <label
                key={reason.id}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="radio"
                  name="shortage-reason"
                  value={reason.id}
                  checked={reasonChoice === reason.id}
                  onChange={(e) => setReasonChoice(e.target.value)}
                />
                <span>{reason.label}</span>
              </label>
            ))}
          </div>
          {reasonChoice === 'other' && (
            <div>
              <Input
                label="ระบุเหตุผลเพิ่มเติม"
                value={reasonCustom}
                onChange={(e) => setReasonCustom(e.target.value)}
                placeholder="พิมพ์เหตุผลเอง"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setReasonModal({
                  open: false,
                  supplierId: null,
                  productId: null,
                  productName: ''
                })
              }
            >
              ยกเลิก
            </Button>
            <Button variant="success" onClick={handleConfirmReason}>
              บันทึกเหตุผล
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={manualModal.open}
        onClose={closeManualModal}
        title="เพิ่มสินค้าเพิ่มเติม"
        size="medium"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              พิมพ์ชื่อสินค้า (เฉพาะกลุ่มนี้)
            </label>
            <div className="relative">
              <input
                value={manualModal.productName}
                onChange={(e) => {
                  const value = e.target.value;
                  const matched = manualProducts.find(
                    (product) =>
                      String(product.name || '').toLowerCase() === value.toLowerCase()
                  );
                  setManualModal((prev) => ({
                    ...prev,
                    productName: value,
                    productId: matched ? String(matched.id) : ''
                  }));
                  setManualSuggestionsOpen(true);
                }}
                onFocus={() => setManualSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setManualSuggestionsOpen(false), 120)}
                placeholder={manualLoading ? 'กำลังโหลดสินค้า...' : 'พิมพ์เพื่อค้นหา'}
                className="w-full px-3 py-2 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={manualLoading}
              />
              {manualSuggestionsOpen && !manualLoading && manualProducts.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {manualProducts
                    .filter((product) => {
                      if (!manualModal.productName) return true;
                      return String(product.name || '')
                        .toLowerCase()
                        .includes(String(manualModal.productName || '').toLowerCase());
                    })
                    .slice(0, 12)
                    .map((product) => (
                      <button
                        type="button"
                        key={product.id}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setManualModal((prev) => ({
                            ...prev,
                            productName: product.name,
                            productId: String(product.id)
                          }));
                          setManualSuggestionsOpen(false);
                        }}
                      >
                        <span className="font-medium">{product.name}</span>
                        {product.unit_abbr && (
                          <span className="ml-2 text-xs text-gray-500">
                            ({product.unit_abbr})
                          </span>
                        )}
                      </button>
                    ))}
                  {manualProducts.filter((product) => {
                    if (!manualModal.productName) return true;
                    return String(product.name || '')
                      .toLowerCase()
                      .includes(String(manualModal.productName || '').toLowerCase());
                  }).length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-500">
                      ไม่พบสินค้าที่ตรงกับคำค้น
                    </div>
                  )}
                </div>
              )}
            </div>
            {!manualLoading && manualProducts.length === 0 && (
              <p className="text-xs text-gray-500 mt-1">ไม่พบสินค้าในกลุ่มนี้</p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="จำนวน"
              type="number"
              min="0"
              step="0.1"
              value={manualModal.quantity}
              onChange={(e) =>
                setManualModal((prev) => ({ ...prev, quantity: e.target.value }))
              }
            />
            <div className="w-full">
              <label className="block text-sm font-medium text-gray-700 mb-1">หน่วย</label>
              <div className="px-3 py-2 border rounded-lg text-base bg-gray-50 text-gray-700">
                {(() => {
                  const selected = manualProducts.find(
                    (product) => String(product.id) === String(manualModal.productId)
                  );
                  if (!selected) return '-';
                  return selected.unit_abbr || selected.unit_name || '-';
                })()}
              </div>
            </div>
            <Input
              label="ราคารวม"
              type="number"
              min="0"
              step="0.01"
              value={manualModal.price}
              onChange={(e) =>
                setManualModal((prev) => ({ ...prev, price: e.target.value }))
              }
              placeholder="ถ้าไม่กรอกจะเป็นค่าว่าง"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={closeManualModal}
            >
              ยกเลิก
            </Button>
            <Button onClick={handleAddManualItem}>เพิ่มสินค้า</Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={summaryModal.open}
        onClose={() => setSummaryModal({ open: false, supplier: null })}
        title={
          summaryModal.supplier
            ? `ออเดอร์ทั้งหมด: ${summaryModal.supplier.name}`
            : 'ออเดอร์ทั้งหมด'
        }
        size="medium"
      >
        {summaryModal.supplier ? (
          <div className="space-y-1 text-sm leading-tight max-h-[60vh] overflow-y-auto pr-1">
            {summaryModal.supplier.products.map((product) => (
              <div
                key={product.product_id}
                className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-gray-100 py-1 last:border-b-0"
              >
                <span className="text-gray-800 min-w-0">
                  <span className="block truncate">{product.product_name}</span>
                  {product.buyer_notes ? (
                    <span className="block text-[11px] text-gray-500">
                      {product.buyer_notes}
                    </span>
                  ) : null}
                </span>
                <span className="font-semibold text-gray-700">
                  {Number(product.total_quantity || 0).toFixed(2)}{' '}
                  {product.unit_abbr || ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">ไม่มีข้อมูล</div>
        )}
      </Modal>

      <Modal
        isOpen={incompleteModal.open}
        onClose={() =>
          setIncompleteModal({ open: false, supplierName: '', items: [] })
        }
        title="ยังไม่ได้บันทึกสินค้าบางรายการ"
        size="medium"
      >
        <div className="space-y-3 text-sm">
          <div className="text-gray-600">
            กลุ่มสินค้า: {incompleteModal.supplierName || '-'}
          </div>
          <div className="text-gray-700">
            โปรดบันทึกรายการต่อไปนี้ก่อนยืนยันซื้อของเสร็จ:
          </div>
          <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
            {incompleteModal.items.map((product) => (
              <div
                key={product.product_id}
                className="grid grid-cols-[1fr_auto] items-center gap-2"
              >
                <span className="truncate">{product.product_name}</span>
                <span className="font-semibold text-gray-700">
                  {Number(product.total_quantity || 0).toFixed(2)}{' '}
                  {product.unit_abbr || ''}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() =>
                setIncompleteModal({ open: false, supplierName: '', items: [] })
              }
            >
              ปิด
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
};
