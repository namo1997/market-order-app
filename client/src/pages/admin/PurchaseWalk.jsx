import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { adminAPI } from '../../api/admin';
import { ordersAPI } from '../../api/orders';
import { productsAPI } from '../../api/products';
import { masterAPI } from '../../api/master';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';
import { downloadCsv } from '../../utils/csv';

const SHOW_MY_PURCHASE_TAB = true;
const SHOW_PURCHASE_VALUE_REPORT_TAB = false;

const toLocalDateString = (date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().split('T')[0];
};

const getTomorrowString = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return toLocalDateString(tomorrow);
};

const normalizeReconcileKeyPart = (value) => {
  if (value === null || value === undefined || value === '') return 'none';
  return String(value);
};

const makeReconcileRowKey = (productGroupId, productId) =>
  `${normalizeReconcileKeyPart(productGroupId)}:${normalizeReconcileKeyPart(productId)}`;

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
      const rowRequestedQty = Number(item.quantity || 0);
      const canPrefillPrice = rowRequestedQty > 0;
      const isStoreGroup = Boolean(Number(item.is_store_group || 0));
      const guideDefaultPrice =
        item.default_price === null || item.default_price === undefined
          ? null
          : Number(item.default_price);
      const storeSuggestedUnitPrice =
        item.last_po_unit_price ??
        item.actual_price ??
        item.yesterday_actual_price ??
        item.last_actual_price ??
        item.last_requested_price ??
        item.requested_price ??
        guideDefaultPrice ??
        null;
      const nonStoreSuggestedUnitPrice =
        item.actual_price ??
        item.yesterday_actual_price ??
        item.last_actual_price ??
        item.last_requested_price ??
        item.requested_price ??
        guideDefaultPrice ??
        null;
      const unitPrice = canPrefillPrice
        ? isStoreGroup
          ? storeSuggestedUnitPrice
          : nonStoreSuggestedUnitPrice
        : null;

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
        supplier_master_id: item.supplier_master_id || null,
        supplier_master_name: item.supplier_master_name || '',
        supplier_has_bank_account:
          item.supplier_has_bank_account === undefined || item.supplier_has_bank_account === null
            ? null
            : Boolean(Number(item.supplier_has_bank_account)),
        supplier_bank_name: item.supplier_bank_name || '',
        supplier_account_number: item.supplier_account_number || '',
        supplier_account_name: item.supplier_account_name || '',
        is_store_group: isStoreGroup,
        last_po_unit_price:
          item.last_po_unit_price === null || item.last_po_unit_price === undefined
            ? null
            : Number(item.last_po_unit_price),
        last_po_received_at: item.last_po_received_at || null,
        is_purchased: true,
        hasActualQuantity: false,
        purchased_quantity_total: 0,
        received_quantity_total: 0,
        _buyerNoteSet: new Set(),
        _orderItemIdSet: new Set()
      });
    }

    const product = supplier.products.find(
      (entry) => entry.product_id === item.product_id
    );
    const requestedQty = Number(item.quantity || 0);
    const fallbackQty =
      requestedQty > 0
        ? requestedQty
        : Number(item.received_quantity || item.actual_quantity || 0);
    product.total_quantity += fallbackQty;
    parseNotes(item.notes).forEach((note) => product._buyerNoteSet.add(note));
    if (item.order_item_id) {
      product._orderItemIdSet.add(Number(item.order_item_id));
    }
    const isLinePurchased = Boolean(Number(item.is_purchased));
    const linePurchasedQtyRaw =
      item.actual_quantity !== null && item.actual_quantity !== undefined
        ? Number(item.actual_quantity)
        : Number(item.quantity || 0);
    const linePurchasedQty = Number.isFinite(linePurchasedQtyRaw) ? linePurchasedQtyRaw : 0;
    if (isLinePurchased) {
      product.purchased_quantity_total += linePurchasedQty;
    }
    const lineReceivedQtyRaw =
      item.received_quantity === null ||
      item.received_quantity === undefined ||
      item.received_quantity === ''
        ? 0
        : Number(item.received_quantity);
    product.received_quantity_total += Number.isFinite(lineReceivedQtyRaw)
      ? lineReceivedQtyRaw
      : 0;

    if (item.actual_quantity !== null && item.actual_quantity !== undefined) {
      product.actual_quantity += Number(item.actual_quantity || 0);
      product.hasActualQuantity = true;
    }

    if (item.actual_price !== null && item.actual_price !== undefined) {
      product.unit_price = item.actual_price;
    } else if (
      (product.unit_price === null || product.unit_price === undefined) &&
      Number(item.quantity || 0) > 0
    ) {
      const isStoreGroup = Boolean(Number(item.is_store_group || 0));
      const guideDefaultPrice =
        item.default_price === null || item.default_price === undefined
          ? null
          : Number(item.default_price);
      const fallbackUnitPrice = isStoreGroup
        ? item.last_po_unit_price ??
          item.yesterday_actual_price ??
          item.last_actual_price ??
          item.last_requested_price ??
          item.requested_price ??
          guideDefaultPrice ??
          null
        : item.yesterday_actual_price ??
          item.last_actual_price ??
          item.last_requested_price ??
          item.requested_price ??
          guideDefaultPrice ??
          null;
      if (fallbackUnitPrice !== null && fallbackUnitPrice !== undefined) {
        product.unit_price = fallbackUnitPrice;
      }
    }

    if (!item.is_purchased) {
      product.is_purchased = false;
    }

    if (!product.purchase_reason && item.purchase_reason) {
      product.purchase_reason = item.purchase_reason;
    }

    if (!product.supplier_master_id && item.supplier_master_id) {
      product.supplier_master_id = item.supplier_master_id;
    }
    if (!product.supplier_master_name && item.supplier_master_name) {
      product.supplier_master_name = item.supplier_master_name;
    }
    if (product.supplier_has_bank_account === null && item.supplier_has_bank_account !== undefined) {
      product.supplier_has_bank_account = Boolean(Number(item.supplier_has_bank_account));
    }
    if (!product.supplier_bank_name && item.supplier_bank_name) {
      product.supplier_bank_name = item.supplier_bank_name;
    }
    if (!product.supplier_account_number && item.supplier_account_number) {
      product.supplier_account_number = item.supplier_account_number;
    }
    if (!product.supplier_account_name && item.supplier_account_name) {
      product.supplier_account_name = item.supplier_account_name;
    }
  });

  const suppliers = Array.from(suppliersMap.values()).map((supplier) => ({
    ...supplier,
    branch_names: Array.from(supplier.branchNames).filter(Boolean),
    department_names: Array.from(supplier.departmentNames).filter(Boolean),
    products: supplier.products.map((product) => {
      const { _buyerNoteSet, _orderItemIdSet, ...restProduct } = product;
      const actualQuantity = product.hasActualQuantity
        ? product.actual_quantity
        : product.total_quantity;
      const unitPrice =
        product.unit_price === null || product.unit_price === undefined
          ? null
          : Number(product.unit_price || 0);
      const totalPrice =
        unitPrice === null
          ? null
          : Number((Number(actualQuantity || 0) * unitPrice).toFixed(2));

      return {
        ...restProduct,
        buyer_notes: Array.from(_buyerNoteSet || []).join(' | '),
        order_item_ids: Array.from(_orderItemIdSet || []).filter((id) => Number.isFinite(id)),
        purchased_quantity_total: Number(product.purchased_quantity_total || 0),
        received_quantity_total: Number(product.received_quantity_total || 0),
        actual_quantity: actualQuantity,
        actual_price: totalPrice
      };
    })
  }));

  return suppliers;
};

const normalizeManualItem = (item) => ({
  manual_item_id: Number(item.id),
  product_id: `manual-${item.id}`,
  base_product_id: item.base_product_id || item.product_id || null,
  product_name: item.product_name || 'สินค้าเพิ่มเติม',
  branch_id: item.branch_id || null,
  branch_name: item.branch_name || '',
  unit_abbr: item.unit_abbr || '',
  unit_name: item.unit_name || '',
  supplier_master_id: item.supplier_master_id || null,
  supplier_master_name: item.supplier_master_name || '',
  supplier_has_bank_account:
    item.supplier_has_bank_account === undefined || item.supplier_has_bank_account === null
      ? null
      : Boolean(Number(item.supplier_has_bank_account)),
  supplier_bank_name: item.supplier_bank_name || '',
  supplier_account_number: item.supplier_account_number || '',
  supplier_account_name: item.supplier_account_name || '',
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
  purchased_quantity_total: Number(item.purchased_quantity_total || 0),
  received_quantity_total: Number(item.received_quantity_total || 0),
  buyer_notes: '',
  is_manual: true
});

const mergeManualItems = (suppliers, manualItems = []) => {
  const supplierMap = new Map(
    (suppliers || []).map((supplier) => [String(supplier.id), { ...supplier }])
  );

  (manualItems || []).forEach((rawItem) => {
    const supplierId = String(rawItem.supplier_id || rawItem.product_group_id || 'none');
    const supplierName = rawItem.supplier_name || 'ไม่ระบุกลุ่มสินค้า';
    const normalizedItem = normalizeManualItem(rawItem);

    if (!supplierMap.has(supplierId)) {
      supplierMap.set(supplierId, {
        id: supplierId,
        name: supplierName,
        products: [],
        branch_names: [],
        department_names: []
      });
    }

    const supplier = supplierMap.get(supplierId);
    const branchNames = new Set(supplier.branch_names || []);
    if (normalizedItem.branch_name) branchNames.add(normalizedItem.branch_name);
    supplier.branch_names = Array.from(branchNames);
    supplier.products = [...(supplier.products || []), normalizedItem];
  });

  return Array.from(supplierMap.values());
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

const toPositiveNumberOrNull = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const getLatestUnitPriceForCalc = (product) => {
  const candidates = product?.is_store_group
    ? [product?.last_po_unit_price, product?.latest_price, product?.unit_price]
    : [product?.latest_price, product?.unit_price, product?.last_po_unit_price];

  for (const candidate of candidates) {
    const parsed = toPositiveNumberOrNull(candidate);
    if (parsed !== null) return parsed;
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

const formatThaiDate = (value) => {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

const formatThaiDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
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
    branchId: '',
    productId: '',
    productName: '',
    quantity: '1',
    price: ''
  });
  const [branchOptions, setBranchOptions] = useState([]);
  const [manualProducts, setManualProducts] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSuggestionsOpen, setManualSuggestionsOpen] = useState(false);
  const [incompleteModal, setIncompleteModal] = useState({
    open: false,
    supplierName: '',
    items: []
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [reportProductGroups, setReportProductGroups] = useState([]);
  const [reportStartDate, setReportStartDate] = useState(toLocalDateString(new Date()));
  const [reportEndDate, setReportEndDate] = useState(toLocalDateString(new Date()));
  const [reportProductGroupId, setReportProductGroupId] = useState('');
  const [reportViewMode, setReportViewMode] = useState('branch');
  const [reportRows, setReportRows] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reconcileDate, setReconcileDate] = useState(selectedDate);
  const [reconcileProductGroupId, setReconcileProductGroupId] = useState('');
  const [reconcileRows, setReconcileRows] = useState([]);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [receivingReportDate, setReceivingReportDate] = useState(selectedDate);
  const [receivingReportProductGroupId, setReceivingReportProductGroupId] = useState('');
  const [receivingReportViewMode, setReceivingReportViewMode] = useState('branch_department');
  const [receivingReportRows, setReceivingReportRows] = useState([]);
  const [receivingReportLoading, setReceivingReportLoading] = useState(false);
  const [reconcileDetailModal, setReconcileDetailModal] = useState({
    open: false,
    row: null,
    items: [],
    loading: false
  });
  const [receivingDetailModal, setReceivingDetailModal] = useState({
    open: false,
    row: null,
    items: [],
    loading: false
  });
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
    setReconcileDate(selectedDate);
    setReceivingReportDate(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const branches = await masterAPI.getBranches();
        setBranchOptions(Array.isArray(branches) ? branches : []);
      } catch (error) {
        console.error('Error fetching branches for manual add:', error);
        setBranchOptions([]);
      }
    };
    fetchBranches();
  }, []);

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

  useEffect(() => {
    const loadProductGroups = async () => {
      try {
        const groups = await productsAPI.getProductGroups();
        setReportProductGroups(Array.isArray(groups) ? groups : []);
      } catch (error) {
        console.error('Error loading product groups for report:', error);
        setReportProductGroups([]);
      }
    };
    loadProductGroups();
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

      const [orderRes, manualRes] = await Promise.all([
        adminAPI.getOrderItems(selectedDate),
        adminAPI.getPurchaseWalkManualItems(selectedDate)
      ]);
      const items = Array.isArray(orderRes?.data) ? orderRes.data : [];
      const manualItems = Array.isArray(manualRes?.data) ? manualRes.data : [];
      const grouped = groupPurchaseItems(items);
      const merged = mergeManualItems(grouped, manualItems);
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

  const loadValueReport = async () => {
    try {
      setReportLoading(true);
      const response = await adminAPI.getPurchaseWalkValueReport({
        start: reportStartDate,
        end: reportEndDate,
        view: reportViewMode,
        productGroupId: reportProductGroupId || undefined
      });
      setReportRows(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      console.error('Error loading purchase walk value report:', error);
      setReportRows([]);
    } finally {
      setReportLoading(false);
    }
  };

  const loadReconcileReport = async () => {
    try {
      setReconcileLoading(true);
      const response = await adminAPI.getPurchaseReceiveReconcileReport({
        start: reconcileDate,
        end: reconcileDate,
        productGroupId: reconcileProductGroupId || undefined
      });
      setReconcileRows(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      console.error('Error loading purchase-receive reconcile report:', error);
      setReconcileRows([]);
    } finally {
      setReconcileLoading(false);
    }
  };

  const loadReceivingReport = async () => {
    try {
      setReceivingReportLoading(true);
      const response = await adminAPI.getPurchaseReceivingSummaryReport({
        start: receivingReportDate,
        end: receivingReportDate,
        view: receivingReportViewMode,
        productGroupId: receivingReportProductGroupId || undefined
      });
      setReceivingReportRows(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      console.error('Error loading purchase receiving report:', error);
      setReceivingReportRows([]);
    } finally {
      setReceivingReportLoading(false);
    }
  };

  const openReconcileDetail = async (row) => {
    if (!row) return;
    setReconcileDetailModal({
      open: true,
      row,
      items: [],
      loading: true
    });
    try {
      const response = await adminAPI.getPurchaseReceiveReconcileDetail({
        date: reconcileDate,
        productId: row.product_id,
        productGroupId: row.product_group_id
      });
      setReconcileDetailModal({
        open: true,
        row,
        items: Array.isArray(response?.data) ? response.data : [],
        loading: false
      });
    } catch (error) {
      console.error('Error loading reconcile detail:', error);
      setReconcileDetailModal({
        open: true,
        row,
        items: [],
        loading: false
      });
      alert('โหลดรายละเอียดไม่สำเร็จ');
    }
  };

  const openReceivingDetail = async (row) => {
    if (!row) return;
    setReceivingDetailModal({ open: true, row, items: [], loading: true });
    try {
      const response = await adminAPI.getPurchaseReceivingSummaryDetail({
        start: receivingReportDate,
        end: receivingReportDate,
        productGroupId: row.product_group_id || undefined,
        branchId: row.branch_id || undefined,
        departmentId: row.department_id || undefined
      });
      setReceivingDetailModal({
        open: true,
        row,
        items: Array.isArray(response?.data) ? response.data : [],
        loading: false
      });
    } catch (error) {
      console.error('Error loading receiving detail:', error);
      setReceivingDetailModal({ open: true, row, items: [], loading: false });
      alert('โหลดรายละเอียดไม่สำเร็จ');
    }
  };

  useEffect(() => {
    if (activeTab !== 'report') return;
    loadValueReport();
  }, [activeTab, reportStartDate, reportEndDate, reportProductGroupId, reportViewMode]);

  useEffect(() => {
    if (activeTab !== 'reconcile') return;
    loadReconcileReport();
  }, [activeTab, reconcileDate, reconcileProductGroupId]);

  useEffect(() => {
    if (activeTab !== 'receiving_report') return;
    loadReceivingReport();
  }, [activeTab, receivingReportDate, receivingReportProductGroupId, receivingReportViewMode]);

  const updateProduct = (supplierId, productId, updates) => {
    setSuppliers((prev) =>
      prev.map((supplier) => {
        if (supplier.id !== supplierId) return supplier;
        return {
          ...supplier,
          products: supplier.products.map((product) =>
            product.product_id === productId ? { ...product, ...updates } : product
          )
        };
      })
    );
  };

  const openManualModal = (supplierId) => {
    const supplier = suppliers.find(
      (entry) => String(entry.id) === String(supplierId)
    );
    const supplierBranchNames = Array.isArray(supplier?.branch_names)
      ? supplier.branch_names.filter(Boolean)
      : [];
    const defaultBranch =
      supplierBranchNames.length === 1
        ? branchOptions.find((branch) => branch.name === supplierBranchNames[0])
        : null;
    const defaultBranchId = defaultBranch
      ? String(defaultBranch.id)
      : supplierBranchNames.length === 1
        ? String(supplierBranchNames[0])
        : '';
    setManualModal({
      open: true,
      supplierId,
      branchId: defaultBranchId,
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
      branchId: '',
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

  const handleAddManualItem = async () => {
    if (!manualModal.supplierId) return;
    if (!manualModal.branchId) {
      alert('กรุณาเลือกสาขา');
      return;
    }
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
    const selectedBranch = manualBranchChoices.find(
      (branch) => String(branch.id) === String(manualModal.branchId)
    );
    const parsedSupplierId = Number(manualModal.supplierId);
    if (!Number.isFinite(parsedSupplierId) || parsedSupplierId <= 0) {
      alert('กลุ่มสินค้าไม่ถูกต้อง');
      return;
    }
    const parsedBranchId = Number(selectedBranch?.id ?? manualModal.branchId);
    if (!Number.isFinite(parsedBranchId) || parsedBranchId <= 0) {
      alert('สาขาไม่ถูกต้อง');
      return;
    }
    const payload = {
      order_date: selectedDate,
      product_group_id: parsedSupplierId,
      branch_id: parsedBranchId,
      base_product_id: Number(selectedProduct.id),
      product_name: selectedProduct.name,
      unit_abbr: selectedProduct.unit_abbr || selectedProduct.unit_name || '',
      unit_name: selectedProduct.unit_name || selectedProduct.unit_abbr || '',
      actual_quantity: Number.isFinite(quantity) ? quantity : 1,
      actual_price: Number.isFinite(price) ? price : null,
      is_purchased: false,
      purchase_reason: null
    };

    try {
      await adminAPI.createPurchaseWalkManualItem(payload);
      closeManualModal();
      await fetchData();
    } catch (error) {
      console.error('Error creating manual purchase item:', error);
      alert(error.response?.data?.message || 'เพิ่มสินค้าไม่สำเร็จ');
    }
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

  const handleCalculateFromLatest = (supplierId, product) => {
    const parsedActualQuantity =
      product.actual_quantity === '' || product.actual_quantity === null
        ? null
        : Number(product.actual_quantity);
    const normalizedQuantity =
      parsedActualQuantity !== null && Number.isFinite(parsedActualQuantity)
        ? Number(parsedActualQuantity)
        : Number(product.total_quantity || 0);

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
      alert('กรุณากรอกจำนวนให้มากกว่า 0 ก่อนคำนวณ');
      return;
    }

    const latestUnitPrice = getLatestUnitPriceForCalc(product);
    if (latestUnitPrice === null) {
      alert('ไม่พบราคาล่าสุดสำหรับคำนวณ');
      return;
    }

    const calculatedTotal = Number((normalizedQuantity * latestUnitPrice).toFixed(2));
    ensureEditing(supplierId, product);
    updateProduct(supplierId, product.product_id, {
      actual_price: calculatedTotal
    });
  };

  const handleMarkPurchased = async (supplierId, product, overrideReason) => {
    const key = makeEditKey(supplierId, product.product_id);
    const parsedActualQuantity =
      product.actual_quantity === '' || product.actual_quantity === null
        ? null
        : Number(product.actual_quantity);
    const actualQuantity =
      parsedActualQuantity !== null && Number.isFinite(parsedActualQuantity)
        ? parsedActualQuantity
        : null;
    const totalQuantity = Number(product.total_quantity || 0);
    const shouldRequireExplicitQuantity =
      !product.is_fixed_fee && !product.is_manual && totalQuantity <= 0;
    if (
      shouldRequireExplicitQuantity &&
      (actualQuantity === null || !Number.isFinite(actualQuantity) || actualQuantity <= 0)
    ) {
      alert('กรุณากรอกจำนวนให้มากกว่า 0 ก่อนบันทึก');
      return;
    }
    const normalizedActualQuantity =
      actualQuantity === null || actualQuantity === undefined
        ? totalQuantity
        : Number(actualQuantity || 0);
    const shouldRequirePrice = normalizedActualQuantity > 0;

    const hasPriceInput =
      product.actual_price !== '' &&
      product.actual_price !== null &&
      product.actual_price !== undefined;
    const parsedActualPrice = hasPriceInput ? Number(product.actual_price) : null;
    if (
      shouldRequirePrice &&
      (!hasPriceInput ||
        parsedActualPrice === null ||
        !Number.isFinite(parsedActualPrice))
    ) {
      alert('กรุณากรอกราคาก่อนบันทึก');
      return;
    }
    if (
      hasPriceInput &&
      parsedActualPrice !== null &&
      Number.isFinite(parsedActualPrice) &&
      parsedActualPrice === 0
    ) {
      alert('ไม่สามารถบันทึกได้เมื่อราคาเป็น 0 บาท');
      return;
    }
    const normalizedActualPrice =
      parsedActualPrice !== null &&
      Number.isFinite(parsedActualPrice) &&
      parsedActualPrice > 0
        ? parsedActualPrice
        : null;
    const priceForSave =
      normalizedActualQuantity > 0
        ? normalizedActualPrice
        : null;

    if (product.is_manual) {
      if (!product.manual_item_id) {
        alert('ไม่พบรหัสรายการสินค้าเพิ่ม');
        return;
      }
      try {
        setSavingId(product.product_id);
        const branchIdForUpdate = Number(product.branch_id);
        const response = await adminAPI.updatePurchaseWalkManualItem(product.manual_item_id, {
          actual_price: priceForSave,
          actual_quantity: normalizedActualQuantity,
          is_purchased: true,
          purchase_reason: null,
          branch_id: Number.isFinite(branchIdForUpdate) ? branchIdForUpdate : undefined
        });
        const updatedRow = response?.data;
        if (updatedRow) {
          updateProduct(supplierId, product.product_id, normalizeManualItem(updatedRow));
        } else {
          updateProduct(supplierId, product.product_id, {
            actual_price: priceForSave,
            actual_quantity: normalizedActualQuantity,
            is_purchased: true,
            purchase_reason: null
          });
        }
        setEditingMap((prev) => ({ ...prev, [key]: false }));
      } catch (error) {
        console.error('Error saving manual purchase item:', error);
        alert(error.response?.data?.message || 'บันทึกสินค้าเพิ่มไม่สำเร็จ');
      } finally {
        setSavingId(null);
      }
      return;
    }

    if (product.is_fixed_fee) {
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
        order_item_ids: Array.isArray(product.order_item_ids) ? product.order_item_ids : [],
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
      alert(error.response?.data?.message || 'เกิดข้อผิดพลาดในการบันทึกการซื้อ');
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
      if (product.is_manual) {
        if (!product.manual_item_id) {
          alert('ไม่พบรหัสรายการสินค้าเพิ่ม');
          return;
        }
        const branchIdForUpdate = Number(product.branch_id);
        const response = await adminAPI.updatePurchaseWalkManualItem(product.manual_item_id, {
          actual_price: null,
          actual_quantity: product.actual_quantity ?? product.total_quantity ?? 1,
          is_purchased: false,
          purchase_reason: null,
          branch_id: Number.isFinite(branchIdForUpdate) ? branchIdForUpdate : undefined
        });
        const updatedRow = response?.data;
        if (updatedRow) {
          updateProduct(supplierId, product.product_id, normalizeManualItem(updatedRow));
        } else {
          updateProduct(supplierId, product.product_id, {
            actual_price: null,
            actual_quantity: product.actual_quantity ?? product.total_quantity ?? 1,
            is_purchased: false,
            purchase_reason: null
          });
        }
        return;
      }

      if (product.is_fixed_fee) {
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
        order_item_ids: Array.isArray(product.order_item_ids) ? product.order_item_ids : [],
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
  const manualSupplier = suppliers.find(
    (supplier) => String(supplier.id) === String(manualModal.supplierId)
  );
  const manualBranchChoices = useMemo(() => {
    if (!manualSupplier) return branchOptions;
    const supplierBranchNames = new Set(
      Array.isArray(manualSupplier.branch_names)
        ? manualSupplier.branch_names.filter(Boolean)
        : []
    );
    if (supplierBranchNames.size === 0) return branchOptions;
    if (!Array.isArray(branchOptions) || branchOptions.length === 0) {
      return Array.from(supplierBranchNames).map((name) => ({ id: name, name }));
    }
    const matched = branchOptions.filter((branch) => supplierBranchNames.has(branch.name));
    return matched.length > 0 ? matched : branchOptions;
  }, [manualSupplier, branchOptions]);
  const reportSummary = useMemo(
    () =>
      reportRows.reduce(
        (acc, row) => {
          acc.total_amount += Number(row.total_amount || 0);
          acc.total_quantity += Number(row.total_quantity || 0);
          acc.item_count += Number(row.item_count || 0);
          return acc;
        },
        {
          total_amount: 0,
          total_quantity: 0,
          item_count: 0
        }
      ),
    [reportRows]
  );
  const selectedReportGroupName =
    reportProductGroups.find((group) => String(group.id) === String(reportProductGroupId))
      ?.name || 'ทุกกลุ่มสินค้า';
  const selectedReconcileGroupName =
    reportProductGroups.find((group) => String(group.id) === String(reconcileProductGroupId))
      ?.name || 'ทุกกลุ่มสินค้า';
  const selectedReceivingGroupName =
    reportProductGroups.find((group) => String(group.id) === String(receivingReportProductGroupId))
      ?.name || 'ทุกกลุ่มสินค้า';
  const reconcileSummary = useMemo(
    () =>
      reconcileRows.reduce(
        (acc, row) => {
          const purchased = Number(row.purchased_quantity || 0);
          const received = Number(row.received_quantity || 0);
          const pending = purchased - received;
          acc.purchased_total += purchased;
          acc.received_total += received;
          acc.pending_total += pending;
          if (Math.abs(pending) < 0.000001) {
            acc.completed_count += 1;
          } else if (pending > 0) {
            acc.shortage_count += 1;
          } else {
            acc.over_count += 1;
          }
          return acc;
        },
        {
          purchased_total: 0,
          received_total: 0,
          pending_total: 0,
          completed_count: 0,
          shortage_count: 0,
          over_count: 0
        }
      ),
    [reconcileRows]
  );
  const receivingReportSummary = useMemo(
    () =>
      receivingReportRows.reduce(
        (acc, row) => {
          acc.ordered_total += Number(row.ordered_quantity || 0);
          acc.purchased_total += Number(row.purchased_quantity || 0);
          acc.received_total += Number(row.received_quantity || 0);
          acc.pending_total += Number(row.pending_quantity || 0);
          if (Boolean(row.pricing_ready)) {
            acc.received_amount += Number(row.received_amount || 0);
            acc.pricing_ready_count += 1;
          } else {
            acc.warning_count += 1;
          }
          return acc;
        },
        {
          ordered_total: 0,
          purchased_total: 0,
          received_total: 0,
          pending_total: 0,
          received_amount: 0,
          pricing_ready_count: 0,
          warning_count: 0
        }
      ),
    [receivingReportRows]
  );
  const hasItems = suppliers.some((supplier) => supplier.products.length > 0);
  const transferSourceSuppliers = printSupplierId
    ? suppliers.filter((supplier) => String(supplier.id) === String(printSupplierId))
    : suppliers;
  const transferGroups = useMemo(() => {
    const grouped = new Map();

    transferSourceSuppliers.forEach((supplier) => {
      (supplier.products || []).forEach((product) => {
        const amount = Number(getProductTotalAmount(product) || 0);
        if (!Number.isFinite(amount) || amount <= 0) return;

        const supplierMasterId = Number(product.supplier_master_id || 0);
        const supplierMasterName = String(product.supplier_master_name || '').trim();
        const fallbackKey = `group:${supplier.id}`;
        const groupKey = supplierMasterId > 0 ? `master:${supplierMasterId}` : fallbackKey;

        if (!grouped.has(groupKey)) {
          grouped.set(groupKey, {
            key: groupKey,
            supplier_name: supplierMasterName || supplier.name || 'ไม่ระบุซัพพลายเออร์',
            bank_name: product.supplier_bank_name || '',
            account_number: product.supplier_account_number || '',
            account_name: product.supplier_account_name || '',
            product_amounts: new Map(),
            total_amount: 0
          });
        }

        const row = grouped.get(groupKey);
        if (!row.bank_name && product.supplier_bank_name) row.bank_name = product.supplier_bank_name;
        if (!row.account_number && product.supplier_account_number) {
          row.account_number = product.supplier_account_number;
        }
        if (!row.account_name && product.supplier_account_name) row.account_name = product.supplier_account_name;

        const productName = String(product.product_name || '-').trim();
        const currentAmount = Number(row.product_amounts.get(productName) || 0);
        row.product_amounts.set(productName, currentAmount + amount);
        row.total_amount += amount;
      });
    });

    return Array.from(grouped.values())
      .map((entry) => ({
        ...entry,
        products: Array.from(entry.product_amounts.entries())
          .map(([name, amount]) => ({ name, amount }))
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'))
      }))
      .sort((a, b) =>
        String(a.supplier_name || '').localeCompare(String(b.supplier_name || ''), 'th')
      );
  }, [transferSourceSuppliers]);
  const canCopyTransfer = transferGroups.length > 0;
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

  const handleCopyTransferNote = async () => {
    if (!canCopyTransfer) {
      alert('ไม่พบรายการสำหรับคัดลอกแจ้งโอน');
      return;
    }

    const headerScope = printSupplierId
      ? `กลุ่มสินค้า: ${suppliers.find((s) => String(s.id) === String(printSupplierId))?.name || '-'}`
      : 'ทุกกลุ่มสินค้า';
    const lines = [
      `แจ้งโอนค่าสินค้า วันที่ ${formatThaiDate(selectedDate)}`,
      headerScope,
      ''
    ];

    transferGroups.forEach((group, index) => {
      lines.push(`${index + 1}. ${group.supplier_name}`);
      (group.products || []).forEach((product) => {
        lines.push(`- ${product.name}: ฿${formatMoney(product.amount)}`);
      });
      lines.push(`รวมต้องโอน: ฿${formatMoney(group.total_amount)}`);
      lines.push(`ธนาคาร: ${group.bank_name || '-'}`);
      lines.push(`เลขบัญชี: ${group.account_number || '-'}`);
      lines.push(`ชื่อบัญชี: ${group.account_name || '-'}`);
      lines.push('');
    });

    const text = lines.join('\n').trim();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      alert(`คัดลอกข้อความแจ้งโอนแล้ว (${transferGroups.length} ซัพพลายเออร์)`);
    } catch (error) {
      console.error('Error copying transfer note:', error);
      alert('คัดลอกข้อความไม่สำเร็จ');
    }
  };
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

  useEffect(() => {
    if (!SHOW_MY_PURCHASE_TAB && activeTab === 'mine') {
      setActiveTab('walk');
    }
    if (!SHOW_PURCHASE_VALUE_REPORT_TAB && activeTab === 'report') {
      setActiveTab('walk');
    }
  }, [activeTab]);

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
      setActiveTab('walk');
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

  const handleExportReportCsv = () => {
    if (!Array.isArray(reportRows) || reportRows.length === 0) {
      alert('ยังไม่มีข้อมูลให้ Export');
      return;
    }
    const headers = reportViewMode === 'total'
      ? ['วันที่', 'จำนวนรายการ', 'ปริมาณรวม', 'มูลค่า(บาท)']
      : reportViewMode === 'branch_department'
        ? ['วันที่', 'สาขา', 'แผนก', 'จำนวนรายการ', 'ปริมาณรวม', 'มูลค่า(บาท)']
        : ['วันที่', 'สาขา', 'จำนวนรายการ', 'ปริมาณรวม', 'มูลค่า(บาท)'];
    const rows = reportRows.map((row) => {
      if (reportViewMode === 'total') {
        return [
          row.report_date || '',
          Number(row.item_count || 0),
          Number(row.total_quantity || 0),
          roundMoney(Number(row.total_amount || 0))
        ];
      }
      if (reportViewMode === 'branch_department') {
        return [
          row.report_date || '',
          row.branch_name || '',
          row.department_name || '',
          Number(row.item_count || 0),
          Number(row.total_quantity || 0),
          roundMoney(Number(row.total_amount || 0))
        ];
      }
      return [
        row.report_date || '',
        row.branch_name || '',
        Number(row.item_count || 0),
        Number(row.total_quantity || 0),
        roundMoney(Number(row.total_amount || 0))
      ];
    });
    const safeGroupName = String(selectedReportGroupName || 'ทุกกลุ่มสินค้า')
      .replace(/[^\wก-๙-]/g, '_')
      .slice(0, 40);
    const filename = `purchase_walk_value_${reportStartDate}_${reportEndDate}_${safeGroupName}.csv`;
    downloadCsv(filename, headers, rows);
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
      <div className="max-w-6xl mx-auto print-root">
        <style>{`
          @media print {
            @page {
              size: A4 portrait;
              margin: 6mm;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              width: auto;
              height: auto;
            }
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              background: #fff;
            }
            .print-root {
              max-width: none !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            .print-root > * {
              display: none !important;
            }
            .print-root > .print-area {
              display: block !important;
            }
            .print-area {
              width: 198mm;
              min-height: 285mm;
              height: auto;
              margin: 0 auto;
              overflow: hidden;
              page-break-after: avoid;
              break-after: avoid-page;
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
              min-height: 285mm;
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
            {SHOW_MY_PURCHASE_TAB && activeTab === 'mine' && (
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
                <Button
                  onClick={handleCopyTransferNote}
                  variant="secondary"
                  disabled={!canCopyTransfer}
                >
                  คัดลอกแจ้งโอน
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
              {SHOW_MY_PURCHASE_TAB && (
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
              )}
              {SHOW_PURCHASE_VALUE_REPORT_TAB && (
                <button
                  onClick={() => setActiveTab('report')}
                  className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                    activeTab === 'report'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  รายงานมูลค่าซื้อ
                </button>
              )}
              <button
                onClick={() => setActiveTab('reconcile')}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                  activeTab === 'reconcile'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                เช็คซื้อ-รับรวมกลุ่ม
              </button>
              <button
                onClick={() => setActiveTab('receiving_report')}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                  activeTab === 'receiving_report'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                รายงานการรับของ
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
                            const shouldRequireExplicitQuantity =
                              !product.is_fixed_fee && !product.is_manual && orderedQty <= 0;
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
                            const parsedRowQuantity =
                              product.actual_quantity === '' || product.actual_quantity === null
                                ? null
                                : Number(product.actual_quantity);
                            const normalizedRowQuantity =
                              parsedRowQuantity !== null && Number.isFinite(parsedRowQuantity)
                                ? parsedRowQuantity
                                : Number(product.total_quantity || 0);
                            const isMissingQuantityInput =
                              shouldRequireExplicitQuantity &&
                              (!Number.isFinite(parsedRowQuantity) || parsedRowQuantity <= 0);
                            const isZeroQuantityInput = normalizedRowQuantity <= 0;
                            const shouldRequirePriceInput = normalizedRowQuantity > 0;
                            const parsedRowPrice = hasPriceInput
                              ? Number(product.actual_price)
                              : null;
                            const isMissingPriceInput =
                              shouldRequirePriceInput &&
                              (!hasPriceInput ||
                                parsedRowPrice === null ||
                                !Number.isFinite(parsedRowPrice));
                            const isZeroPriceInput =
                              parsedRowPrice !== null &&
                              Number.isFinite(parsedRowPrice) &&
                              parsedRowPrice === 0;
                            const latestUnitPriceForCalc = getLatestUnitPriceForCalc(product);
                            const canCalculateFromLatest =
                              normalizedRowQuantity > 0 && latestUnitPriceForCalc !== null;
                            const isDone = product.is_purchased;
                            const canSave = !isDone || isEditing;

                            return (
                              <div
                                key={product.product_id}
                                className={`border-b py-2 last:border-b-0 ${
                                  isDone ? 'opacity-60' : ''
                                }`}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-gray-900 whitespace-normal break-words">
                                      {product.product_name}
                                      {product.is_manual && (
                                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                          เพิ่ม
                                        </span>
                                      )}
                                      {product.is_manual && product.branch_name && (
                                        <span className="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                          {product.branch_name}
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
                                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor} bg-gray-50 flex-shrink-0`}
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
                                  <div className="w-16 flex-shrink-0">
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
                                      disabled={isZeroQuantityInput || (isDone && !isEditing)}
                                    />
                                  </div>
                                  {!isDone && (
                                    <button
                                      type="button"
                                      onClick={() => handleCalculateFromLatest(supplier.id, product)}
                                      className="inline-flex items-center justify-center h-8 w-8 text-blue-700 border border-blue-200 rounded-md hover:bg-blue-50 disabled:text-gray-400 disabled:border-gray-200 disabled:hover:bg-transparent"
                                      disabled={
                                        savingId === product.product_id ||
                                        !canCalculateFromLatest
                                      }
                                      title={
                                        latestUnitPriceForCalc === null
                                          ? 'ไม่พบราคาล่าสุดสำหรับคำนวณ'
                                          : `คำนวณจากราคาล่าสุด ${latestUnitPriceForCalc.toFixed(2)} ต่อ${unitLabel || 'หน่วย'}`
                                      }
                                    >
                                      <svg
                                        className="w-4 h-4"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                      >
                                        <rect x="5" y="3" width="14" height="18" rx="2" ry="2" />
                                        <line x1="8" y1="7" x2="16" y2="7" />
                                        <line x1="8" y1="11" x2="8" y2="11" />
                                        <line x1="12" y1="11" x2="12" y2="11" />
                                        <line x1="16" y1="11" x2="16" y2="11" />
                                        <line x1="8" y1="15" x2="8" y2="15" />
                                        <line x1="12" y1="15" x2="12" y2="15" />
                                        <line x1="16" y1="15" x2="16" y2="15" />
                                      </svg>
                                    </button>
                                  )}
                                  <div className="flex flex-shrink-0 items-center gap-1">
                                    {!isEditing && isDone && (
                                      <>
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
                                        disabled={
                                          savingId === product.product_id ||
                                          isMissingQuantityInput ||
                                          isZeroPriceInput ||
                                          isMissingPriceInput
                                        }
                                        aria-label="บันทึก"
                                      >
                                        ✓
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                {isMissingQuantityInput ? (
                                  <p className="text-xs text-red-500 mt-1">กรุณากรอกจำนวนให้มากกว่า 0 ก่อนบันทึก</p>
                                ) : isMissingPriceInput ? (
                                  <p className="text-xs text-red-500 mt-1">กรุณากรอกราคาก่อนบันทึก</p>
                                ) : isZeroPriceInput ? (
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
            ) : activeTab === 'mine' ? (
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
            ) : activeTab === 'report' ? (
              <div className="space-y-4">
                <Card>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">
                        1. เลือกกลุ่มสินค้า
                      </label>
                      <select
                        value={reportProductGroupId}
                        onChange={(e) => setReportProductGroupId(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="">ทุกกลุ่มสินค้า</option>
                        {reportProductGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">
                        2. วันที่เริ่ม
                      </label>
                      <input
                        type="date"
                        value={reportStartDate}
                        onChange={(e) => setReportStartDate(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">
                        2. วันที่สิ้นสุด
                      </label>
                      <input
                        type="date"
                        value={reportEndDate}
                        onChange={(e) => setReportEndDate(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">
                        3. รูปแบบการแสดงผล
                      </label>
                      <select
                        value={reportViewMode}
                        onChange={(e) => setReportViewMode(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="total">รวมทั้งหมด</option>
                        <option value="branch">3.1 แสดงแบ่งสาขา</option>
                        <option value="branch_department">3.2 แสดงแบ่งสาขาและแผนก</option>
                      </select>
                    </div>
                  </div>
                </Card>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-gray-600">
                    กลุ่มสินค้า: <span className="font-semibold text-gray-900">{selectedReportGroupName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={loadValueReport}
                      disabled={reportLoading}
                    >
                      {reportLoading ? 'กำลังโหลด...' : 'ค้นหารายงาน'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleExportReportCsv}
                      disabled={reportRows.length === 0}
                    >
                      Export Excel
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Card>
                    <p className="text-sm text-gray-500">มูลค่ารวมช่วงวันที่</p>
                    <p className="text-2xl font-bold text-gray-900">฿{formatMoney(reportSummary.total_amount)}</p>
                  </Card>
                  <Card>
                    <p className="text-sm text-gray-500">จำนวนบรรทัดรายงาน</p>
                    <p className="text-2xl font-bold text-gray-900">{reportRows.length.toLocaleString('th-TH')}</p>
                  </Card>
                  <Card>
                    <p className="text-sm text-gray-500">จำนวนรายการสินค้า</p>
                    <p className="text-2xl font-bold text-gray-900">{reportSummary.item_count.toLocaleString('th-TH')}</p>
                  </Card>
                </div>

                <Card>
                  {reportLoading ? (
                    <div className="py-6 text-center text-sm text-gray-500">กำลังโหลดรายงาน...</div>
                  ) : reportRows.length === 0 ? (
                    <div className="py-6 text-center text-sm text-gray-500">ไม่พบข้อมูลตามเงื่อนไข</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-gray-500">
                            <th className="py-2 pr-3 font-semibold">วันที่</th>
                            {reportViewMode !== 'total' && (
                              <th className="py-2 pr-3 font-semibold">สาขา</th>
                            )}
                            {reportViewMode === 'branch_department' && (
                              <th className="py-2 pr-3 font-semibold">แผนก</th>
                            )}
                            <th className="py-2 pr-3 font-semibold text-right">จำนวนรายการ</th>
                            <th className="py-2 pr-3 font-semibold text-right">ปริมาณรวม</th>
                            <th className="py-2 font-semibold text-right">มูลค่า (บาท)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportRows.map((row, index) => (
                            <tr
                              key={`${row.report_date}-${row.branch_id || 0}-${row.department_id || 0}-${index}`}
                              className="border-b last:border-b-0"
                            >
                              <td className="py-2 pr-3">{formatThaiDate(row.report_date)}</td>
                              {reportViewMode !== 'total' && (
                                <td className="py-2 pr-3">{row.branch_name || '-'}</td>
                              )}
                              {reportViewMode === 'branch_department' && (
                                <td className="py-2 pr-3">{row.department_name || '-'}</td>
                              )}
                              <td className="py-2 pr-3 text-right">
                                {Number(row.item_count || 0).toLocaleString('th-TH')}
                              </td>
                              <td className="py-2 pr-3 text-right">
                                {Number(row.total_quantity || 0).toLocaleString('th-TH', {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2
                                })}
                              </td>
                              <td className="py-2 text-right font-semibold text-gray-900">
                                ฿{formatMoney(row.total_amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td
                              colSpan={
                                reportViewMode === 'branch_department'
                                  ? 3
                                  : reportViewMode === 'total'
                                    ? 1
                                    : 2
                              }
                              className="pt-3 pr-3 font-semibold text-gray-900"
                            >
                              รวมทั้งหมด
                            </td>
                            <td className="pt-3 pr-3 text-right text-gray-700">
                              {reportSummary.item_count.toLocaleString('th-TH')}
                            </td>
                            <td className="pt-3 pr-3 text-right text-gray-700">
                              {reportSummary.total_quantity.toLocaleString('th-TH', {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 2
                              })}
                            </td>
                            <td className="pt-3 text-right font-bold text-gray-900">
                              ฿{formatMoney(reportSummary.total_amount)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            ) : activeTab === 'receiving_report' ? (
              <div className="space-y-4">
                <Card>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">
                        กลุ่มสินค้า
                      </label>
                      <select
                        value={receivingReportProductGroupId}
                        onChange={(e) => setReceivingReportProductGroupId(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="">ทุกกลุ่มสินค้า</option>
                        {reportProductGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">
                        วันที่
                      </label>
                      <input
                        type="date"
                        value={receivingReportDate}
                        onChange={(e) => setReceivingReportDate(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">
                        มุมมอง
                      </label>
                      <select
                        value={receivingReportViewMode}
                        onChange={(e) => setReceivingReportViewMode(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="branch_department">กลุ่มย่อยแผนก</option>
                        <option value="branch">รวมแบบสาขา</option>
                      </select>
                    </div>
                  </div>
                </Card>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-gray-600">
                    กลุ่มสินค้า:{' '}
                    <span className="font-semibold text-gray-900">{selectedReceivingGroupName}</span>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={loadReceivingReport}
                    disabled={receivingReportLoading}
                  >
                    {receivingReportLoading ? 'กำลังโหลด...' : 'ค้นหาข้อมูล'}
                  </Button>
                </div>

                {receivingReportSummary.warning_count > 0 && (
                  <Card>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      ยังมี {receivingReportSummary.warning_count} แถวที่ยังแสดงราคาไม่ได้
                      กรุณาไปแท็บ “เดินซื้อของ” เพื่อใส่จำนวนและราคาให้ครบก่อน
                      <button
                        type="button"
                        onClick={() => setActiveTab('walk')}
                        className="ml-2 font-semibold underline"
                      >
                        ไปหน้าเดินซื้อของ
                      </button>
                    </div>
                  </Card>
                )}

                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <Card>
                    <p className="text-sm text-gray-500">สั่งซื้อรวม</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {receivingReportSummary.ordered_total.toLocaleString('th-TH', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2
                      })}
                    </p>
                  </Card>
                  <Card>
                    <p className="text-sm text-gray-500">ซื้อจริงรวม</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {receivingReportSummary.purchased_total.toLocaleString('th-TH', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2
                      })}
                    </p>
                  </Card>
                  <Card>
                    <p className="text-sm text-gray-500">รับจริงรวม</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {receivingReportSummary.received_total.toLocaleString('th-TH', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2
                      })}
                    </p>
                  </Card>
                  <Card>
                    <p className="text-sm text-gray-500">ค้างรับรวม</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {receivingReportSummary.pending_total.toLocaleString('th-TH', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2
                      })}
                    </p>
                  </Card>
                  <Card>
                    <p className="text-sm text-gray-500">มูลค่ารับรวม</p>
                    <p className="text-2xl font-bold text-gray-900">
                      ฿{formatMoney(receivingReportSummary.received_amount)}
                    </p>
                    <p className="text-xs text-gray-500">
                      พร้อมราคา {receivingReportSummary.pricing_ready_count} แถว
                    </p>
                  </Card>
                </div>

                <Card>
                  {receivingReportLoading ? (
                    <div className="py-6 text-center text-sm text-gray-500">กำลังโหลดข้อมูล...</div>
                  ) : receivingReportRows.length === 0 ? (
                    <div className="py-6 text-center text-sm text-gray-500">ไม่พบข้อมูลตามเงื่อนไข</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-gray-500">
                            <th className="py-2 pr-3 font-semibold">กลุ่มสินค้า</th>
                            <th className="py-2 pr-3 font-semibold">สาขา</th>
                            {receivingReportViewMode === 'branch_department' && (
                              <th className="py-2 pr-3 font-semibold">แผนก</th>
                            )}
                            <th className="py-2 pr-3 font-semibold text-right">สั่งซื้อ</th>
                            <th className="py-2 pr-3 font-semibold text-right">ซื้อจริง</th>
                            <th className="py-2 pr-3 font-semibold text-right">รับจริง</th>
                            <th className="py-2 pr-3 font-semibold text-right">ค้างรับ</th>
                            <th className="py-2 pr-3 font-semibold text-right">มูลค่ารับ (บาท)</th>
                            <th className="py-2 font-semibold">สถานะราคา</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receivingReportRows.map((row, index) => (
                            <tr
                              key={`${row.product_group_id}-${row.branch_id}-${row.department_id || 0}-${index}`}
                              className="border-b last:border-b-0 cursor-pointer hover:bg-gray-50"
                              onClick={() => openReceivingDetail(row)}
                            >
                              <td className="py-2 pr-3">{row.product_group_name || '-'}</td>
                              <td className="py-2 pr-3">{row.branch_name || '-'}</td>
                              {receivingReportViewMode === 'branch_department' && (
                                <td className="py-2 pr-3">{row.department_name || '-'}</td>
                              )}
                              <td className="py-2 pr-3 text-right">
                                {Number(row.ordered_quantity || 0).toLocaleString('th-TH', {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2
                                })}
                              </td>
                              <td className="py-2 pr-3 text-right">
                                {Number(row.purchased_quantity || 0).toLocaleString('th-TH', {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2
                                })}
                              </td>
                              <td className="py-2 pr-3 text-right">
                                {Number(row.received_quantity || 0).toLocaleString('th-TH', {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2
                                })}
                              </td>
                              <td className="py-2 pr-3 text-right font-semibold">
                                {Number(row.pending_quantity || 0).toLocaleString('th-TH', {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2
                                })}
                              </td>
                              <td className="py-2 pr-3 text-right">
                                {row.pricing_ready ? (
                                  <span className="font-semibold text-gray-900">
                                    ฿{formatMoney(row.received_amount)}
                                  </span>
                                ) : (
                                  <span className="text-xs font-semibold text-amber-700">
                                    ใส่จำนวนและราคาก่อน
                                  </span>
                                )}
                              </td>
                              <td className="py-2">
                                {row.pricing_ready ? (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
                                    พร้อมแสดงราคา
                                  </span>
                                ) : (
                                  <span className="text-xs text-amber-700">
                                    {row.warning_message || 'กรุณาไปใส่จำนวนและราคาให้ครบ'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            ) : (
              <div className="space-y-4">
                <Card>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">
                        กลุ่มสินค้า
                      </label>
                      <select
                        value={reconcileProductGroupId}
                        onChange={(e) => setReconcileProductGroupId(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="">ทุกกลุ่มสินค้า</option>
                        {reportProductGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">
                        วันที่
                      </label>
                      <input
                        type="date"
                        value={reconcileDate}
                        onChange={(e) => setReconcileDate(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </Card>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-gray-600">
                    กลุ่มสินค้า: <span className="font-semibold text-gray-900">{selectedReconcileGroupName}</span>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={loadReconcileReport}
                    disabled={reconcileLoading}
                  >
                    {reconcileLoading ? 'กำลังโหลด...' : 'ค้นหาข้อมูล'}
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <Card>
                    <p className="text-sm text-gray-500">ซื้อจริงรวม</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {reconcileSummary.purchased_total.toLocaleString('th-TH', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2
                      })}
                    </p>
                  </Card>
                  <Card>
                    <p className="text-sm text-gray-500">รับจริงรวม</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {reconcileSummary.received_total.toLocaleString('th-TH', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2
                      })}
                    </p>
                  </Card>
                  <Card>
                    <p className="text-sm text-gray-500">ค้างรับรวม</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {reconcileSummary.pending_total.toLocaleString('th-TH', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2
                      })}
                    </p>
                  </Card>
                  <Card>
                    <p className="text-sm text-gray-500">สถานะสินค้า</p>
                    <p className="text-base font-semibold text-emerald-700">
                      ครบ {reconcileSummary.completed_count}
                    </p>
                    <p className="text-base font-semibold text-amber-700">
                      ขาด {reconcileSummary.shortage_count}
                    </p>
                    <p className="text-base font-semibold text-red-700">
                      เกิน {reconcileSummary.over_count}
                    </p>
                  </Card>
                </div>

                <Card>
                  {reconcileLoading ? (
                    <div className="py-6 text-center text-sm text-gray-500">กำลังโหลดข้อมูล...</div>
                  ) : reconcileRows.length === 0 ? (
                    <div className="py-6 text-center text-sm text-gray-500">ไม่พบข้อมูลตามเงื่อนไข</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-gray-500">
                            <th className="py-2 pr-3 font-semibold">กลุ่มสินค้า</th>
                            <th className="py-2 pr-3 font-semibold">สินค้า</th>
                            <th className="py-2 pr-3 font-semibold text-right">สั่งซื้อ</th>
                            <th className="py-2 pr-3 font-semibold text-right">ซื้อจริง</th>
                            <th className="py-2 pr-3 font-semibold text-right">รับจริง</th>
                            <th className="py-2 pr-3 font-semibold text-right">ค้างรับ</th>
                            <th className="py-2 font-semibold text-center">สถานะ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reconcileRows.map((row) => {
                            const purchased = Number(row.purchased_quantity || 0);
                            const received = Number(row.received_quantity || 0);
                            const pending = purchased - received;
                            const unit = row.unit_abbr ? ` ${row.unit_abbr}` : '';
                            const isComplete = Math.abs(pending) < 0.000001;
                            const isShortage = pending > 0;
                            const statusText = isComplete ? 'ครบ' : isShortage ? 'ขาด' : 'เกิน';
                            const statusClass = isComplete
                              ? 'bg-emerald-50 text-emerald-700'
                              : isShortage
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-700';

                            return (
                              <tr
                                key={`${row.product_group_id || 'none'}-${row.product_id}`}
                                className="border-b last:border-b-0"
                              >
                                <td className="py-2 pr-3">{row.product_group_name || '-'}</td>
                                <td className="py-2 pr-3">{row.product_name || '-'}</td>
                                <td className="py-2 pr-3 text-right">
                                  {Number(row.ordered_quantity || 0).toLocaleString('th-TH', {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 2
                                  })}
                                  {unit}
                                </td>
                                <td className="py-2 pr-3 text-right">
                                  {purchased.toLocaleString('th-TH', {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 2
                                  })}
                                  {unit}
                                </td>
                                <td className="py-2 pr-3 text-right">
                                  {received.toLocaleString('th-TH', {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 2
                                  })}
                                  {unit}
                                </td>
                                <td className="py-2 pr-3 text-right font-semibold">
                                  {pending.toLocaleString('th-TH', {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 2
                                  })}
                                  {unit}
                                </td>
                                <td className="py-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => openReconcileDetail(row)}
                                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${statusClass} hover:opacity-80`}
                                    title="คลิกเพื่อดูรายละเอียด"
                                  >
                                    {statusText}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={receivingDetailModal.open}
        onClose={() =>
          setReceivingDetailModal({ open: false, row: null, items: [], loading: false })
        }
        title={
          receivingDetailModal.row
            ? `รายการสินค้า: ${receivingDetailModal.row.product_group_name || '-'} — ${receivingDetailModal.row.branch_name || '-'}${receivingDetailModal.row.department_name ? ` / ${receivingDetailModal.row.department_name}` : ''}`
            : 'รายการสินค้า'
        }
        size="large"
      >
        <div className="space-y-3">
          {receivingDetailModal.loading ? (
            <div className="py-6 text-center text-sm text-gray-500">กำลังโหลดรายละเอียด...</div>
          ) : receivingDetailModal.items.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-500">ไม่พบรายการสินค้า</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-3 font-semibold">สินค้า</th>
                      <th className="py-2 pr-3 font-semibold text-right">สั่ง</th>
                      <th className="py-2 pr-3 font-semibold text-right">รับจริง</th>
                      <th className="py-2 pr-3 font-semibold text-right">ค้างรับ</th>
                      <th className="py-2 pr-3 font-semibold text-right">ราคา/หน่วย (บาท)</th>
                      <th className="py-2 font-semibold text-right">ราคารวม (บาท)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receivingDetailModal.items.map((item) => {
                      const ordered = Number(item.ordered_quantity || 0);
                      const received = Number(item.received_quantity || 0);
                      const pending = ordered - received;
                      const unitLabel = item.unit_abbr ? ` ${item.unit_abbr}` : '';
                      const unitPrice = item.unit_price !== null && item.unit_price !== undefined
                        ? Number(item.unit_price)
                        : null;
                      const total = Number(item.received_amount || 0);
                      const pendingColor = pending > 0
                        ? 'text-amber-600 font-semibold'
                        : pending < 0
                          ? 'text-red-600 font-semibold'
                          : 'text-emerald-600';
                      return (
                        <tr key={item.product_id} className="border-b last:border-b-0">
                          <td className="py-2 pr-3">
                            <span className="font-medium text-gray-900">{item.product_name || '-'}</span>
                          </td>
                          <td className="py-2 pr-3 text-right text-gray-700">
                            {ordered.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}{unitLabel}
                          </td>
                          <td className="py-2 pr-3 text-right text-gray-700">
                            {received.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}{unitLabel}
                          </td>
                          <td className={`py-2 pr-3 text-right ${pendingColor}`}>
                            {pending.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}{unitLabel}
                          </td>
                          <td className="py-2 pr-3 text-right text-gray-700">
                            {unitPrice !== null ? `฿${formatMoney(unitPrice)}` : '-'}
                          </td>
                          <td className="py-2 text-right font-semibold text-gray-900">
                            {total > 0 ? `฿${formatMoney(total)}` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="pt-3 pr-3 font-semibold text-gray-900">รวมทั้งหมด</td>
                      <td className="pt-3 text-right font-bold text-gray-900">
                        ฿{formatMoney(
                          receivingDetailModal.items.reduce((sum, item) => sum + Number(item.received_amount || 0), 0)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={reconcileDetailModal.open}
        onClose={() =>
          setReconcileDetailModal({ open: false, row: null, items: [], loading: false })
        }
        title={
          reconcileDetailModal.row
            ? `รายละเอียด: ${reconcileDetailModal.row.product_name || '-'}`
            : 'รายละเอียด'
        }
        size="large"
      >
        <div className="space-y-3">
          {reconcileDetailModal.row && (
            <div className="text-sm text-gray-600">
              วันที่ {formatThaiDate(reconcileDate)} • กลุ่ม {reconcileDetailModal.row.product_group_name || '-'}
            </div>
          )}
          {reconcileDetailModal.loading ? (
            <div className="py-6 text-center text-sm text-gray-500">กำลังโหลดรายละเอียด...</div>
          ) : reconcileDetailModal.items.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-500">ไม่พบรายละเอียด</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-2 pr-3 font-semibold">สาขา/แผนก</th>
                    <th className="py-2 pr-3 font-semibold">เลขที่ออเดอร์</th>
                    <th className="py-2 pr-3 font-semibold text-right">สั่ง</th>
                    <th className="py-2 pr-3 font-semibold text-right">ซื้อจริง</th>
                    <th className="py-2 pr-3 font-semibold text-right">รับจริง</th>
                    <th className="py-2 font-semibold">รับเมื่อ</th>
                  </tr>
                </thead>
                <tbody>
                  {reconcileDetailModal.items.map((item) => (
                    <tr key={item.order_item_id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3">
                        {item.branch_name || '-'} / {item.department_name || '-'}
                      </td>
                      <td className="py-2 pr-3">{item.order_number || '-'}</td>
                      <td className="py-2 pr-3 text-right">
                        {Number(item.quantity || 0).toLocaleString('th-TH', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2
                        })}{' '}
                        {item.unit_abbr || ''}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {Number(item.purchased_quantity || 0).toLocaleString('th-TH', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2
                        })}{' '}
                        {item.unit_abbr || ''}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {Number(item.received_quantity || 0).toLocaleString('th-TH', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2
                        })}{' '}
                        {item.unit_abbr || ''}
                      </td>
                      <td className="py-2">{formatThaiDateTime(item.received_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

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
              สาขา
            </label>
            <select
              value={manualModal.branchId}
              onChange={(e) =>
                setManualModal((prev) => ({ ...prev, branchId: e.target.value }))
              }
              className="w-full px-3 py-2 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- เลือกสาขา --</option>
              {manualBranchChoices.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
            {manualBranchChoices.length === 0 && (
              <p className="text-xs text-gray-500 mt-1">ไม่พบรายการสาขา</p>
            )}
          </div>
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
            <Button
              onClick={handleAddManualItem}
              disabled={!manualModal.branchId}
            >
              เพิ่มสินค้า
            </Button>
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
