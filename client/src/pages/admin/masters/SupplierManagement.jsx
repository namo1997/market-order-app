import { useState, useEffect, useRef } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { masterAPI } from '../../../api/master';
import { productsAPI } from '../../../api/products';
import { parseCsv, downloadCsv } from '../../../utils/csv';

export const SupplierManagement = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        name: '', code: '', contact_person: '', phone: '', address: '', line_id: ''
    });
    const [productSupplier, setProductSupplier] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [productLoading, setProductLoading] = useState(false);
    const [productsLoading, setProductsLoading] = useState(false);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [products, setProducts] = useState([]);
    const [productSearch, setProductSearch] = useState('');
    const [selectedProductIds, setSelectedProductIds] = useState(new Set());
    const fileInputRef = useRef(null);

    useEffect(() => {
        fetchSuppliers();
    }, []);

    const fetchSuppliers = async () => {
        try {
            const data = await masterAPI.getSuppliers();
            setSuppliers(data);
        } catch (error) {
            console.error('Error fetching suppliers:', error);
        }
    };

    const fetchProducts = async () => {
        try {
            setProductsLoading(true);
            const response = await productsAPI.getProducts();
            const data = response?.data ?? response ?? [];
            setProducts(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching products:', error);
        } finally {
            setProductsLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (selectedId) {
                await masterAPI.updateSupplier(selectedId, formData);
            } else {
                await masterAPI.createSupplier(formData);
            }
            setIsModalOpen(false);
            fetchSuppliers();
            resetForm();
        } catch (error) {
            console.error('Error saving supplier:', error);
            alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (row) => {
        if (confirm(`คุณต้องการลบ Supplier "${row.name}" ใช่หรือไม่?`)) {
            try {
                await masterAPI.deleteSupplier(row.id);
                fetchSuppliers();
            } catch (error) {
                console.error('Error deleting supplier:', error);
                alert('เกิดข้อผิดพลาดในการลบข้อมูล');
            }
        }
    };

    const openEdit = (row) => {
        setFormData({
            name: row.name,
            code: row.code,
            contact_person: row.contact_person,
            phone: row.phone,
            address: row.address || '',
            line_id: row.line_id || ''
        });
        setSelectedId(row.id);
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({ name: '', code: '', contact_person: '', phone: '', address: '', line_id: '' });
        setSelectedId(null);
    };

    const resetProductSelection = () => {
        setSelectedProductIds(new Set());
        setProductSearch('');
        setProductSupplier(null);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleDownloadData = () => {
        const headers = ['name', 'code', 'contact_person', 'phone', 'address', 'line_id'];
        const rows = suppliers.map((supplier) => [
            supplier.name,
            supplier.code,
            supplier.contact_person,
            supplier.phone,
            supplier.address || '',
            supplier.line_id || ''
        ]);
        downloadCsv('suppliers_data.csv', headers, rows);
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
                    contact_person: row.contact_person,
                    phone: row.phone,
                    address: row.address,
                    line_id: row.line_id
                }))
                .filter((row) => row.name);

            if (payloads.length === 0) {
                alert('ไม่พบข้อมูลที่นำเข้าได้');
                return;
            }

            const results = await Promise.allSettled(
                payloads.map((payload) =>
                    masterAPI.createSupplier({
                        ...payload,
                        code: payload.code || undefined
                    })
                )
            );
            const successCount = results.filter((r) => r.status === 'fulfilled').length;
            const failedCount = results.length - successCount;

            fetchSuppliers();
            alert(`นำเข้าเสร็จสิ้น สำเร็จ ${successCount} รายการ` + (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : ''));
        } catch (error) {
            console.error('Error importing suppliers:', error);
            alert('นำเข้าไม่สำเร็จ');
        }
    };

    const openAddProduct = (supplier) => {
        setProductSupplier(supplier);
        setSelectedProductIds(new Set());
        setProductSearch('');
        setIsProductModalOpen(true);
        fetchProducts();
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

    const handleSelectAll = () => {
        const next = new Set();
        filteredProducts.forEach((product) => {
            if (productSupplier?.id === product.supplier_id) return;
            next.add(product.id);
        });
        setSelectedProductIds(next);
    };

    const handleSelectUnassigned = () => {
        const next = new Set();
        filteredProducts.forEach((product) => {
            if (!product.supplier_id) {
                next.add(product.id);
            }
        });
        setSelectedProductIds(next);
    };

    const handleAssignProducts = async (event) => {
        event.preventDefault();
        if (!productSupplier) {
            alert('กรุณาเลือก Supplier');
            return;
        }

        const selectedProducts = products.filter((product) => selectedProductIds.has(product.id));
        if (selectedProducts.length === 0) {
            alert('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');
            return;
        }

        setProductLoading(true);
        try {
            const results = await Promise.allSettled(
                selectedProducts.map((product) =>
                    productsAPI.updateProduct(product.id, {
                        name: product.name,
                        code: product.code,
                        default_price: product.default_price,
                        unit_id: product.unit_id,
                        supplier_id: productSupplier.id
                    })
                )
            );
            const successCount = results.filter((r) => r.status === 'fulfilled').length;
            const failedCount = results.length - successCount;

            setIsProductModalOpen(false);
            resetProductSelection();
            alert(`ย้ายสินค้าเสร็จสิ้น สำเร็จ ${successCount} รายการ` + (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : ''));
        } catch (error) {
            console.error('Error assigning products:', error);
            alert('เกิดข้อผิดพลาดในการย้ายสินค้า');
        } finally {
            setProductLoading(false);
        }
    };

    const normalizedSearch = productSearch.trim().toLowerCase();
    const filteredProducts = products.filter((product) => {
        const name = product.name || '';
        return normalizedSearch ? name.toLowerCase().includes(normalizedSearch) : true;
    });

    const columns = [
        { header: 'รหัส', accessor: 'code' },
        { header: 'ชื่อบริษัท', accessor: 'name' },
        { header: 'ผู้ติดต่อ', accessor: 'contact_person' },
        { header: 'เบอร์โทร', accessor: 'phone' }
    ];

    return (
        <Layout>
            <div className="max-w-6xl mx-auto">
                <div className="mb-3">
                    <BackToSettings />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">จัดการ Suppliers</h1>
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
                            เพิ่ม Supplier
                        </button>
                    </div>
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
                    data={suppliers}
                    renderActions={(row) => (
                        <div className="flex items-center justify-end gap-3">
                            <button
                                onClick={() => openAddProduct(row)}
                                className="text-green-600 hover:text-green-900"
                            >
                                เพิ่มสินค้า
                            </button>
                            <button
                                onClick={() => openEdit(row)}
                                className="text-blue-600 hover:text-blue-900"
                            >
                                แก้ไข
                            </button>
                            <button
                                onClick={() => handleDelete(row)}
                                className="text-red-600 hover:text-red-900"
                            >
                                ลบ
                            </button>
                        </div>
                    )}
                />

                <Modal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    title={selectedId ? 'แก้ไข Supplier' : 'เพิ่ม Supplier'}
                >
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="รหัส"
                            value={formData.code}
                            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                            placeholder="เว้นว่างให้ระบบกำหนด"
                        />
                            <Input
                                label="ชื่อบริษัท"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="ผู้ติดต่อ"
                                value={formData.contact_person}
                                onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                                required
                            />
                            <Input
                                label="เบอร์โทร"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                required
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="ที่อยู่"
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            />
                            <Input
                                label="Line ID"
                                value={formData.line_id}
                                onChange={(e) => setFormData({ ...formData, line_id: e.target.value })}
                            />
                        </div>

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

                <Modal
                    isOpen={isProductModalOpen}
                    onClose={() => { setIsProductModalOpen(false); resetProductSelection(); }}
                    title="เพิ่มสินค้าใน Supplier"
                    size="large"
                >
                    <form onSubmit={handleAssignProducts} className="space-y-4">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            Supplier: <span className="font-medium">{productSupplier?.name || '-'}</span>
                        </div>
                        <Input
                            label="ค้นหาสินค้า"
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            placeholder="พิมพ์ชื่อสินค้า"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                            <div>เลือกแล้ว {selectedProductIds.size} รายการ</div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleSelectUnassigned}
                                    className="rounded-full border border-gray-200 px-3 py-1 text-gray-600 hover:bg-gray-50"
                                >
                                    เลือกเฉพาะที่ยังไม่มีซัพ
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
                                            const isAssigned = productSupplier?.id === product.supplier_id;
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
                                                            {product.supplier_name
                                                                ? ` • ปัจจุบัน: ${product.supplier_name}`
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
                                onClick={() => { setIsProductModalOpen(false); resetProductSelection(); }}
                                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                            >
                                ยกเลิก
                            </button>
                            <button
                                type="submit"
                                disabled={productLoading}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-300"
                            >
                                {productLoading ? 'กำลังบันทึก...' : 'ย้ายสินค้า'}
                            </button>
                        </div>
                    </form>
                </Modal>
            </div>
        </Layout>
    );
};
