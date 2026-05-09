import { useState, useEffect, useMemo, useRef } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { productsAPI } from '../../../api/products';
import { parseCsv, downloadCsv } from '../../../utils/csv';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const normalizeIdList = (value, fallbackValue = '') => {
    const source = Array.isArray(value)
        ? value
        : value === undefined || value === null || value === ''
        ? []
        : [value];
    const parsed = source.map(Number).filter(Number.isFinite);
    if (parsed.length > 0) return parsed.map(String);
    const fb = Number(fallbackValue);
    return Number.isFinite(fb) ? [String(fb)] : [];
};

const EMPTY_FORM = {
    name: '',
    code: '',
    supplier_item_id: '',
    barcode: '',
    qr_code: '',
    product_description: '',
    default_price: '',
    is_countable: '1',
    allow_pending_carryover: '0',
    unit_id: '',
    supplier_id: '',
    supplier_ids: [],
    supplier_master_id: '',
    supplier_master_ids: [],
    latest_price: null,
};

const formatPrice = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────
const Badge = ({ children, color = 'gray' }) => {
    const colors = {
        gray: 'bg-gray-100 text-gray-600',
        blue: 'bg-blue-100 text-blue-700',
        green: 'bg-green-100 text-green-700',
    };
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[color] || colors.gray}`}>
            {children}
        </span>
    );
};

const FieldRow = ({ label, children, required = false }) => (
    <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {children}
    </div>
);

const TextInput = ({ value, onChange, placeholder = '', type = 'text', step, required }) => (
    <input
        type={type}
        step={step}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
    />
);

const TextAreaInput = ({ value, onChange, placeholder = '', rows = 3 }) => (
    <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
    />
);

const MultiCheckList = ({ options, selected, onToggle, searchPlaceholder = 'ค้นหา...' }) => {
    const [query, setQuery] = useState('');

    const filteredOptions = useMemo(() => {
        const term = query.trim().toLowerCase();
        if (!term) return options;
        return options.filter((opt) =>
            String(opt.label || '').toLowerCase().includes(term)
        );
    }, [options, query]);

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <button
                    type="button"
                    onClick={() => setQuery((prev) => prev.trim())}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                    ค้นหา
                </button>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200 p-2 space-y-1">
                {filteredOptions.map((opt) => {
                    const checked = selected.includes(String(opt.value));
                    return (
                        <label
                            key={opt.value}
                            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer ${
                                checked
                                    ? 'bg-blue-50 border border-blue-300'
                                    : 'bg-white border border-gray-100 hover:bg-gray-50'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggle(opt.value)}
                                className="accent-blue-600"
                            />
                            <span className="truncate">{opt.label}</span>
                        </label>
                    );
                })}
                {filteredOptions.length === 0 && (
                    <p className="text-xs text-gray-400 px-1 py-2">ไม่พบรายการ</p>
                )}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────
// Mock data (ใช้เมื่อ backend ไม่ได้รัน)
// ─────────────────────────────────────────────
const MOCK_UNITS = [
    { id: 1, name: 'กิโลกรัม', abbreviation: 'กก.' },
    { id: 2, name: 'ชิ้น', abbreviation: 'ชิ้น' },
    { id: 3, name: 'แพ็ค', abbreviation: 'แพ็ค' },
    { id: 4, name: 'กล่อง', abbreviation: 'กล่อง' },
    { id: 5, name: 'ลัง', abbreviation: 'ลัง' },
    { id: 6, name: 'ถุง', abbreviation: 'ถุง' },
    { id: 7, name: 'ขวด', abbreviation: 'ขวด' },
    { id: 8, name: 'หัว', abbreviation: 'หัว' },
];

const MOCK_GROUPS = [
    { id: 1, name: 'ผัก' },
    { id: 2, name: 'ผลไม้' },
    { id: 3, name: 'เนื้อสัตว์' },
    { id: 4, name: 'อาหารทะเล' },
    { id: 5, name: 'เครื่องปรุง' },
    { id: 6, name: 'ของแห้ง' },
];

const MOCK_SUPPLIERS = [
    { id: 1, name: 'ซัพพลายเออร์ A (ผัก-ผลไม้)' },
    { id: 2, name: 'ซัพพลายเออร์ B (เนื้อสัตว์)' },
    { id: 3, name: 'ซัพพลายเออร์ C (อาหารทะเล)' },
];

const MOCK_PRODUCTS = [
    { id: 1, name: 'กะหล่ำปลี', code: 'VG001', unit_id: 1, unit_name: 'กิโลกรัม', unit_abbr: 'กก.', default_price: 18, last_actual_price: 20, is_countable: 1, allow_pending_carryover: 0, supplier_id: 1, product_group_ids: [1], supplier_ids: [1], product_group_names: 'ผัก', supplier_master_id: 1 },
    { id: 2, name: 'มะเขือเทศ', code: 'VG002', unit_id: 1, unit_name: 'กิโลกรัม', unit_abbr: 'กก.', default_price: 35, last_actual_price: 38, is_countable: 1, allow_pending_carryover: 0, supplier_id: 1, product_group_ids: [1], supplier_ids: [1], product_group_names: 'ผัก', supplier_master_id: 1 },
    { id: 3, name: 'หมูสามชั้น', code: 'MT001', unit_id: 1, unit_name: 'กิโลกรัม', unit_abbr: 'กก.', default_price: 160, last_actual_price: 165, is_countable: 1, allow_pending_carryover: 1, supplier_id: 3, product_group_ids: [3], supplier_ids: [3], product_group_names: 'เนื้อสัตว์', supplier_master_id: 2 },
    { id: 4, name: 'ไก่ทั้งตัว', code: 'MT002', unit_id: 1, unit_name: 'กิโลกรัม', unit_abbr: 'กก.', default_price: 65, last_actual_price: 68, is_countable: 1, allow_pending_carryover: 0, supplier_id: 3, product_group_ids: [3], supplier_ids: [3], product_group_names: 'เนื้อสัตว์', supplier_master_id: 2 },
    { id: 5, name: 'กุ้งขาว', code: 'SF001', unit_id: 1, unit_name: 'กิโลกรัม', unit_abbr: 'กก.', default_price: 220, last_actual_price: 230, is_countable: 1, allow_pending_carryover: 1, supplier_id: 4, product_group_ids: [4], supplier_ids: [4], product_group_names: 'อาหารทะเล', supplier_master_id: 3 },
    { id: 6, name: 'ปลาทู', code: 'SF002', unit_id: 2, unit_name: 'ชิ้น', unit_abbr: 'ชิ้น', default_price: 15, last_actual_price: 15, is_countable: 1, allow_pending_carryover: 0, supplier_id: 4, product_group_ids: [4], supplier_ids: [4], product_group_names: 'อาหารทะเล', supplier_master_id: 3 },
    { id: 7, name: 'น้ำปลา 700ml', code: 'SC001', unit_id: 7, unit_name: 'ขวด', unit_abbr: 'ขวด', default_price: 28, last_actual_price: 28, is_countable: 0, allow_pending_carryover: 0, supplier_id: 5, product_group_ids: [5], supplier_ids: [5], product_group_names: 'เครื่องปรุง', supplier_master_id: null },
    { id: 8, name: 'ซีอิ๊วขาว', code: 'SC002', unit_id: 7, unit_name: 'ขวด', unit_abbr: 'ขวด', default_price: 22, last_actual_price: 22, is_countable: 0, allow_pending_carryover: 0, supplier_id: 5, product_group_ids: [5], supplier_ids: [5], product_group_names: 'เครื่องปรุง', supplier_master_id: null },
    { id: 9, name: 'แป้งมันสำปะหลัง 1kg', code: 'DG001', unit_id: 3, unit_name: 'แพ็ค', unit_abbr: 'แพ็ค', default_price: 25, last_actual_price: 26, is_countable: 0, allow_pending_carryover: 0, supplier_id: 6, product_group_ids: [6], supplier_ids: [6], product_group_names: 'ของแห้ง', supplier_master_id: null },
    { id: 10, name: 'มะนาว', code: 'FR001', unit_id: 1, unit_name: 'กิโลกรัม', unit_abbr: 'กก.', default_price: 40, last_actual_price: 45, is_countable: 1, allow_pending_carryover: 0, supplier_id: 2, product_group_ids: [2], supplier_ids: [2], product_group_names: 'ผลไม้', supplier_master_id: 1 },
    { id: 11, name: 'ผักชี', code: 'VG003', unit_id: 6, unit_name: 'ถุง', unit_abbr: 'ถุง', default_price: 10, last_actual_price: 12, is_countable: 1, allow_pending_carryover: 0, supplier_id: 1, product_group_ids: [1], supplier_ids: [1], product_group_names: 'ผัก', supplier_master_id: 1 },
    { id: 12, name: 'หอมแดง', code: 'VG004', unit_id: 1, unit_name: 'กิโลกรัม', unit_abbr: 'กก.', default_price: 55, last_actual_price: 58, is_countable: 1, allow_pending_carryover: 0, supplier_id: 1, product_group_ids: [1], supplier_ids: [1], product_group_names: 'ผัก', supplier_master_id: 1 },
];

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export const ProductManagement = () => {
    const [products, setProducts]               = useState([]);
    const [units, setUnits]                     = useState([]);
    const [suppliers, setSuppliers]             = useState([]);
    const [supplierMasters, setSupplierMasters] = useState([]);

    const [searchQuery, setSearchQuery] = useState('');
    const [filterGroup, setFilterGroup] = useState('');

    const [selectedId, setSelectedId] = useState(null);
    const [formData, setFormData]     = useState(EMPTY_FORM);
    const [unitQuery, setUnitQuery]   = useState('');
    const [saving, setSaving]         = useState(false);
    const [forcingLatestPrice, setForcingLatestPrice] = useState(false);
    const [isNew, setIsNew]           = useState(false);

    const [selectedProductIds, setSelectedProductIds] = useState(new Set());
    const [deletingSelected, setDeletingSelected]     = useState(false);
    const [downloadScope, setDownloadScope]           = useState('all');
    const [saveNotice, setSaveNotice]                 = useState('');

    const fileInputRef = useRef(null);
    const saveNoticeTimerRef = useRef(null);

    // ── Data loading ──────────────────────────────
    useEffect(() => { fetchMeta(); }, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchProducts(); }, [filterGroup]);
    useEffect(() => () => {
        if (saveNoticeTimerRef.current) {
            window.clearTimeout(saveNoticeTimerRef.current);
        }
    }, []);

    const showSaveNotice = (text) => {
        setSaveNotice(text);
        if (saveNoticeTimerRef.current) {
            window.clearTimeout(saveNoticeTimerRef.current);
        }
        saveNoticeTimerRef.current = window.setTimeout(() => {
            setSaveNotice('');
        }, 1800);
    };

    const fetchProducts = async () => {
        try {
            const data = await productsAPI.getProducts({ supplierId: filterGroup || undefined });
            const list = data.data || data || [];
            if (list.length === 0 && !filterGroup) throw new Error('empty');
            setProducts(filterGroup
                ? list.filter((p) => (p.product_group_ids || p.supplier_ids || []).includes(Number(filterGroup)) || String(p.supplier_id) === String(filterGroup))
                : list
            );
        } catch {
            const list = filterGroup
                ? MOCK_PRODUCTS.filter((p) => (p.product_group_ids || []).includes(Number(filterGroup)))
                : MOCK_PRODUCTS;
            setProducts(list);
        }
    };

    const fetchMeta = async () => {
        try {
            const [u, s, sm] = await Promise.all([
                productsAPI.getUnits(),
                productsAPI.getProductGroups(),
                productsAPI.getSupplierMasters(),
            ]);
            const unitList = Array.isArray(u) ? u : [];
            const groupList = Array.isArray(s) ? s : [];
            const masterList = Array.isArray(sm) ? sm : [];
            if (!unitList.length && !groupList.length) throw new Error('empty meta');
            setUnits(unitList.map((x) => ({
                value: x.id,
                label: `${x.name}${x.abbreviation ? ` (${x.abbreviation})` : ''}`,
                name: x.name,
                abbr: x.abbreviation,
            })));
            setSuppliers(groupList.map((x) => ({ value: x.id, label: x.name })));
            setSupplierMasters(masterList.map((x) => ({ value: x.id, label: x.name })));
        } catch {
            setUnits(MOCK_UNITS.map((x) => ({
                value: x.id,
                label: `${x.name}${x.abbreviation ? ` (${x.abbreviation})` : ''}`,
                name: x.name,
                abbr: x.abbreviation,
            })));
            setSuppliers(MOCK_GROUPS.map((x) => ({ value: x.id, label: x.name })));
            setSupplierMasters(MOCK_SUPPLIERS.map((x) => ({ value: x.id, label: x.name })));
        }
    };

    // ── Filtering ─────────────────────────────────
    const filteredProducts = useMemo(() => {
        const term = searchQuery.trim().toLowerCase();
        if (!term) return products;
        return products.filter((p) =>
            [p.name, p.code, p.supplier_item_id, p.product_description, p.barcode, p.qr_code, p.supplier_name,
             p.product_group_names, p.supplier_master_name, p.unit_abbr, p.unit_name]
                .some((v) => String(v || '').toLowerCase().includes(term))
        );
    }, [products, searchQuery]);

    // ── Selection ─────────────────────────────────
    const visibleIds  = useMemo(() => filteredProducts.map((p) => p.id), [filteredProducts]);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedProductIds.has(id));

    const toggleAll = () => setSelectedProductIds((prev) => {
        const next = new Set(prev);
        allSelected
            ? visibleIds.forEach((id) => next.delete(id))
            : visibleIds.forEach((id) => next.add(id));
        return next;
    });

    const toggleOne = (id) => setSelectedProductIds((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    // ── Form helpers ──────────────────────────────
    const toggleMulti = (field, value) => {
        const v = String(value);
        setFormData((prev) => {
            const list = Array.isArray(prev[field]) ? prev[field].map(String) : [];
            return { ...prev, [field]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] };
        });
    };

    const resolveUnit = (value) => {
        const t = value.trim();
        if (!t) { setFormData((p) => ({ ...p, unit_id: '' })); return; }
        const m = units.find((u) => u.label === t || u.name === t || (u.abbr && u.abbr === t));
        setFormData((p) => ({ ...p, unit_id: m?.value || '' }));
    };

    const openNew = () => {
        setFormData(EMPTY_FORM);
        setUnitQuery('');
        setSelectedId(null);
        setIsNew(true);
    };

    const openEdit = (row) => {
        const unitOpt = units.find((u) => String(u.value) === String(row.unit_id))
            || units.find((u) => u.label.includes(row.unit_name));
        const currentGroupId = row.product_group_id ?? row.supplier_id;
        const supplierOpt = suppliers.find((s) => String(s.value) === String(currentGroupId));
        const masterOpt   = supplierMasters.find((s) => String(s.value) === String(row.supplier_master_id));
        const groupIds    = normalizeIdList(row.product_group_ids ?? row.supplier_ids, currentGroupId);
        const masterIds   = normalizeIdList(row.supplier_master_ids, row.supplier_master_id);
        setFormData({
            name: row.name,
            code: row.code,
            supplier_item_id: row.supplier_item_id || '',
            barcode: row.barcode || '',
            qr_code: row.qr_code || '',
            product_description: row.product_description || '',
            default_price: row.default_price,
            is_countable: Number(row.is_countable) === 0 ? '0' : '1',
            allow_pending_carryover: Number(row.allow_pending_carryover) === 1 ? '1' : '0',
            unit_id: unitOpt?.value || '',
            supplier_id: String(supplierOpt?.value || currentGroupId || ''),
            supplier_ids: groupIds,
            supplier_master_id: String(masterOpt?.value || row.supplier_master_id || ''),
            supplier_master_ids: masterIds,
            latest_price: row.last_actual_price ?? null,
        });
        setUnitQuery(unitOpt?.label || row.unit_name || '');
        setSelectedId(row.id);
        setIsNew(false);
    };

    const closePanel = () => { setSelectedId(null); setIsNew(false); };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.unit_id) { alert('กรุณาเลือกหน่วยนับจากรายการ'); return; }
        if (!formData.supplier_ids.length) { alert('กรุณาเลือกกลุ่มสินค้า'); return; }
        setSaving(true);
        try {
            const groupIds  = formData.supplier_ids.map(Number).filter(Number.isFinite);
            const masterIds = (formData.supplier_master_ids || []).map(Number).filter(Number.isFinite);
            const payload = {
                ...formData,
                supplier_item_id: formData.supplier_item_id || null,
                product_description: formData.product_description || null,
                allow_pending_carryover:
                    String(formData.allow_pending_carryover) === '1' ? 1 : 0,
                supplier_id: groupIds[0] || null,
                product_group_id: groupIds[0] || null,
                supplier_ids: groupIds,
                product_group_ids: groupIds,
                supplier_master_id: masterIds[0] || null,
                supplier_master_ids: masterIds,
            };
            if (selectedId && !isNew) {
                await productsAPI.updateProduct(selectedId, payload);
                showSaveNotice('บันทึกการแก้ไขสำเร็จแล้ว');
            } else {
                await productsAPI.createProduct(payload);
                closePanel();
                showSaveNotice('เพิ่มสินค้าสำเร็จแล้ว');
            }
            await fetchProducts();
        } catch {
            alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (row) => {
        if (!row?.id) return;
        if (!confirm(`ลบสินค้า "${row.name}" ใช่หรือไม่?`)) return;
        try {
            await productsAPI.deleteProduct(row.id);
            if (selectedId === row.id) closePanel();
            setSelectedProductIds((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
            fetchProducts();
        } catch {
            alert('เกิดข้อผิดพลาดในการลบข้อมูล');
        }
    };

    const handleForceLatestPriceFromDefault = async () => {
        if (!selectedId || isNew) return;
        const defaultPrice = Number(formData.default_price);
        const productName = selectedProduct?.name || `ID ${selectedId}`;
        if (!Number.isFinite(defaultPrice) || defaultPrice <= 0) {
            alert('กรุณาตั้งราคาตั้งต้นให้มากกว่า 0 ก่อน');
            return;
        }
        if (!confirm(`บังคับใช้ราคาตั้งต้นเป็นราคาล่าสุดของสินค้า "${productName}" ใช่หรือไม่?`)) return;
        setForcingLatestPrice(true);
        try {
            const response = await productsAPI.forceLatestPriceFromDefault(selectedId);
            const latestValue = response?.data?.last_actual_price ?? defaultPrice;
            setFormData((prev) => ({ ...prev, latest_price: latestValue }));
            await fetchProducts();
            showSaveNotice('บังคับใช้ราคาตั้งต้นเป็นราคาล่าสุดแล้ว');
        } catch (error) {
            const message = error?.response?.data?.message || 'ไม่สามารถบังคับใช้ราคาล่าสุดได้';
            alert(message);
        } finally {
            setForcingLatestPrice(false);
        }
    };

    const handleDeleteSelected = async () => {
        if (!selectedProductIds.size) { alert('กรุณาเลือกรายการก่อน'); return; }
        if (!confirm(`ลบสินค้าที่เลือก ${selectedProductIds.size} รายการ?`)) return;
        setDeletingSelected(true);
        try {
            const rows = products.filter((p) => selectedProductIds.has(p.id));
            const results = await Promise.allSettled(rows.map((p) => productsAPI.deleteProduct(p.id)));
            const ok = results.filter((r) => r.status === 'fulfilled').length;
            await fetchProducts();
            if (selectedId && selectedProductIds.has(selectedId)) closePanel();
            setSelectedProductIds(new Set());
            alert(`ลบสำเร็จ ${ok} รายการ` + (results.length - ok ? `, ล้มเหลว ${results.length - ok} รายการ` : ''));
        } finally {
            setDeletingSelected(false);
        }
    };

    // ── CSV ───────────────────────────────────────
    const resolveDownloadList = async () => {
        if (downloadScope === 'supplier') {
            if (!filterGroup) { alert('กรุณาเลือกกลุ่มสินค้าก่อน'); return null; }
            return products;
        }
        const res = await productsAPI.getProducts();
        return res.data || res || [];
    };

    const handleDownloadData = async () => {
        const list = await resolveDownloadList();
        if (!list) return;
        const hdrs = ['name','code','supplier_item_id','barcode','qr_code','product_description','default_price','is_countable','allow_pending_carryover','unit_id','supplier_id','supplier_ids','supplier_master_id','supplier_master_ids'];
        const rows = list.map((p) => [
            p.name, p.code, p.supplier_item_id??'', p.barcode??'', p.qr_code??'', p.product_description??'', p.default_price??'',
            Number(p.is_countable)===0?0:1, Number(p.allow_pending_carryover)===1?1:0, p.unit_id??'', p.supplier_id??'',
            (p.product_group_ids||p.supplier_ids||[]).join('|'),
            p.supplier_master_id??'', (p.supplier_master_ids||[]).join('|'),
        ]);
        downloadCsv('products_data.csv', hdrs, rows);
    };

    const handleDownloadIdMap = async () => {
        const list = await resolveDownloadList();
        if (!list) return;
        const hdrs = ['product_id','product_name','product_code','unit_id','unit_name','unit_abbr'];
        const rows = list.map((p) => [p.id??'',p.name??'',p.code??'',p.unit_id??'',p.unit_name??'',p.unit_abbr??'']);
        downloadCsv('products_id_map.csv', hdrs, rows);
    };

    const handleImportFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const { rows } = parseCsv(await file.text());
            const payloads = rows.filter((r) => r.name && r.unit_id).map((r) => ({
                name: r.name, code: r.code, supplier_item_id: r.supplier_item_id || null,
                barcode: r.barcode||null, qr_code: r.qr_code||null, product_description: r.product_description || null,
                default_price: r.default_price ? Number(r.default_price) : null,
                is_countable: ['0',0,false,'false'].includes(r.is_countable) ? 0 : 1,
                allow_pending_carryover: ['1',1,true,'true'].includes(r.allow_pending_carryover) ? 1 : 0,
                unit_id: Number(r.unit_id),
                supplier_id: r.supplier_id ? Number(r.supplier_id) : null,
                supplier_ids: normalizeIdList(r.supplier_ids, r.supplier_id).map(Number),
                supplier_master_id: r.supplier_master_id ? Number(r.supplier_master_id) : null,
                supplier_master_ids: normalizeIdList(r.supplier_master_ids, r.supplier_master_id).map(Number),
            }));
            if (!payloads.length) { alert('ไม่พบข้อมูลที่นำเข้าได้'); return; }
            const results = await Promise.allSettled(payloads.map((p) => productsAPI.createProduct(p)));
            const ok = results.filter((r) => r.status === 'fulfilled').length;
            fetchProducts();
            alert(`นำเข้าเสร็จ สำเร็จ ${ok}/${results.length} รายการ`);
        } catch {
            alert('นำเข้าไม่สำเร็จ');
        }
    };

    const panelOpen = selectedId !== null || isNew;
    const selectedProduct = useMemo(
        () => products.find((p) => p.id === selectedId) || null,
        [products, selectedId]
    );
    const tableColSpan = panelOpen ? 5 : 10;

    const renderEditorPanel = ({ mobile = false } = {}) => (
        <div className={`flex-1 min-h-0 flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden ${mobile ? 'h-full' : ''}`}>
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex-none space-y-2">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="font-semibold text-gray-800 text-sm">
                            {isNew ? '✦ เพิ่มสินค้าใหม่' : 'แก้ไขสินค้า'}
                        </h2>
                        {!isNew && selectedId && (
                            <p className="text-xs text-gray-400 font-mono">ID: {selectedId}</p>
                        )}
                    </div>
                    <button
                        onClick={closePanel}
                        className="text-gray-400 hover:text-gray-700 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors text-lg"
                    >
                        ✕
                    </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                    {!isNew && selectedId ? (
                        <button
                            type="button"
                            onClick={() => handleDelete(selectedProduct || {})}
                            className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50"
                        >
                            ลบสินค้านี้
                        </button>
                    ) : (
                        <span />
                    )}
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            type="button"
                            onClick={closePanel}
                            className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100"
                        >
                            ยกเลิก
                        </button>
                        <button
                            type="submit"
                            form="product-form"
                            disabled={saving}
                            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                        >
                            {saving ? 'กำลังบันทึก...' : isNew ? 'สร้างสินค้า' : 'บันทึกการแก้ไข'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
                <form onSubmit={handleSave} id="product-form" className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FieldRow label="ชื่อสินค้า" required>
                            <TextInput
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </FieldRow>
                        <FieldRow label="รหัสสินค้า">
                            <TextInput
                                value={formData.code}
                                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                                placeholder="ระบบกำหนดให้อัตโนมัติ"
                            />
                        </FieldRow>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FieldRow label="ID ซัพพลายเออร์">
                            <TextInput
                                value={formData.supplier_item_id}
                                onChange={(e) => setFormData({ ...formData, supplier_item_id: e.target.value })}
                                placeholder="ใส่หรือไม่ใส่ก็ได้"
                            />
                        </FieldRow>
                        <FieldRow label="รายละเอียดสินค้า">
                            <TextAreaInput
                                value={formData.product_description}
                                onChange={(e) => setFormData({ ...formData, product_description: e.target.value })}
                                placeholder="รายละเอียดเพิ่มเติมของสินค้า"
                                rows={2}
                            />
                        </FieldRow>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FieldRow label="บาร์โค้ด">
                            <TextInput
                                value={formData.barcode}
                                onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                                placeholder="เช่น 8851234567890"
                            />
                        </FieldRow>
                        <FieldRow label="รหัส QR">
                            <TextInput
                                value={formData.qr_code}
                                onChange={(e) => setFormData({ ...formData, qr_code: e.target.value })}
                                placeholder="ข้อความ/รหัสจาก QR"
                            />
                        </FieldRow>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FieldRow label="ราคาตั้งต้น (บาท)" required>
                            <TextInput
                                type="number"
                                step="0.01"
                                value={formData.default_price}
                                onChange={(e) => setFormData({ ...formData, default_price: e.target.value })}
                                required
                            />
                            <div className="mt-2">
                                <button
                                    type="button"
                                    onClick={handleForceLatestPriceFromDefault}
                                    disabled={isNew || !selectedId || forcingLatestPrice}
                                    className="px-3 py-2 rounded-lg bg-amber-100 text-amber-800 border border-amber-300 text-xs font-semibold hover:bg-amber-200 disabled:opacity-50"
                                >
                                    {forcingLatestPrice ? 'กำลังบังคับใช้...' : 'บังคับใช้ราคาตั้งต้นเป็นราคาล่าสุด (สินค้านี้)'}
                                </button>
                            </div>
                        </FieldRow>
                        <FieldRow label="ราคาล่าสุด (บาท)">
                            <input
                                type="text"
                                value={formatPrice(formData.latest_price)}
                                readOnly
                                className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700"
                            />
                            <p className="text-xs text-gray-400 mt-1">อ้างอิงจากราคาซื้อจริงล่าสุดในระบบเดินซื้อของ</p>
                        </FieldRow>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FieldRow label="การนับสต็อก">
                            <select
                                value={formData.is_countable}
                                onChange={(e) => setFormData({ ...formData, is_countable: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                                <option value="1">นับจำนวน</option>
                                <option value="0">ไม่นับจำนวน</option>
                            </select>
                        </FieldRow>
                        <FieldRow label="ค้างรับข้ามวัน">
                            <select
                                value={formData.allow_pending_carryover}
                                onChange={(e) => setFormData({ ...formData, allow_pending_carryover: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                                <option value="0">ปิด (ปิดยอดวันเดียว)</option>
                                <option value="1">เปิด (ค้างรับข้ามวันได้)</option>
                            </select>
                        </FieldRow>
                    </div>

                    <FieldRow label="หน่วยนับ" required>
                        <input
                            value={unitQuery}
                            onChange={(e) => {
                                setUnitQuery(e.target.value);
                                resolveUnit(e.target.value);
                            }}
                            onBlur={(e) => resolveUnit(e.target.value)}
                            placeholder="พิมพ์ชื่อหน่วย เช่น กก., ชิ้น..."
                            list="unit-options"
                            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                                formData.unit_id ? 'border-green-400 bg-green-50' : 'border-gray-300'
                            }`}
                        />
                        <datalist id="unit-options">
                            {units.map((u) => <option key={u.value} value={u.label} />)}
                        </datalist>
                        {formData.unit_id
                            ? <p className="text-xs text-green-600 mt-1">✓ ถูกต้อง (ID: {formData.unit_id})</p>
                            : unitQuery
                            ? <p className="text-xs text-red-500 mt-1">ไม่พบหน่วยนับนี้ในรายการ</p>
                            : null
                        }
                    </FieldRow>

                    <FieldRow
                        label={`กลุ่มสินค้า — เลือกแล้ว ${formData.supplier_ids.length} กลุ่ม`}
                        required
                    >
                        <MultiCheckList
                            options={suppliers}
                            selected={formData.supplier_ids}
                            onToggle={(v) => toggleMulti('supplier_ids', v)}
                            searchPlaceholder="ค้นหากลุ่มสินค้า..."
                        />
                    </FieldRow>

                    <FieldRow label={`ซัพพลายเออร์ — เลือกแล้ว ${formData.supplier_master_ids.length}`}>
                        <MultiCheckList
                            options={supplierMasters}
                            selected={formData.supplier_master_ids}
                            onToggle={(v) => toggleMulti('supplier_master_ids', v)}
                            searchPlaceholder="ค้นหาซัพพลายเออร์..."
                        />
                        <p className="text-xs text-gray-400 mt-1">ไม่บังคับ — ใช้เชื่อมกับใบสั่งซื้อซัพนอก</p>
                    </FieldRow>
                </form>
            </div>
        </div>
    );

    // ── Render ────────────────────────────────────
    return (
        <Layout mainClassName="!max-w-none !px-3 md:!px-4 !py-3">
            <div className="flex flex-col">
                {saveNotice && (
                    <div className="fixed top-4 right-4 z-[120] rounded-xl bg-emerald-600 text-white px-4 py-2 shadow-lg text-sm font-semibold">
                        ✓ {saveNotice}
                    </div>
                )}

                {/* ── Top bar ──────────────────────────────── */}
                <div className="mb-3 space-y-2">
                    <BackToSettings />
                    <div className="rounded-xl border border-gray-200 bg-white p-3 md:p-4 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h1 className="text-xl font-bold text-gray-900">จัดการสินค้า</h1>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    ค้นหาเร็ว เลือกหลายรายการ และแก้ไขข้อมูลในแผงด้านขวา
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="px-3 py-2 border rounded-lg text-xs hover:bg-gray-50"
                                >
                                    นำเข้า CSV
                                </button>
                                <button
                                    onClick={openNew}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                                >
                                    + เพิ่มสินค้า
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                                <p className="text-gray-500">ทั้งหมด</p>
                                <p className="text-base font-semibold text-gray-900">{products.length}</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                                <p className="text-gray-500">ที่แสดง</p>
                                <p className="text-base font-semibold text-gray-900">{filteredProducts.length}</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                                <p className="text-gray-500">เลือกแล้ว</p>
                                <p className="text-base font-semibold text-gray-900">{selectedProductIds.size}</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                                <p className="text-gray-500">โหมดแก้ไข</p>
                                <p className="text-base font-semibold text-gray-900">{panelOpen ? 'เปิด' : 'ปิด'}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                            <div className="flex gap-2">
                                <select
                                    value={filterGroup}
                                    onChange={(e) => setFilterGroup(e.target.value)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700"
                                >
                                    <option value="">ทุกกลุ่มสินค้า</option>
                                    {suppliers.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                                </select>
                                <select
                                    value={downloadScope}
                                    onChange={(e) => setDownloadScope(e.target.value)}
                                    className="border border-gray-300 rounded-lg px-2 py-2 text-xs text-gray-700"
                                >
                                    <option value="all">ดาวน์โหลดทั้งหมด</option>
                                    <option value="supplier">เฉพาะกลุ่มที่เลือก</option>
                                </select>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="ค้นหา ชื่อ / รหัส / บาร์โค้ด / หน่วย..."
                                    className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                                <button onClick={handleDownloadData} className="px-3 py-2 border rounded-lg text-xs hover:bg-gray-50 whitespace-nowrap">
                                    ดาวน์โหลดข้อมูล
                                </button>
                                <button onClick={handleDownloadIdMap} className="px-3 py-2 border rounded-lg text-xs hover:bg-gray-50 whitespace-nowrap">
                                    ดาวน์โหลด ID
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                            <div className="flex flex-wrap items-center gap-2">
                                <button onClick={toggleAll} className="px-2.5 py-1 border rounded-lg hover:bg-gray-50">
                                    {allSelected ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกทั้งหมดในหน้า'}
                                </button>
                                <button
                                    onClick={() => setSelectedProductIds(new Set())}
                                    disabled={!selectedProductIds.size}
                                    className="px-2.5 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-40"
                                >
                                    ล้าง
                                </button>
                                <button
                                    onClick={handleDeleteSelected}
                                    disabled={!selectedProductIds.size || deletingSelected}
                                    className="px-2.5 py-1 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-40"
                                >
                                    {deletingSelected ? 'กำลังลบ...' : `ลบที่เลือก (${selectedProductIds.size})`}
                                </button>
                            </div>
                            <span className="text-gray-400">
                                แสดง {filteredProducts.length} / {products.length} รายการ
                            </span>
                        </div>
                    </div>
                </div>

                {/* ── Body ─────────────────────────────────── */}
                <div className="flex flex-col md:flex-row gap-3">

                    {/* LEFT: list */}
                    <div className={`transition-all duration-200 ${panelOpen ? 'w-full md:w-[40%] lg:w-[36%]' : 'flex-1'}`}>
                        <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
                            <div className="hidden md:block">
                                <table className="w-full text-sm border-collapse">
                                    <thead className="sticky top-0 bg-gray-50 z-10 border-b border-gray-200">
                                        <tr className="text-left text-xs text-gray-500 font-semibold">
                                            <th className="px-3 py-2.5 w-8">
                                                <input
                                                    type="checkbox"
                                                    checked={allSelected}
                                                    onChange={toggleAll}
                                                    disabled={!visibleIds.length}
                                                />
                                            </th>
                                            <th className="px-3 py-2.5">ID</th>
                                            <th className="px-3 py-2.5">ชื่อสินค้า</th>
                                            {!panelOpen && <th className="px-3 py-2.5">รหัส</th>}
                                            {!panelOpen && <th className="px-3 py-2.5">กลุ่มสินค้า</th>}
                                            <th className="px-3 py-2.5">หน่วย</th>
                                            {!panelOpen && <th className="px-3 py-2.5">ราคาตั้งต้น</th>}
                                            {!panelOpen && <th className="px-3 py-2.5">ราคาล่าสุด</th>}
                                            {!panelOpen && <th className="px-3 py-2.5">สต็อก</th>}
                                            <th className="px-3 py-2.5 w-12 text-center">ลบ</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredProducts.length === 0 && (
                                            <tr>
                                                <td colSpan={tableColSpan} className="text-center py-12 text-gray-400">ไม่พบสินค้า</td>
                                            </tr>
                                        )}
                                        {filteredProducts.map((product) => {
                                            const active = selectedId === product.id;
                                            return (
                                                <tr
                                                    key={product.id}
                                                    onClick={() => openEdit(product)}
                                                    className={`border-b border-gray-100 cursor-pointer transition-colors ${
                                                        active
                                                            ? 'bg-blue-50 border-l-[3px] border-l-blue-500'
                                                            : 'hover:bg-gray-50 border-l-[3px] border-l-transparent'
                                                    }`}
                                                >
                                                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedProductIds.has(product.id)}
                                                            onChange={() => toggleOne(product.id)}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2.5 text-xs text-gray-500 font-mono whitespace-nowrap">
                                                        {product.id}
                                                    </td>
                                                    <td className="px-3 py-2.5 max-w-[180px]">
                                                        <p className="font-medium text-gray-900 truncate">{product.name}</p>
                                                        {panelOpen && (
                                                            <>
                                                                <p className="text-xs text-gray-400 truncate">{product.code || '-'}</p>
                                                                <p className="text-xs text-gray-400 truncate">{product.product_group_names || product.supplier_name || '-'}</p>
                                                            </>
                                                        )}
                                                    </td>
                                                    {!panelOpen && <td className="px-3 py-2.5 text-xs text-gray-500">{product.code || '-'}</td>}
                                                    {!panelOpen && (
                                                        <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[120px] truncate">
                                                            {product.product_group_names || product.supplier_name || '-'}
                                                        </td>
                                                    )}
                                                    <td className="px-3 py-2.5">
                                                        <Badge>{product.unit_abbr || product.unit_name || '-'}</Badge>
                                                    </td>
                                                    {!panelOpen && (
                                                        <td className="px-3 py-2.5 text-xs text-gray-600">
                                                            {formatPrice(product.default_price)}
                                                        </td>
                                                    )}
                                                    {!panelOpen && (
                                                        <td className="px-3 py-2.5 text-xs text-gray-600">
                                                            {formatPrice(product.last_actual_price)}
                                                        </td>
                                                    )}
                                                    {!panelOpen && (
                                                        <td className="px-3 py-2.5">
                                                            <Badge color={Number(product.is_countable) === 0 ? 'gray' : 'green'}>
                                                                {Number(product.is_countable) === 0 ? 'ไม่นับ' : 'นับ'}
                                                            </Badge>
                                                        </td>
                                                    )}
                                                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            onClick={() => handleDelete(product)}
                                                            className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50"
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

                            <div className="md:hidden p-2 space-y-2">
                                {filteredProducts.length === 0 && (
                                    <div className="text-center py-12 text-gray-400">ไม่พบสินค้า</div>
                                )}
                                {filteredProducts.map((product) => {
                                    const active = selectedId === product.id;
                                    return (
                                        <div
                                            key={product.id}
                                            onClick={() => openEdit(product)}
                                            className={`rounded-lg border p-3 ${active ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-sm text-gray-900 truncate">{product.name}</p>
                                                    <p className="text-xs text-gray-400 font-mono truncate">ID: {product.id}</p>
                                                    <p className="text-xs text-gray-500 truncate">{product.code || '-'}</p>
                                                    <p className="text-xs text-gray-500 truncate mt-0.5">{product.product_group_names || product.supplier_name || '-'}</p>
                                                </div>
                                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedProductIds.has(product.id)}
                                                        onChange={() => toggleOne(product.id)}
                                                    />
                                                </div>
                                            </div>
                                            <div className="mt-2 flex items-center justify-between">
                                                <div className="flex items-center gap-1.5">
                                                    <Badge>{product.unit_abbr || product.unit_name || '-'}</Badge>
                                                    <Badge color={Number(product.is_countable) === 0 ? 'gray' : 'green'}>
                                                        {Number(product.is_countable) === 0 ? 'ไม่นับ' : 'นับ'}
                                                    </Badge>
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDelete(product); }}
                                                    className="text-red-500 text-xs px-2 py-1 rounded border border-red-200"
                                                >
                                                    ลบ
                                                </button>
                                            </div>
                                            <p className="mt-1 text-xs text-gray-500">
                                                ตั้งต้น {formatPrice(product.default_price)} · ล่าสุด {formatPrice(product.last_actual_price)}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {panelOpen && (
                        <>
                            <div className="hidden md:flex flex-1 min-h-0">
                                {renderEditorPanel()}
                            </div>
                            <div className="md:hidden fixed inset-0 z-50 bg-black/40 p-2">
                                <div className="h-full">
                                    {renderEditorPanel({ mobile: true })}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
        </Layout>
    );
};
