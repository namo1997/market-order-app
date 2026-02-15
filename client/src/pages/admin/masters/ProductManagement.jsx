import { useState, useEffect, useMemo, useRef } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { Select } from '../../../components/common/Select';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { productsAPI } from '../../../api/products';
import { parseCsv, downloadCsv } from '../../../utils/csv';

export const ProductManagement = () => {
    const [products, setProducts] = useState([]);
    const [units, setUnits] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [supplierMasters, setSupplierMasters] = useState([]);
    const [selectedSupplierFilter, setSelectedSupplierFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        code: '',
        default_price: '',
        is_countable: '1',
        unit_id: '',
        supplier_id: '',
        supplier_master_id: ''
    });
    const [unitQuery, setUnitQuery] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [deletingSelected, setDeletingSelected] = useState(false);
    const [selectedProductIds, setSelectedProductIds] = useState(new Set());
    const fileInputRef = useRef(null);
    const [downloadScope, setDownloadScope] = useState('all');

    useEffect(() => {
        fetchMeta();
    }, []);

    useEffect(() => {
        fetchProducts();
    }, [selectedSupplierFilter]);

    const fetchProducts = async () => {
        try {
            const data = await productsAPI.getProducts({
                supplierId: selectedSupplierFilter || undefined
            });
            setProducts(data.data || []);
        } catch (error) {
            console.error('Error fetching products:', error);
        }
    };

    const fetchMeta = async () => {
        try {
            const [u, s, sm] = await Promise.all([
                productsAPI.getUnits(),
                productsAPI.getSuppliers(),
                productsAPI.getSupplierMasters()
            ]);
            setUnits(
                u.map((x) => ({
                    value: x.id,
                    label: `${x.name}${x.abbreviation ? ` (${x.abbreviation})` : ''}`,
                    name: x.name,
                    abbr: x.abbreviation
                }))
            );
            setSuppliers(s.map((x) => ({ value: x.id, label: x.name, name: x.name })));
            setSupplierMasters(
                sm.map((x) => ({
                    value: x.id,
                    label: x.name,
                    name: x.name
                }))
            );
        } catch (error) {
            console.error('Error fetching meta:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.unit_id) {
            alert('กรุณาเลือกหน่วยนับจากรายการ');
            return;
        }
        if (!formData.supplier_id) {
            alert('กรุณาเลือกกลุ่มสินค้าจากรายการ');
            return;
        }
        setLoading(true);
        try {
            if (selectedId) {
                await productsAPI.updateProduct(selectedId, formData);
            } else {
                await productsAPI.createProduct(formData);
            }
            setIsModalOpen(false);
            fetchProducts();
            resetForm();
        } catch (error) {
            console.error('Error saving product:', error);
            alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (row) => {
        if (confirm(`คุณต้องการลบสินค้า "${row.name}" ใช่หรือไม่?`)) {
            try {
                await productsAPI.deleteProduct(row.id);
                setSelectedProductIds((prev) => {
                    if (!prev.has(row.id)) return prev;
                    const next = new Set(prev);
                    next.delete(row.id);
                    return next;
                });
                fetchProducts();
            } catch (error) {
                console.error('Error deleting product:', error);
                alert('เกิดข้อผิดพลาดในการลบข้อมูล');
            }
        }
    };

    const openEdit = (row) => {
        const unitOption = units.find((u) => String(u.value) === String(row.unit_id))
            || units.find((u) => u.label.includes(row.unit_name));
        const currentGroupId = row.product_group_id ?? row.supplier_id;
        const supplierOption = suppliers.find((s) => String(s.value) === String(currentGroupId))
            || suppliers.find((s) => s.label === row.supplier_name);
        const supplierMasterOption = supplierMasters.find(
            (s) => String(s.value) === String(row.supplier_master_id)
        );

        setFormData({
            name: row.name,
            code: row.code,
            default_price: row.default_price,
            is_countable: Number(row.is_countable) === 0 ? '0' : '1',
            unit_id: unitOption?.value || '',
            supplier_id: String(supplierOption?.value || currentGroupId || ''),
            supplier_master_id: String(
                supplierMasterOption?.value || row.supplier_master_id || ''
            )
        });
        setUnitQuery(unitOption?.label || row.unit_name || '');
        setSelectedId(row.id);
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({
            name: '',
            code: '',
            default_price: '',
            is_countable: '1',
            unit_id: '',
            supplier_id: '',
            supplier_master_id: ''
        });
        setSelectedId(null);
        setUnitQuery('');
    };

    const resolveUnit = (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
            setFormData((prev) => ({ ...prev, unit_id: '' }));
            return;
        }
        const match = units.find(
            (u) =>
                u.label === trimmed ||
                u.name === trimmed ||
                (u.abbr && u.abbr === trimmed)
        );
        setFormData((prev) => ({ ...prev, unit_id: match?.value || '' }));
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const resolveDownloadProducts = async () => {
        if (downloadScope === 'supplier') {
            if (!selectedSupplierFilter) {
                alert('กรุณาเลือกกลุ่มสินค้าก่อนดาวน์โหลดแบบเฉพาะกลุ่ม');
                return null;
            }
            return products;
        }

        const response = await productsAPI.getProducts();
        return response.data || response || [];
    };

    const handleDownloadData = async () => {
        const list = await resolveDownloadProducts();
        if (!list) return;
        const headers = [
            'name',
            'code',
            'default_price',
            'is_countable',
            'unit_id',
            'supplier_id',
            'supplier_master_id'
        ];
        const rows = list.map((product) => [
            product.name,
            product.code,
            product.default_price ?? '',
            Number(product.is_countable) === 0 ? 0 : 1,
            product.unit_id ?? '',
            product.supplier_id ?? '',
            product.supplier_master_id ?? ''
        ]);
        downloadCsv('products_data.csv', headers, rows);
    };

    const handleDownloadIdMap = async () => {
        const list = await resolveDownloadProducts();
        if (!list) return;
        const headers = [
            'product_id',
            'product_name',
            'product_code',
            'unit_id',
            'unit_name',
            'unit_abbr'
        ];
        const rows = list.map((product) => [
            product.id ?? '',
            product.name ?? '',
            product.code ?? '',
            product.unit_id ?? '',
            product.unit_name ?? '',
            product.unit_abbr ?? ''
        ]);
        downloadCsv('products_id_map.csv', headers, rows);
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
                    name: row.name,
                    code: row.code,
                    default_price: row.default_price,
                    is_countable: row.is_countable,
                    unit_id: row.unit_id,
                    supplier_id: row.supplier_id,
                    supplier_master_id: row.supplier_master_id
                }))
                .filter((row) => row.name && row.unit_id);

            if (payloads.length === 0) {
                alert('ไม่พบข้อมูลที่นำเข้าได้');
                return;
            }

            const results = await Promise.allSettled(
                payloads.map((payload) =>
                    productsAPI.createProduct({
                        name: payload.name,
                        code: payload.code || undefined,
                        default_price: payload.default_price ? Number(payload.default_price) : null,
                        is_countable:
                            payload.is_countable === undefined ||
                            payload.is_countable === null ||
                            payload.is_countable === ''
                                ? 1
                                : (payload.is_countable === '0' ||
                                    payload.is_countable === 0 ||
                                    payload.is_countable === false ||
                                    payload.is_countable === 'false'
                                    ? 0
                                    : 1),
                        unit_id: Number(payload.unit_id),
                        supplier_id: payload.supplier_id ? Number(payload.supplier_id) : null,
                        supplier_master_id: payload.supplier_master_id
                            ? Number(payload.supplier_master_id)
                            : null
                    })
                )
            );
            const successCount = results.filter((r) => r.status === 'fulfilled').length;
            const failedCount = results.length - successCount;

            fetchProducts();
            alert(`นำเข้าเสร็จสิ้น สำเร็จ ${successCount} รายการ` + (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : ''));
        } catch (error) {
            console.error('Error importing products:', error);
            alert('นำเข้าไม่สำเร็จ');
        }
    };

    const filteredProducts = useMemo(() => {
        const term = searchQuery.trim().toLowerCase();
        if (!term) return products;
        return products.filter((product) => {
            const name = product.name || '';
            const code = product.code || '';
            const supplier = product.supplier_name || '';
            const supplierMaster = product.supplier_master_name || '';
            const unit = product.unit_abbr || product.unit_name || '';
            return (
                name.toLowerCase().includes(term) ||
                code.toLowerCase().includes(term) ||
                supplier.toLowerCase().includes(term) ||
                supplierMaster.toLowerCase().includes(term) ||
                unit.toLowerCase().includes(term)
            );
        });
    }, [products, searchQuery]);

    useEffect(() => {
        const validIds = new Set(products.map((product) => product.id));
        setSelectedProductIds((prev) => {
            let changed = false;
            const next = new Set();
            prev.forEach((id) => {
                if (validIds.has(id)) {
                    next.add(id);
                } else {
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [products]);

    const visibleProductIds = useMemo(
        () => filteredProducts.map((product) => product.id),
        [filteredProducts]
    );

    const selectedVisibleCount = useMemo(
        () => visibleProductIds.filter((id) => selectedProductIds.has(id)).length,
        [visibleProductIds, selectedProductIds]
    );

    const allVisibleSelected =
        visibleProductIds.length > 0 && selectedVisibleCount === visibleProductIds.length;

    const toggleSelectProduct = (productId) => {
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

    const toggleSelectAllVisible = () => {
        setSelectedProductIds((prev) => {
            const next = new Set(prev);
            if (allVisibleSelected) {
                visibleProductIds.forEach((id) => next.delete(id));
            } else {
                visibleProductIds.forEach((id) => next.add(id));
            }
            return next;
        });
    };

    const clearSelection = () => {
        setSelectedProductIds(new Set());
    };

    const handleDeleteSelected = async () => {
        if (selectedProductIds.size === 0) {
            alert('กรุณาเลือกรายการสินค้าก่อน');
            return;
        }

        const selectedRows = products.filter((product) => selectedProductIds.has(product.id));
        const confirmed = confirm(`ต้องการลบสินค้าที่เลือก ${selectedRows.length} รายการใช่หรือไม่?`);
        if (!confirmed) return;

        setDeletingSelected(true);
        try {
            const results = await Promise.allSettled(
                selectedRows.map((product) => productsAPI.deleteProduct(product.id))
            );
            const successCount = results.filter((result) => result.status === 'fulfilled').length;
            const failedCount = results.length - successCount;

            await fetchProducts();
            setSelectedProductIds(new Set());

            if (failedCount > 0) {
                alert(`ลบสำเร็จ ${successCount} รายการ, ไม่สำเร็จ ${failedCount} รายการ`);
            } else {
                alert(`ลบสำเร็จ ${successCount} รายการ`);
            }
        } catch (error) {
            console.error('Error deleting selected products:', error);
            alert('เกิดข้อผิดพลาดในการลบรายการที่เลือก');
        } finally {
            setDeletingSelected(false);
        }
    };

    const columns = [
        {
            header: (
                <div className="flex justify-center">
                    <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        disabled={visibleProductIds.length === 0}
                        aria-label="เลือกสินค้าทั้งหมดที่แสดง"
                    />
                </div>
            ),
            render: (row) => (
                <div className="flex justify-center">
                    <input
                        type="checkbox"
                        checked={selectedProductIds.has(row.id)}
                        onChange={() => toggleSelectProduct(row.id)}
                        aria-label={`เลือกสินค้า ${row.name}`}
                    />
                </div>
            )
        },
        { header: 'Product ID', accessor: 'id' },
        { header: 'รหัส', accessor: 'code' },
        { header: 'ชื่อสินค้า', accessor: 'name' },
        { header: 'ราคา', render: (row) => `${row.default_price} บาท` },
        { header: 'Unit ID', accessor: 'unit_id' },
        { header: 'หน่วย', render: (row) => row.unit_abbr || row.unit_name },
        {
            header: 'การนับสต็อก',
            render: (row) => (Number(row.is_countable) === 0 ? 'ไม่นับจำนวน' : 'นับจำนวน')
        },
        { header: 'กลุ่มสินค้า', accessor: 'supplier_name' },
        {
            header: 'ซัพพลายเออร์',
            render: (row) => row.supplier_master_name || '-'
        }
    ];

    return (
        <Layout mainClassName="!max-w-none">
            <div className="w-full">
                <div className="mb-3">
                    <BackToSettings />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">จัดการสินค้า</h1>
                    <div className="flex gap-2">
                        <Select
                            value={downloadScope}
                            onChange={(e) => setDownloadScope(e.target.value)}
                            options={[
                                { value: 'all', label: 'ดาวน์โหลดทั้งหมด' },
                                { value: 'supplier', label: 'ดาวน์โหลดเฉพาะกลุ่มที่เลือก' }
                            ]}
                        />
                        <button
                            onClick={handleDownloadData}
                            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                        >
                            ดาวน์โหลดข้อมูล
                        </button>
                        <button
                            onClick={handleDownloadIdMap}
                            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                        >
                            ดาวน์โหลด ID สินค้า/หน่วย
                        </button>
                        <button
                            onClick={handleImportClick}
                            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                        >
                            นำเข้า
                        </button>
                        <button
                            onClick={() => { resetForm(); setIsModalOpen(true); }}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                        >
                            เพิ่มสินค้า
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Select
                        label="มุมมองตามกลุ่มสินค้า"
                        options={[{ value: '', label: 'ทั้งหมด' }, ...suppliers]}
                        value={selectedSupplierFilter}
                        onChange={(e) => setSelectedSupplierFilter(e.target.value)}
                    />
                    <Input
                        label="ค้นหาสินค้า"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="ชื่อสินค้า / รหัส / กลุ่มสินค้า / ซัพพลายเออร์ / หน่วยนับ"
                    />
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={toggleSelectAllVisible}
                        disabled={visibleProductIds.length === 0}
                        className="px-3 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                        {allVisibleSelected ? 'ยกเลิกเลือกทั้งหมดในหน้าที่แสดง' : 'เลือกทั้งหมดในหน้าที่แสดง'}
                    </button>
                    <button
                        type="button"
                        onClick={clearSelection}
                        disabled={selectedProductIds.size === 0}
                        className="px-3 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                        ล้างที่เลือก
                    </button>
                    <button
                        type="button"
                        onClick={handleDeleteSelected}
                        disabled={selectedProductIds.size === 0 || deletingSelected}
                        className="px-3 py-2 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50"
                    >
                        {deletingSelected ? 'กำลังลบ...' : `ลบที่เลือก (${selectedProductIds.size})`}
                    </button>
                    <span className="text-sm text-gray-500">
                        เลือกแล้ว {selectedProductIds.size} รายการ
                    </span>
                    {searchQuery.trim() && (
                        <span className="text-sm text-gray-400">
                            (ในผลค้นหานี้เลือกแล้ว {selectedVisibleCount} รายการ)
                        </span>
                    )}
                </div>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleImportFile}
                />

                <DataTable
                    columns={columns}
                    data={filteredProducts}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                />

                <Modal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    title={selectedId ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}
                >
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="รหัสสินค้า"
                                value={formData.code}
                                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                                placeholder="เว้นว่างให้ระบบกำหนด"
                            />
                            <Input
                                label="ชื่อสินค้า"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="ราคาตั้งต้น"
                                type="number"
                                step="0.01"
                                value={formData.default_price}
                                onChange={(e) => setFormData({ ...formData, default_price: e.target.value })}
                                required
                            />
                            <Input
                                label="หน่วยนับ (พิมพ์เพื่อค้นหา)"
                                value={unitQuery}
                                onChange={(e) => {
                                    const next = e.target.value;
                                    setUnitQuery(next);
                                    resolveUnit(next);
                                }}
                                onBlur={(e) => resolveUnit(e.target.value)}
                                placeholder="พิมพ์ชื่อหน่วยนับ"
                                list="unit-options"
                                required
                            />
                            <Select
                                label="การนับสต็อก"
                                value={formData.is_countable}
                                onChange={(e) =>
                                    setFormData({ ...formData, is_countable: e.target.value })
                                }
                                options={[
                                    { value: '1', label: 'นับจำนวน' },
                                    { value: '0', label: 'ไม่นับจำนวน' }
                                ]}
                                required
                            />
                        </div>

                        <Select
                            label="กลุ่มสินค้า"
                            value={formData.supplier_id}
                            onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                            options={suppliers}
                            placeholder="เลือกกลุ่มสินค้า"
                            required
                        />

                        <Select
                            label="ซัพพลายเออร์ (ไม่บังคับ)"
                            value={formData.supplier_master_id}
                            onChange={(e) =>
                                setFormData({ ...formData, supplier_master_id: e.target.value })
                            }
                            options={supplierMasters}
                            placeholder="ไม่ระบุซัพพลายเออร์"
                        />

                        <datalist id="unit-options">
                            {units.map((unit) => (
                                <option key={unit.value} value={unit.label} />
                            ))}
                        </datalist>

                        <div className="flex justify-end space-x-2 mt-6">
                            <button
                                type="button"
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                            >
                                ยกเลิก
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
                            >
                                {loading ? 'กำลังบันทึก...' : 'บันทึก'}
                            </button>
                        </div>
                    </form>
                </Modal>
            </div>
        </Layout>
    );
};
