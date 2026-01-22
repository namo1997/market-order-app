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

export const DepartmentManagement = () => {
    const navigate = useNavigate();
    const [departments, setDepartments] = useState([]);
    const [branches, setBranches] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({ name: '', code: '', branch_id: '' });
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
            setDepartments(data);
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
            if (selectedId) {
                await masterAPI.updateDepartment(selectedId, formData);
            } else {
                await masterAPI.createDepartment(formData);
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
        setFormData({ name: row.name, code: row.code, branch_id: row.branch_id });
        setSelectedId(row.id);
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({ name: '', code: '', branch_id: '' });
        setSelectedId(null);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleDownloadData = () => {
        const headers = ['branch_id', 'name', 'code'];
        const rows = departments.map((department) => [
            department.branch_id,
            department.name,
            department.code
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
                    code: row.code
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
                        code: payload.code || undefined
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
        navigate(`/admin/settings/stock-templates?departmentId=${row.id}`);
    };

    return (
        <Layout>
            <div className="max-w-6xl mx-auto">
                <div className="mb-3">
                    <BackToSettings />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">จัดการแผนก</h1>
                    <div className="flex gap-2">
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
