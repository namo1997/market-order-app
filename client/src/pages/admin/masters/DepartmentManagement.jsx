import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { Select } from '../../../components/common/Select';
import { masterAPI } from '../../../api/master';
import { parseCsv, downloadCsv } from '../../../utils/csv';
import { BackToSettings } from '../../../components/common/BackToSettings';

const toBool = (value) => {
    if (typeof value === 'string') return value === 'true' || value === '1';
    if (typeof value === 'number') return value === 1;
    return Boolean(value);
};

const DEPARTMENT_ROLE_OPTIONS = [
    { value: 'user', label: 'พนักงานทั่วไป' },
    { value: 'admin', label: 'ผู้ดูแลระบบ' },
    { value: 'super_admin', label: 'ซูเปอร์แอดมิน' }
];

const normalizeAllowedRoles = (value) => {
    const raw = Array.isArray(value)
        ? value
        : String(value || '')
            .split(/[|,]/)
            .map((item) => item.trim())
            .filter(Boolean);
    const normalized = raw.filter((role) =>
        DEPARTMENT_ROLE_OPTIONS.some((option) => option.value === role)
    );
    return normalized.length > 0 ? Array.from(new Set(normalized)) : ['user'];
};

const formatAllowedRoles = (value) => {
    const roles = normalizeAllowedRoles(value);
    return roles
        .map((role) => DEPARTMENT_ROLE_OPTIONS.find((option) => option.value === role)?.label || role)
        .join(', ');
};

export const DepartmentManagement = () => {
    const navigate = useNavigate();
    const [departments, setDepartments] = useState([]);
    const [branches, setBranches] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        code: '',
        branch_id: '',
        is_production: false,
        stock_check_required: true,
        can_view_stock_balance: false,
        allowed_roles: ['user']
    });
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [bulkLoading, setBulkLoading] = useState(false);
    const [sortBy, setSortBy] = useState('name');
    const [sortDir, setSortDir] = useState('asc');
    const fileInputRef = useRef(null);

    useEffect(() => {
        fetchDepartments();
        fetchBranches();
    }, []);

    const fetchDepartments = async () => {
        try {
            const data = await masterAPI.getDepartmentsAll();
            setDepartments(
                data.map((row) => ({
                    ...row,
                    allowed_roles: normalizeAllowedRoles(row.allowed_roles)
                }))
            );
        } catch (error) {
            console.error('Error fetching departments:', error);
        }
    };

    const fetchBranches = async () => {
        try {
            const data = await masterAPI.getBranches();
            setBranches(data.map(b => ({ value: b.id, label: b.name })));
        } catch (error) {
            console.error('Error fetching branches:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (!formData.allowed_roles || formData.allowed_roles.length === 0) {
                alert('กรุณาเลือกอย่างน้อย 1 บทบาท');
                setLoading(false);
                return;
            }
            const payload = {
                ...formData,
                is_production: Boolean(formData.is_production),
                stock_check_required:
                    formData.stock_check_required === undefined
                        ? true
                        : Boolean(formData.stock_check_required),
                allowed_roles: normalizeAllowedRoles(formData.allowed_roles)
            };
            if (selectedId) {
                await masterAPI.updateDepartment(selectedId, payload);
            } else {
                await masterAPI.createDepartment(payload);
            }
            setIsModalOpen(false);
            fetchDepartments();
            resetForm();
        } catch (error) {
            console.error('Error saving department:', error);
            alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (row) => {
        if (confirm(`คุณต้องการลบแผนก "${row.name}" ใช่หรือไม่?`)) {
            try {
                await masterAPI.deleteDepartment(row.id);
                fetchDepartments();
            } catch (error) {
                console.error('Error deleting department:', error);
                alert('เกิดข้อผิดพลาดในการลบข้อมูล');
            }
        }
    };

    const handleToggleActive = async (row) => {
        const currentState = row.is_active === true || row.is_active === 1 || row.is_active === '1';
        const nextState = !currentState;
        const label = nextState ? 'แสดง' : 'ซ่อน';
        if (confirm(`คุณต้องการ${label}แผนก "${row.name}" ใช่หรือไม่?`)) {
            try {
                await masterAPI.updateDepartmentStatus(row.id, nextState);
                fetchDepartments();
            } catch (error) {
                console.error('Error updating department status:', error);
                const message = error.response?.data?.message || 'เกิดข้อผิดพลาดในการอัปเดตสถานะ';
                alert(message);
            }
        }
    };

    const handleHideAll = async () => {
        const activeDepartments = departments.filter(
            (dept) => dept.is_active === true || dept.is_active === 1 || dept.is_active === '1'
        );

        if (activeDepartments.length === 0) {
            alert('ไม่มีแผนกที่แสดงอยู่');
            return;
        }

        if (!confirm(`ซ่อนแผนกทั้งหมด ${activeDepartments.length} รายการ ใช่หรือไม่?`)) {
            return;
        }

        setBulkLoading(true);
        try {
            const results = await Promise.allSettled(
                activeDepartments.map((dept) => masterAPI.updateDepartmentStatus(dept.id, false))
            );
            const failedCount = results.filter((r) => r.status === 'rejected').length;
            const successCount = results.length - failedCount;
            if (failedCount > 0) {
                alert(`ซ่อนสำเร็จ ${successCount} รายการ, ล้มเหลว ${failedCount} รายการ`);
            } else {
                alert(`ซ่อนทั้งหมด ${successCount} รายการแล้ว`);
            }
        } catch (error) {
            console.error('Error updating department status:', error);
            const message = error.response?.data?.message || 'เกิดข้อผิดพลาดในการอัปเดตสถานะ';
            alert(message);
        } finally {
            setBulkLoading(false);
            fetchDepartments();
        }
    };

    const openEdit = (row) => {
        setFormData({
            name: row.name,
            code: row.code,
            branch_id: row.branch_id,
            is_production: toBool(row.is_production),
            stock_check_required:
                row.stock_check_required === undefined || row.stock_check_required === null
                    ? true
                    : toBool(row.stock_check_required),
            can_view_stock_balance: toBool(row.can_view_stock_balance),
            allowed_roles: normalizeAllowedRoles(row.allowed_roles)
        });
        setSelectedId(row.id);
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({
            name: '',
            code: '',
            branch_id: '',
            is_production: false,
            stock_check_required: true,
            can_view_stock_balance: false,
            allowed_roles: ['user']
        });
        setSelectedId(null);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleDownloadData = () => {
        const headers = [
            'branch_id',
            'name',
            'code',
            'is_production',
            'stock_check_required',
            'allowed_roles'
        ];
        const rows = departments.map((department) => [
            department.branch_id,
            department.name,
            department.code,
            toBool(department.is_production) ? 'true' : 'false',
            toBool(department.stock_check_required) ? 'true' : 'false',
            normalizeAllowedRoles(department.allowed_roles).join('|')
        ]);
        downloadCsv('departments_data.csv', headers, rows);
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
                    branch_id: row.branch_id,
                    name: row.name,
                    code: row.code,
                    is_production: row.is_production === 'true' || row.is_production === '1',
                    stock_check_required:
                        row.stock_check_required === undefined ||
                        row.stock_check_required === ''
                            ? true
                            : row.stock_check_required === 'true' || row.stock_check_required === '1',
                    allowed_roles: normalizeAllowedRoles(row.allowed_roles)
                }))
                .filter((row) => row.branch_id && row.name);

            if (payloads.length === 0) {
                alert('ไม่พบข้อมูลที่นำเข้าได้');
                return;
            }

            const results = await Promise.allSettled(
                payloads.map((payload) =>
                    masterAPI.createDepartment({
                        branch_id: Number(payload.branch_id),
                        name: payload.name,
                        code: payload.code || undefined,
                        is_production: payload.is_production,
                        stock_check_required: payload.stock_check_required,
                        allowed_roles: payload.allowed_roles
                    })
                )
            );
            const successCount = results.filter((r) => r.status === 'fulfilled').length;
            const failedCount = results.length - successCount;

            fetchDepartments();
            alert(`นำเข้าเสร็จสิ้น สำเร็จ ${successCount} รายการ` + (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : ''));
        } catch (error) {
            console.error('Error importing departments:', error);
            alert('นำเข้าไม่สำเร็จ');
        }
    };

    const columns = [
        { header: 'รหัสแผนก', accessor: 'code' },
        { header: 'ชื่อแผนก', accessor: 'name' },
        { header: 'สาขา', accessor: 'branch_name' },
        {
            header: 'บทบาทที่ใช้ได้',
            accessor: 'allowed_roles',
            render: (row) => formatAllowedRoles(row.allowed_roles)
        },
        {
            header: 'ฝ่ายผลิต',
            accessor: 'is_production',
            render: (row) => (
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                    toBool(row.is_production)
                        ? 'bg-violet-100 text-violet-700'
                        : 'bg-gray-100 text-gray-500'
                }`}>
                    {toBool(row.is_production) ? 'ใช่' : 'ไม่ใช่'}
                </span>
            )
        },
        {
            header: 'เช็คสต็อก',
            accessor: 'stock_check_required',
            render: (row) => (
                <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                        toBool(row.stock_check_required)
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-gray-100 text-gray-500'
                    }`}
                >
                    {toBool(row.stock_check_required) ? 'เปิด' : 'ปิด'}
                </span>
            )
        },
        {
            header: 'สถานะ',
            render: (row) => (
                <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                        row.is_active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-gray-100 text-gray-500'
                    }`}
                >
                    {row.is_active ? 'แสดง' : 'ซ่อน'}
                </span>
            )
        }
    ];

    const sortedDepartments = [...departments].sort((a, b) => {
        const getValue = (row) => {
            if (sortBy === 'status') {
                return row.is_active ? 1 : 0;
            }
            return String(row[sortBy] ?? '').toLowerCase();
        };

        const valueA = getValue(a);
        const valueB = getValue(b);

        if (valueA < valueB) return sortDir === 'asc' ? -1 : 1;
        if (valueA > valueB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    const handleSort = (key) => {
        if (key === sortBy) {
            setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
            return;
        }
        setSortBy(key);
        setSortDir('asc');
    };

    const handleManageStockTemplate = (row) => {
        navigate(`/admin/settings/stock-categories?departmentId=${row.id}`);
    };

    return (
        <Layout mainClassName="!max-w-none">
            <div className="w-full">
                <div className="mb-3">
                    <BackToSettings />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">จัดการแผนก</h1>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={handleHideAll}
                            disabled={bulkLoading}
                            className="px-4 py-2 border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50 disabled:opacity-60"
                        >
                            {bulkLoading ? 'กำลังซ่อน...' : 'ซ่อนทั้งหมด'}
                        </button>
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
                            เพิ่มแผนก
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
                    data={sortedDepartments}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                    renderActions={(row) => (
                        <div className="flex items-center justify-end gap-3">
                            <button
                                onClick={() => handleManageStockTemplate(row)}
                                className="text-emerald-600 hover:text-emerald-800"
                            >
                                เพิ่มสินค้า
                            </button>
                            <button
                                onClick={() => handleToggleActive(row)}
                                className="text-amber-600 hover:text-amber-800"
                            >
                                {row.is_active ? 'ซ่อน' : 'แสดง'}
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
                    title={selectedId ? 'แก้ไขแผนก' : 'เพิ่มแผนก'}
                >
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <Select
                            label="สาขา"
                            options={branches}
                            value={formData.branch_id}
                            onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                            required
                        />
                        <Input
                            label="รหัสแผนก"
                            value={formData.code}
                            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                            placeholder="เว้นว่างให้ระบบกำหนด"
                        />
                        <Input
                            label="ชื่อแผนก"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                        />
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={Boolean(formData.is_production)}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        is_production: e.target.checked
                                    }))
                                }
                            />
                            เป็นฝ่ายผลิต
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={Boolean(formData.stock_check_required)}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        stock_check_required: e.target.checked
                                    }))
                                }
                            />
                            เปิดใช้งานเช็คสต็อกในแผนกนี้
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={Boolean(formData.can_view_stock_balance)}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        can_view_stock_balance: e.target.checked
                                    }))
                                }
                            />
                            <span>
                                แสดงเมนู "ดูยอดสต็อก" ในหน้าหลักของแผนกนี้
                                <span className="ml-1 text-xs text-gray-400">(ทุก user ในแผนกนี้จะเห็นเมนู)</span>
                            </span>
                        </label>
                        <div className="space-y-2">
                            <div className="text-sm font-medium text-gray-700">บทบาทที่ใช้ได้ในแผนกนี้</div>
                            <div className="flex flex-wrap gap-4">
                                {DEPARTMENT_ROLE_OPTIONS.map((option) => (
                                    <label key={option.value} className="flex items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={normalizeAllowedRoles(formData.allowed_roles).includes(option.value)}
                                            onChange={(e) => {
                                                const current = normalizeAllowedRoles(formData.allowed_roles);
                                                const next = e.target.checked
                                                    ? [...current, option.value]
                                                    : current.filter((role) => role !== option.value);
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    allowed_roles: Array.from(new Set(next))
                                                }));
                                            }}
                                        />
                                        {option.label}
                                    </label>
                                ))}
                            </div>
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
            </div>
        </Layout>
    );
};
