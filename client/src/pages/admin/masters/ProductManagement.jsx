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
    barcode: '',
    qr_code: '',
    default_price: '',
    is_countable: '1',
    unit_id: '',
    supplier_id: '',
    supplier_ids: [],
    supplier_master_id: '',
    supplier_master_ids: [],
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

const FieldRow = ({ label, children }) => (
    <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
            {label}
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

const MultiCheckList = ({ options, selected, onToggle }) => (
    <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2 space-y-1">
        {options.map((opt) => {
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
    </div>
);

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
    const [isNew, setIsNew]           = useState(false);

    const [selectedProductIds, setSelectedProductIds] = useState(new Set());
    const [deletingSelected, setDeletingSelected]     = useState(false);
    const [downloadScope, setDownloadScope]           = useState('all');

    const fileInputRef = useRef(null);

    // ── Data loading ──────────────────────────────
    useEffect(() => { fetchMeta(); }, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchProducts(); }, [filterGroup]);

    const fetchProducts = async () => {
        try {
            const data = await productsAPI.getProducts({ supplierId: filterGroup || undefined });
            setProducts(data.data || []);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchMeta = async () => {
        try {
            const [u, s, sm] = await Promise.all([
                productsAPI.getUnits(),
                productsAPI.getProductGroups(),
                productsAPI.getSupplierMasters(),
            ]);
            setUnits(u.map((x) => ({
                value: x.id,
                label: `${x.name}${x.abbreviation ? ` (${x.abbreviation})` : ''}`,
                name: x.name,
                abbr: x.abbreviation,
            })));
            setSuppliers(s.map((x) => ({ value: x.id, label: x.name })));
            setSupplierMasters(sm.map((x) => ({ value: x.id, label: x.name })));
        } catch (e) {
            console.error(e);
        }
    };

    // ── Filtering ─────────────────────────────────
    const filteredProducts = useMemo(() => {
        const term = searchQuery.trim().toLowerCase();
        if (!term) return products;
        return products.filter((p) =>
            [p.name, p.code, p.barcode, p.qr_code, p.supplier_name,
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
            barcode: row.barcode || '',
            qr_code: row.qr_code || '',
            default_price: row.default_price,
            is_countable: Number(row.is_countable) === 0 ? '0' : '1',
            unit_id: unitOpt?.value || '',
            supplier_id: String(supplierOpt?.value || currentGroupId || ''),
            supplier_ids: groupIds,
            supplier_master_id: String(masterOpt?.value || row.supplier_master_id || ''),
            supplier_master_ids: masterIds,
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
                supplier_id: groupIds[0] || null,
                product_group_id: groupIds[0] || null,
                supplier_ids: groupIds,
                product_group_ids: groupIds,
                supplier_master_id: masterIds[0] || null,
                supplier_master_ids: masterIds,
            };
            if (selectedId && !isNew) {
                await productsAPI.updateProduct(selectedId, payload);
            } else {
                await productsAPI.createProduct(payload);
                closePanel();
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
        const hdrs = ['name','code','barcode','qr_code','default_price','is_countable','unit_id','supplier_id','supplier_ids','supplier_master_id','supplier_master_ids'];
        const rows = list.map((p) => [
            p.name, p.code, p.barcode??'', p.qr_code??'', p.default_price??'',
            Number(p.is_countable)===0?0:1, p.unit_id??'', p.supplier_id??'',
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
                name: r.name, code: r.code, barcode: r.barcode||null, qr_code: r.qr_code||null,
                default_price: r.default_price ? Number(r.default_price) : null,
                is_countable: ['0',0,false,'false'].includes(r.is_countable) ? 0 : 1,
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

    // ── Render ────────────────────────────────────
    return (
        <Layout mainClassName="!max-w-none !px-3 md:!px-4 !py-3">
            <div className="flex flex-col h-[calc(100vh-5rem)]">

                {/* ── Top bar ──────────────────────────────── */}
                <div className="flex-none mb-3 space-y-2">
                    <BackToSettings />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h1 className="text-xl font-bold text-gray-900">จัดการสินค้า</h1>
                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                value={downloadScope}
                                onChange={(e) => setDownloadScope(e.target.value)}
                                className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-700"
                            >
                                <option value="all">ดาวน์โหลดทั้งหมด</option>
                                <option value="supplier">ดาวน์โหลดเฉพาะกลุ่มที่เลือก</option>
                            </select>
                            <button onClick={handleDownloadData} className="px-3 py-1.5 border rounded-lg text-xs hover:bg-gray-50">ดาวน์โหลดข้อมูล</button>
                            <button onClick={handleDownloadIdMap} className="px-3 py-1.5 border rounded-lg text-xs hover:bg-gray-50">ดาวน์โหลด ID</button>
                            <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 border rounded-lg text-xs hover:bg-gray-50">นำเข้า CSV</button>
                            <button onClick={openNew} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                                + เพิ่มสินค้า
                            </button>
                        </div>
                    </div>

                    {/* Filters row */}
                    <div className="flex flex-wrap gap-2">
                        <select
                            value={filterGroup}
                            onChange={(e) => setFilterGroup(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 min-w-[160px]"
                        >
                            <option value="">ทุกกลุ่มสินค้า</option>
                            {suppliers.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="ค้นหา ชื่อ / รหัส / บาร์โค้ด / หน่วย..."
                            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                    </div>

                    {/* Bulk action bar */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
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
                        <span className="text-gray-400">
                            แสดง {filteredProducts.length} / {products.length} รายการ
                        </span>
                    </div>
                </div>

                {/* ── Body ─────────────────────────────────── */}
                <div className="flex-1 min-h-0 flex gap-3">

                    {/* LEFT: list */}
                    <div className={`flex flex-col min-h-0 transition-all duration-200 ${panelOpen ? 'w-full md:w-[40%] lg:w-[36%]' : 'flex-1'}`}>
                        <div className="flex-1 overflow-y-auto rounded-xl border border-gray-200 bg-white">
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
                                        <th className="px-3 py-2.5">ชื่อสินค้า</th>
                                        {!panelOpen && <th className="px-3 py-2.5">รหัส</th>}
                                        {!panelOpen && <th className="px-3 py-2.5">กลุ่มสินค้า</th>}
                                        <th className="px-3 py-2.5">หน่วย</th>
                                        {!panelOpen && <th className="px-3 py-2.5">ราคา</th>}
                                        {!panelOpen && <th className="px-3 py-2.5">สต็อก</th>}
                                        <th className="px-3 py-2.5 w-12 text-center">ลบ</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredProducts.length === 0 && (
                                        <tr>
                                            <td colSpan={8} className="text-center py-12 text-gray-400">ไม่พบสินค้า</td>
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
                                                        {product.default_price != null ? `฿${Number(product.default_price).toLocaleString()}` : '-'}
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
                    </div>

                    {/* RIGHT: detail panel */}
                    {panelOpen && (
                        <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden">

                            {/* Panel header */}
                            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50 flex-none">
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

                            {/* Scrollable form */}
                            <div className="flex-1 overflow-y-auto px-5 py-4">
                                <form onSubmit={handleSave} id="product-form" className="space-y-4">

                                    <div className="grid grid-cols-2 gap-3">
                                        <FieldRow label="ชื่อสินค้า *">
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

                                    <div className="grid grid-cols-2 gap-3">
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

                                    <div className="grid grid-cols-2 gap-3">
                                        <FieldRow label="ราคาตั้งต้น (บาท) *">
                                            <TextInput
                                                type="number"
                                                step="0.01"
                                                value={formData.default_price}
                                                onChange={(e) => setFormData({ ...formData, default_price: e.target.value })}
                                                required
                                            />
                                        </FieldRow>
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
                                    </div>

                                    <FieldRow label="หน่วยนับ *">
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

                                    <FieldRow label={`กลุ่มสินค้า * — เลือกแล้ว ${formData.supplier_ids.length} กลุ่ม`}>
                                        <MultiCheckList
                                            options={suppliers}
                                            selected={formData.supplier_ids}
                                            onToggle={(v) => toggleMulti('supplier_ids', v)}
                                        />
                                    </FieldRow>

                                    <FieldRow label={`ซัพพลายเออร์ — เลือกแล้ว ${formData.supplier_master_ids.length}`}>
                                        <MultiCheckList
                                            options={supplierMasters}
                                            selected={formData.supplier_master_ids}
                                            onToggle={(v) => toggleMulti('supplier_master_ids', v)}
                                        />
                                        <p className="text-xs text-gray-400 mt-1">ไม่บังคับ — ใช้เชื่อมกับใบสั่งซื้อซัพนอก</p>
                                    </FieldRow>

                                </form>
                            </div>

                            {/* Panel footer */}
                            <div className="flex-none border-t border-gray-100 px-5 py-3 flex items-center justify-between bg-white">
                                {!isNew && selectedId ? (
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(products.find((p) => p.id === selectedId) || {})}
                                        className="text-red-500 hover:text-red-700 text-sm font-medium"
                                    >
                                        ลบสินค้านี้
                                    </button>
                                ) : <span />}
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={closePanel}
                                        className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                                    >
                                        ยกเลิก
                                    </button>
                                    <button
                                        type="submit"
                                        form="product-form"
                                        disabled={saving}
                                        className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        {saving ? 'กำลังบันทึก...' : isNew ? 'สร้างสินค้า' : 'บันทึกการแก้ไข'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
        </Layout>
    );
};
