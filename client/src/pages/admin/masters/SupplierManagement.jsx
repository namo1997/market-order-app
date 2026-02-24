import { useState, useEffect, useRef } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { Select } from '../../../components/common/Select';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { masterAPI } from '../../../api/master';
import { productsAPI } from '../../../api/products';
import { parseCsv, downloadCsv } from '../../../utils/csv';

const toBool = (value) => {
    if (typeof value === 'string') {
        return value === 'true' || value === '1';
    }
    if (typeof value === 'number') {
        return value === 1;
    }
    return Boolean(value);
};

export const SupplierManagement = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [branches, setBranches] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        code: '',
        contact_person: '',
        phone: '',
        address: '',
        line_id: '',
        is_internal: false,
        limit_scope: false,
        internal_scope_list: [],
        scope_list: [],
        limit_transform_scope: false,
        transform_scope_list: []
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
        fetchMasterData();
    }, []);

    const fetchSuppliers = async () => {
        try {
            const data = await masterAPI.getProductGroups();
            setSuppliers(data);
        } catch (error) {
            console.error('Error fetching suppliers:', error);
        }
    };

    const fetchMasterData = async () => {
        try {
            const [branchData, departmentData] = await Promise.all([
                masterAPI.getBranches(),
                masterAPI.getDepartments()
            ]);
            setBranches(Array.isArray(branchData) ? branchData : []);
            setDepartments(Array.isArray(departmentData) ? departmentData : []);
        } catch (error) {
            console.error('Error fetching master data:', error);
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
        const shouldLimitScope = Boolean(formData.limit_scope);
        const shouldLimitInternalScope = Boolean(formData.is_internal);
        const scopeRows = Array.isArray(formData.scope_list) ? formData.scope_list : [];
        const internalScopeRows = Array.isArray(formData.internal_scope_list)
            ? formData.internal_scope_list
            : [];
        const shouldLimitTransformScope = Boolean(formData.limit_transform_scope);
        const transformScopeRows = Array.isArray(formData.transform_scope_list)
            ? formData.transform_scope_list
            : [];
        const normalizedScopes = scopeRows
            .map((scope) => ({
                branch_id: String(scope?.branch_id || '').trim(),
                department_id: String(scope?.department_id || '').trim()
            }))
            .filter((scope) => scope.branch_id || scope.department_id);
        const normalizedInternalScopes = internalScopeRows
            .map((scope) => ({
                branch_id: String(scope?.branch_id || '').trim(),
                department_id: String(scope?.department_id || '').trim()
            }))
            .filter((scope) => scope.branch_id || scope.department_id);
        const normalizedTransformScopes = transformScopeRows
            .map((scope) => ({
                branch_id: String(scope?.branch_id || '').trim(),
                department_id: String(scope?.department_id || '').trim()
            }))
            .filter((scope) => scope.branch_id || scope.department_id);

        if (shouldLimitScope && normalizedScopes.length === 0) {
            alert('กรุณาเพิ่มอย่างน้อย 1 สาขา/แผนก');
            return;
        }
        if (normalizedScopes.some((scope) => !scope.branch_id || !scope.department_id)) {
            alert('กรุณาเลือกทั้งสาขาและแผนกให้ครบทุกแถว');
            return;
        }
        if (shouldLimitInternalScope && normalizedInternalScopes.length === 0) {
            alert('กรุณาเพิ่มอย่างน้อย 1 สาขา/แผนก สำหรับสิทธิ์ดูคำสั่งซื้อ');
            return;
        }
        if (normalizedInternalScopes.some((scope) => !scope.branch_id || !scope.department_id)) {
            alert('กรุณาเลือกทั้งสาขาและแผนกให้ครบทุกแถวในสิทธิ์ดูคำสั่งซื้อ');
            return;
        }
        if (shouldLimitTransformScope && normalizedTransformScopes.length === 0) {
            alert('กรุณาเพิ่มอย่างน้อย 1 สาขา/แผนก สำหรับสินค้าการแปรรูป');
            return;
        }
        if (normalizedTransformScopes.some((scope) => !scope.branch_id || !scope.department_id)) {
            alert('กรุณาเลือกทั้งสาขาและแผนกให้ครบทุกแถวในสินค้าการแปรรูป');
            return;
        }
        if (
            normalizedTransformScopes.some((scope) => {
                const targetDepartment = departments.find(
                    (department) => String(department.id) === String(scope.department_id)
                );
                return !targetDepartment || !toBool(targetDepartment.is_production);
            })
        ) {
            alert('แผนกที่ผูกสินค้าการแปรรูป ต้องเป็นฝ่ายผลิตเท่านั้น');
            return;
        }

        setLoading(true);
        try {
            const payload = {
                ...formData,
                is_internal: Boolean(formData.is_internal),
                linked_branch_id: null,
                linked_department_id: null,
                internal_scope_list: shouldLimitInternalScope
                    ? normalizedInternalScopes.map((scope) => ({
                        branch_id: Number(scope.branch_id),
                        department_id: Number(scope.department_id)
                    }))
                    : [],
                scope_list: shouldLimitScope
                    ? normalizedScopes.map((scope) => ({
                        branch_id: Number(scope.branch_id),
                        department_id: Number(scope.department_id)
                    }))
                    : [],
                transform_scope_list: shouldLimitTransformScope
                    ? normalizedTransformScopes.map((scope) => ({
                        branch_id: Number(scope.branch_id),
                        department_id: Number(scope.department_id)
                    }))
                    : []
            };
            delete payload.limit_scope;
            delete payload.limit_transform_scope;
            if (selectedId) {
                await masterAPI.updateProductGroup(selectedId, payload);
            } else {
                await masterAPI.createProductGroup(payload);
            }
            setIsModalOpen(false);
            fetchSuppliers();
            resetForm();
        } catch (error) {
            console.error('Error saving supplier:', error);
            alert(error?.response?.data?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (row) => {
        if (confirm(`คุณต้องการลบกลุ่มสินค้า "${row.name}" ใช่หรือไม่?`)) {
            try {
                await masterAPI.deleteProductGroup(row.id);
                fetchSuppliers();
            } catch (error) {
                console.error('Error deleting supplier:', error);
                alert('เกิดข้อผิดพลาดในการลบข้อมูล');
            }
        }
    };

    const openEdit = (row) => {
        const existingScopes = Array.isArray(row.scope_list) && row.scope_list.length > 0
            ? row.scope_list.map((scope) => ({
                branch_id: String(scope.branch_id || ''),
                department_id: String(scope.department_id || '')
            }))
            : (
                row.linked_branch_id && row.linked_department_id
                    ? [{
                        branch_id: String(row.linked_branch_id),
                        department_id: String(row.linked_department_id)
                    }]
                    : []
            );
        const existingInternalScopes = Array.isArray(row.internal_scope_list) && row.internal_scope_list.length > 0
            ? row.internal_scope_list.map((scope) => ({
                branch_id: String(scope.branch_id || ''),
                department_id: String(scope.department_id || '')
            }))
            : [];
        const existingTransformScopes = Array.isArray(row.transform_scope_list) && row.transform_scope_list.length > 0
            ? row.transform_scope_list.map((scope) => ({
                branch_id: String(scope.branch_id || ''),
                department_id: String(scope.department_id || '')
            }))
            : [];
        setFormData({
            name: row.name,
            code: row.code,
            contact_person: row.contact_person,
            phone: row.phone,
            address: row.address || '',
            line_id: row.line_id || '',
            is_internal: toBool(row.is_internal),
            limit_scope: existingScopes.length > 0,
            internal_scope_list: existingInternalScopes,
            scope_list: existingScopes,
            limit_transform_scope: existingTransformScopes.length > 0,
            transform_scope_list: existingTransformScopes
        });
        setSelectedId(row.id);
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({
            name: '',
            code: '',
            contact_person: '',
            phone: '',
            address: '',
            line_id: '',
            is_internal: false,
            limit_scope: false,
            internal_scope_list: [],
            scope_list: [],
            limit_transform_scope: false,
            transform_scope_list: []
        });
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
        const headers = [
            'name',
            'code',
            'contact_person',
            'phone',
            'address',
            'line_id',
            'is_internal',
            'linked_branch_id',
            'linked_department_id'
        ];
        const rows = suppliers.map((supplier) => [
            supplier.name,
            supplier.code,
            supplier.contact_person,
            supplier.phone,
            supplier.address || '',
            supplier.line_id || '',
            toBool(supplier.is_internal) ? 'true' : 'false',
            supplier.linked_branch_id || '',
            supplier.linked_department_id || ''
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
                    line_id: row.line_id,
                    is_internal: row.is_internal === 'true' || row.is_internal === '1',
                    linked_branch_id: row.linked_branch_id ? Number(row.linked_branch_id) : null,
                    linked_department_id: row.linked_department_id ? Number(row.linked_department_id) : null
                }))
                .filter((row) => row.name);

            if (payloads.length === 0) {
                alert('ไม่พบข้อมูลที่นำเข้าได้');
                return;
            }

            const results = await Promise.allSettled(
                payloads.map((payload) =>
                    masterAPI.createProductGroup({
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
            alert('กรุณาเลือกกลุ่มสินค้า');
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

    const branchOptions = branches.map((branch) => ({
        value: String(branch.id),
        label: branch.name
    }));
    const getDepartmentOptionsByBranch = (branchId) =>
        departments
            .filter((department) => {
                if (!branchId) return true;
                return String(department.branch_id) === String(branchId);
            })
            .map((department) => ({
                value: String(department.id),
                label: `${department.name}${department.branch_name ? ` (${department.branch_name})` : ''}`
            }));
    const getProductionDepartmentOptionsByBranch = (branchId) =>
        departments
            .filter((department) => {
                if (String(department.is_production || '0') !== '1') return false;
                if (!branchId) return true;
                return String(department.branch_id) === String(branchId);
            })
            .map((department) => ({
                value: String(department.id),
                label: `${department.name}${department.branch_name ? ` (${department.branch_name})` : ''}`
            }));
    const addScopeRow = () => {
        setFormData((prev) => ({
            ...prev,
            scope_list: [
                ...(Array.isArray(prev.scope_list) ? prev.scope_list : []),
                { branch_id: '', department_id: '' }
            ]
        }));
    };
    const updateScopeRow = (index, nextValue) => {
        setFormData((prev) => ({
            ...prev,
            scope_list: (Array.isArray(prev.scope_list) ? prev.scope_list : []).map((scope, rowIndex) =>
                rowIndex === index ? { ...scope, ...nextValue } : scope
            )
        }));
    };
    const removeScopeRow = (index) => {
        setFormData((prev) => {
            const nextScopes = (Array.isArray(prev.scope_list) ? prev.scope_list : []).filter(
                (_, rowIndex) => rowIndex !== index
            );
            return {
                ...prev,
                scope_list: nextScopes
            };
        });
    };
    const addInternalScopeRow = () => {
        setFormData((prev) => ({
            ...prev,
            internal_scope_list: [
                ...(Array.isArray(prev.internal_scope_list) ? prev.internal_scope_list : []),
                { branch_id: '', department_id: '' }
            ]
        }));
    };
    const updateInternalScopeRow = (index, nextValue) => {
        setFormData((prev) => ({
            ...prev,
            internal_scope_list: (Array.isArray(prev.internal_scope_list) ? prev.internal_scope_list : []).map((scope, rowIndex) =>
                rowIndex === index ? { ...scope, ...nextValue } : scope
            )
        }));
    };
    const removeInternalScopeRow = (index) => {
        setFormData((prev) => {
            const nextScopes = (Array.isArray(prev.internal_scope_list) ? prev.internal_scope_list : []).filter(
                (_, rowIndex) => rowIndex !== index
            );
            return {
                ...prev,
                internal_scope_list: nextScopes
            };
        });
    };
    const addTransformScopeRow = () => {
        setFormData((prev) => ({
            ...prev,
            transform_scope_list: [
                ...(Array.isArray(prev.transform_scope_list) ? prev.transform_scope_list : []),
                { branch_id: '', department_id: '' }
            ]
        }));
    };
    const updateTransformScopeRow = (index, nextValue) => {
        setFormData((prev) => ({
            ...prev,
            transform_scope_list: (Array.isArray(prev.transform_scope_list) ? prev.transform_scope_list : []).map((scope, rowIndex) =>
                rowIndex === index ? { ...scope, ...nextValue } : scope
            )
        }));
    };
    const removeTransformScopeRow = (index) => {
        setFormData((prev) => {
            const nextScopes = (Array.isArray(prev.transform_scope_list) ? prev.transform_scope_list : []).filter(
                (_, rowIndex) => rowIndex !== index
            );
            return {
                ...prev,
                transform_scope_list: nextScopes
            };
        });
    };

    const columns = [
        { header: 'รหัส', accessor: 'code' },
        { header: 'ชื่อกลุ่มสินค้า', accessor: 'name' },
        {
            header: 'ประเภท',
            accessor: 'is_internal',
            render: (row) => toBool(row.is_internal) ? 'พื้นที่จัดเก็บสินค้า' : 'กลุ่มทั่วไป'
        },
        {
            header: 'สิทธิ์ดูคำสั่งซื้อ',
            accessor: 'internal_scope_count',
            wrap: true,
            render: (row) => {
                if (!toBool(row.is_internal)) return '-';
                const scopes = Array.isArray(row.internal_scope_list) ? row.internal_scope_list : [];
                if (scopes.length === 0) {
                    return 'ยังไม่กำหนด';
                }
                return scopes
                    .map((scope) => `${scope.branch_name || '-'} / ${scope.department_name || '-'}`)
                    .join(', ');
            }
        },
        {
            header: 'แสดงในการสั่งซื้อ',
            accessor: 'linked_department_name',
            wrap: true,
            render: (row) => {
                const scopes = Array.isArray(row.scope_list) ? row.scope_list : [];
                if (scopes.length === 0) {
                    return 'ทุกสาขา / ทุกแผนก';
                }
                return scopes
                    .map((scope) => `${scope.branch_name || '-'} / ${scope.department_name || '-'}`)
                    .join(', ');
            }
        },
        {
            header: 'ผูกแปรรูป',
            accessor: 'transform_scope_count',
            wrap: true,
            render: (row) => {
                const scopes = Array.isArray(row.transform_scope_list) ? row.transform_scope_list : [];
                if (scopes.length === 0) {
                    return 'ทุกแผนก';
                }
                return scopes
                    .map((scope) => `${scope.branch_name || '-'} / ${scope.department_name || '-'}`)
                    .join(', ');
            }
        },
        { header: 'ผู้ติดต่อ', accessor: 'contact_person' },
        { header: 'เบอร์โทร', accessor: 'phone' }
    ];

    return (
        <Layout mainClassName="!max-w-none">
            <div className="w-full">
                <div className="mb-3">
                    <BackToSettings />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">จัดการกลุ่มสินค้า</h1>
                    <div className="flex flex-wrap gap-2">
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
                            เพิ่มกลุ่มสินค้า
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

                <div className="w-full">
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
                </div>

                <Modal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    title={selectedId ? 'แก้ไขกลุ่มสินค้า' : 'เพิ่มกลุ่มสินค้า'}
                    size="xlarge"
                >
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Input
                            label="รหัส"
                            value={formData.code}
                            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                            placeholder="เว้นว่างให้ระบบกำหนด"
                        />
                            <Input
                                label="ชื่อกลุ่มสินค้า"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={Boolean(formData.is_internal)}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        is_internal: e.target.checked,
                                        internal_scope_list:
                                            e.target.checked
                                                ? (
                                                    Array.isArray(prev.internal_scope_list) && prev.internal_scope_list.length > 0
                                                        ? prev.internal_scope_list
                                                        : [{ branch_id: '', department_id: '' }]
                                                )
                                                : []
                                    }))
                                }
                            />
                            พื้นที่จัดเก็บสินค้า (มีหน้าที่จัดเก็บสินค้า)
                        </label>
                        {formData.is_internal && (
                            <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                                <p className="text-sm font-medium text-gray-800">
                                    สิทธิ์ดูคำสั่งซื้อของพื้นที่จัดเก็บสินค้า (เลือกแผนกที่เห็นเมนู “คำสั่งซื้อ”)
                                </p>
                                {(Array.isArray(formData.internal_scope_list) ? formData.internal_scope_list : []).map((scope, index) => (
                                    <div key={`internal-${index}-${scope.branch_id || 'b'}-${scope.department_id || 'd'}`} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                                        <div className="sm:col-span-5">
                                            <Select
                                                label={`สาขา #${index + 1}`}
                                                value={scope.branch_id || ''}
                                                onChange={(e) =>
                                                    updateInternalScopeRow(index, {
                                                        branch_id: e.target.value,
                                                        department_id:
                                                            String(scope.branch_id || '') === String(e.target.value)
                                                                ? (scope.department_id || '')
                                                                : ''
                                                    })
                                                }
                                                options={branchOptions}
                                                required
                                            />
                                        </div>
                                        <div className="sm:col-span-5">
                                            <Select
                                                label="แผนก"
                                                value={scope.department_id || ''}
                                                onChange={(e) =>
                                                    updateInternalScopeRow(index, {
                                                        department_id: e.target.value
                                                    })
                                                }
                                                options={getDepartmentOptionsByBranch(scope.branch_id)}
                                                required
                                            />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <button
                                                type="button"
                                                onClick={() => removeInternalScopeRow(index)}
                                                className="w-full px-3 py-2 border rounded-lg hover:bg-gray-50 text-sm text-red-600"
                                                disabled={(Array.isArray(formData.internal_scope_list) ? formData.internal_scope_list : []).length <= 1}
                                            >
                                                ลบ
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <div>
                                    <button
                                        type="button"
                                        onClick={addInternalScopeRow}
                                        className="px-3 py-2 border rounded-lg hover:bg-gray-50 text-sm"
                                    >
                                        เพิ่มสาขา/แผนก
                                    </button>
                                </div>
                            </div>
                        )}
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={Boolean(formData.limit_scope)}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        limit_scope: e.target.checked,
                                        scope_list:
                                            e.target.checked
                                                ? (
                                                    Array.isArray(prev.scope_list) && prev.scope_list.length > 0
                                                        ? prev.scope_list
                                                        : [{ branch_id: '', department_id: '' }]
                                                )
                                                : []
                                    }))
                                }
                            />
                            แสดงเฉพาะสาขา/แผนกในการสั่งซื้อ
                        </label>
                        {formData.limit_scope && (
                            <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                                {(Array.isArray(formData.scope_list) ? formData.scope_list : []).map((scope, index) => (
                                    <div key={`${index}-${scope.branch_id || 'b'}-${scope.department_id || 'd'}`} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                                        <div className="sm:col-span-5">
                                            <Select
                                                label={`สาขา #${index + 1}`}
                                                value={scope.branch_id || ''}
                                                onChange={(e) =>
                                                    updateScopeRow(index, {
                                                        branch_id: e.target.value,
                                                        department_id:
                                                            String(scope.branch_id || '') === String(e.target.value)
                                                                ? (scope.department_id || '')
                                                                : ''
                                                    })
                                                }
                                                options={branchOptions}
                                                required
                                            />
                                        </div>
                                        <div className="sm:col-span-5">
                                            <Select
                                                label="แผนก"
                                                value={scope.department_id || ''}
                                                onChange={(e) =>
                                                    updateScopeRow(index, {
                                                        department_id: e.target.value
                                                    })
                                                }
                                                options={getDepartmentOptionsByBranch(scope.branch_id)}
                                                required
                                            />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <button
                                                type="button"
                                                onClick={() => removeScopeRow(index)}
                                                className="w-full px-3 py-2 border rounded-lg hover:bg-gray-50 text-sm text-red-600"
                                                disabled={(Array.isArray(formData.scope_list) ? formData.scope_list : []).length <= 1}
                                            >
                                                ลบ
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <div>
                                    <button
                                        type="button"
                                        onClick={addScopeRow}
                                        className="px-3 py-2 border rounded-lg hover:bg-gray-50 text-sm"
                                    >
                                        เพิ่มสาขา/แผนก
                                    </button>
                                </div>
                            </div>
                        )}
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={Boolean(formData.limit_transform_scope)}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        limit_transform_scope: e.target.checked,
                                        transform_scope_list:
                                            e.target.checked
                                                ? (
                                                    Array.isArray(prev.transform_scope_list) && prev.transform_scope_list.length > 0
                                                        ? prev.transform_scope_list
                                                        : [{ branch_id: '', department_id: '' }]
                                                )
                                                : []
                                    }))
                                }
                            />
                            ตั้งค่าสินค้าการแปรรูป (เลือกได้เฉพาะแผนกฝ่ายผลิต)
                        </label>
                        {formData.limit_transform_scope && (
                            <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                                {(Array.isArray(formData.transform_scope_list) ? formData.transform_scope_list : []).map((scope, index) => (
                                    <div key={`transform-${index}-${scope.branch_id || 'b'}-${scope.department_id || 'd'}`} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                                        <div className="sm:col-span-5">
                                            <Select
                                                label={`สาขา #${index + 1}`}
                                                value={scope.branch_id || ''}
                                                onChange={(e) =>
                                                    updateTransformScopeRow(index, {
                                                        branch_id: e.target.value,
                                                        department_id:
                                                            String(scope.branch_id || '') === String(e.target.value)
                                                                ? (scope.department_id || '')
                                                                : ''
                                                    })
                                                }
                                                options={branchOptions}
                                                required
                                            />
                                        </div>
                                        <div className="sm:col-span-5">
                                            <Select
                                                label="แผนก"
                                                value={scope.department_id || ''}
                                                onChange={(e) =>
                                                    updateTransformScopeRow(index, {
                                                        department_id: e.target.value
                                                    })
                                                }
                                                options={getProductionDepartmentOptionsByBranch(scope.branch_id)}
                                                required
                                            />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <button
                                                type="button"
                                                onClick={() => removeTransformScopeRow(index)}
                                                className="w-full px-3 py-2 border rounded-lg hover:bg-gray-50 text-sm text-red-600"
                                                disabled={(Array.isArray(formData.transform_scope_list) ? formData.transform_scope_list : []).length <= 1}
                                            >
                                                ลบ
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <div>
                                    <button
                                        type="button"
                                        onClick={addTransformScopeRow}
                                        className="px-3 py-2 border rounded-lg hover:bg-gray-50 text-sm"
                                    >
                                        เพิ่มสาขา/แผนก
                                    </button>
                                </div>
                            </div>
                        )}

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
                    title="เพิ่มสินค้าในกลุ่มสินค้า"
                    size="large"
                >
                    <form onSubmit={handleAssignProducts} className="space-y-4">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            กลุ่มสินค้า: <span className="font-medium">{productSupplier?.name || '-'}</span>
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
                                    เลือกเฉพาะที่ยังไม่มีกลุ่ม
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
                                                                : ' • ยังไม่ระบุกลุ่มสินค้า'}
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
