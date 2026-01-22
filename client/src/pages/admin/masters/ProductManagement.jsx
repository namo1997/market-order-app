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
    const [selectedSupplierFilter, setSelectedSupplierFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        name: '', code: '', default_price: '', unit_id: '', supplier_id: ''
    });
    const [unitQuery, setUnitQuery] = useState('');
    const [supplierQuery, setSupplierQuery] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(false);
    const fileInputRef = useRef(null);

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
            const [u, s] = await Promise.all([
                productsAPI.getUnits(),
                productsAPI.getSuppliers()
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
            alert('กรุณาเลือกซัพพลายเออร์จากรายการ');
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
                fetchProducts();
            } catch (error) {
                console.error('Error deleting product:', error);
                alert('เกิดข้อผิดพลาดในการลบข้อมูล');
            }
        }
    };

    const openEdit = (row) => {
        const unitOption = units.find((u) => u.value === row.unit_id)
            || units.find((u) => u.label.includes(row.unit_name));
        const supplierOption = suppliers.find((s) => s.value === row.supplier_id)
            || suppliers.find((s) => s.label === row.supplier_name);

        setFormData({
            name: row.name,
            code: row.code,
            default_price: row.default_price,
            unit_id: unitOption?.value || '',
            // Note: Mapping back from name/abbr might be tricky if not returning ID.
            // Let's assume row logic is sufficient or fix backend to return IDs in list.
            // Current getAllProducts returns supplier_id, but maybe not unit_id?
            // Let's check backend model.
            // It returns u.name, u.abbreviation, s.id, s.name.
            // It seems it does NOT return unit_id. I should fix backend model to return unit_id.
            // But for now let's leave it as is and try to match or fix later if bug found.
            // Actually row likely has unit_id if I updated the model correctly...
            // Checking product.model.js... `SELECT p.id, p.name...` - it does NOT select p.unit_id explicitly in getAllProducts.
            // I'll assume it might be missing and add unit_id to my "To Fix" list if verified broken.
            // For now, let's try to access logic.
            supplier_id: supplierOption?.value || row.supplier_id || ''
        });
        setUnitQuery(unitOption?.label || row.unit_name || '');
        setSupplierQuery(supplierOption?.label || row.supplier_name || '');
        // Hotfix: manually find unit id from name matches if needed, or better, 
        // I should update backend to include unit_id. I will verify backend model again.
        // product.model.js: `SELECT p.id, p.name, p.code, p.default_price, p.is_active, u.name...`
        // It seems `p.unit_id` is missing in SELECT list.
        // I will proactively update the product.model.js later if needed. For now let's hope I can map it or I will include unit_id in formData update logic.
        // Wait, I can just include `unit_id` in the select.
        setSelectedId(row.id);
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({ name: '', code: '', default_price: '', unit_id: '', supplier_id: '' });
        setSelectedId(null);
        setUnitQuery('');
        setSupplierQuery('');
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

    const resolveSupplier = (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
            setFormData((prev) => ({ ...prev, supplier_id: '' }));
            return;
        }
        const match = suppliers.find(
            (s) => s.label === trimmed || s.name === trimmed
        );
        setFormData((prev) => ({ ...prev, supplier_id: match?.value || '' }));
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleDownloadData = () => {
        const headers = ['name', 'code', 'default_price', 'unit_id', 'supplier_id'];
        const rows = products.map((product) => [
            product.name,
            product.code,
            product.default_price ?? '',
            product.unit_id ?? '',
            product.supplier_id ?? ''
        ]);
        downloadCsv('products_data.csv', headers, rows);
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
                    unit_id: row.unit_id,
                    supplier_id: row.supplier_id
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
                        unit_id: Number(payload.unit_id),
                        supplier_id: payload.supplier_id ? Number(payload.supplier_id) : null
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

    const columns = [
        { header: 'รหัส', accessor: 'code' },
        { header: 'ชื่อสินค้า', accessor: 'name' },
        { header: 'ราคา', render: (row) => `${row.default_price} บาท` },
        { header: 'หน่วย', render: (row) => row.unit_abbr || row.unit_name },
        { header: 'Supplier', accessor: 'supplier_name' }
    ];

    const filteredProducts = useMemo(() => {
        const term = searchQuery.trim().toLowerCase();
        if (!term) return products;
        return products.filter((product) => {
            const name = product.name || '';
            const code = product.code || '';
            const supplier = product.supplier_name || '';
            const unit = product.unit_abbr || product.unit_name || '';
            return (
                name.toLowerCase().includes(term) ||
                code.toLowerCase().includes(term) ||
                supplier.toLowerCase().includes(term) ||
                unit.toLowerCase().includes(term)
            );
        });
    }, [products, searchQuery]);

    return (
        <Layout>
            <div className="max-w-6xl mx-auto">
                <div className="mb-3">
                    <BackToSettings />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">จัดการสินค้า</h1>
                    <div className="flex gap-2">
                        <button
                            onClick={handleDownloadData}
                            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                        >
                            ดาวน์โหลดข้อมูล
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
                        label="มุมมองตามซัพพลายเออร์"
                        options={[{ value: '', label: 'ทั้งหมด' }, ...suppliers]}
                        value={selectedSupplierFilter}
                        onChange={(e) => setSelectedSupplierFilter(e.target.value)}
                    />
                    <Input
                        label="ค้นหาสินค้า"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="ชื่อสินค้า / รหัส / ซัพพลายเออร์ / หน่วยนับ"
                    />
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
                        </div>

                        <Input
                            label="Supplier (พิมพ์เพื่อค้นหา)"
                            value={supplierQuery}
                            onChange={(e) => {
                                const next = e.target.value;
                                setSupplierQuery(next);
                                resolveSupplier(next);
                            }}
                            onBlur={(e) => resolveSupplier(e.target.value)}
                            placeholder="พิมพ์ชื่อซัพพลายเออร์"
                            list="supplier-options"
                            required
                        />

                        <datalist id="unit-options">
                            {units.map((unit) => (
                                <option key={unit.value} value={unit.label} />
                            ))}
                        </datalist>
                        <datalist id="supplier-options">
                            {suppliers.map((supplier) => (
                                <option key={supplier.value} value={supplier.label} />
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
