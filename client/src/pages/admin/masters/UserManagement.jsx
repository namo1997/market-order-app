import { useState, useEffect, useRef } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { Select } from '../../../components/common/Select';
import { masterAPI } from '../../../api/master';
import { parseCsv, downloadCsv } from '../../../utils/csv';

export const UserManagement = () => {
    const [users, setUsers] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        username: '', password: '', name: '', role: 'user', department_id: ''
    });
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        fetchUsers();
        fetchDepartments();
    }, []);

    const fetchUsers = async () => {
        try {
            const data = await masterAPI.getUsers();
            setUsers(data);
        } catch (error) {
            console.error('Error fetching users:', error);
        }
    };

    const fetchDepartments = async () => {
        try {
            const data = await masterAPI.getDepartments();
            // Format: "Branch - Dept" for clarity
            setDepartments(data.map(d => ({
                value: d.id,
                label: `${d.branch_name} - ${d.name}`
            })));
        } catch (error) {
            console.error('Error fetching departments:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (selectedId) {
                await masterAPI.updateUser(selectedId, formData);
            } else {
                await masterAPI.createUser(formData);
            }
            setIsModalOpen(false);
            fetchUsers();
            resetForm();
        } catch (error) {
            console.error('Error saving user:', error);
            alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (row) => {
        if (confirm(`คุณต้องการลบผู้ใช้ "${row.name}" ใช่หรือไม่?`)) {
            try {
                await masterAPI.deleteUser(row.id);
                fetchUsers();
            } catch (error) {
                console.error('Error deleting user:', error);
                alert('เกิดข้อผิดพลาดในการลบข้อมูล');
            }
        }
    };

    const openEdit = (row) => {
        setFormData({
            username: row.username,
            password: '', // Don't fill password on edit
            name: row.name,
            role: row.role,
            department_id: row.department_id
        });
        setSelectedId(row.id);
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({ username: '', password: '', name: '', role: 'user', department_id: '' });
        setSelectedId(null);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleDownloadData = () => {
        const headers = ['username', 'password', 'name', 'role', 'department_id'];
        const rows = users.map((user) => [
            user.username,
            '',
            user.name,
            user.role || 'user',
            user.department_id || ''
        ]);
        downloadCsv('users_data.csv', headers, rows);
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
                    username: row.username,
                    password: row.password,
                    name: row.name,
                    role: row.role || 'user',
                    department_id: row.department_id
                }))
                .filter((row) => row.username && row.password && row.name && row.department_id);

            if (payloads.length === 0) {
                alert('ไม่พบข้อมูลที่นำเข้าได้');
                return;
            }

            const results = await Promise.allSettled(
                payloads.map((payload) =>
                    masterAPI.createUser({
                        username: payload.username,
                        password: payload.password,
                        name: payload.name,
                        role: payload.role,
                        department_id: Number(payload.department_id)
                    })
                )
            );
            const successCount = results.filter((r) => r.status === 'fulfilled').length;
            const failedCount = results.length - successCount;

            fetchUsers();
            alert(`นำเข้าเสร็จสิ้น สำเร็จ ${successCount} รายการ` + (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : ''));
        } catch (error) {
            console.error('Error importing users:', error);
            alert('นำเข้าไม่สำเร็จ');
        }
    };

    const columns = [
        { header: 'Username', accessor: 'username' },
        { header: 'ชื่อ-สกุล', accessor: 'name' },
        { header: 'ตำแหน่ง', accessor: 'role' },
        { header: 'แผนก/สาขา', render: (row) => `${row.branch_name} - ${row.department_name}` }
    ];

    return (
        <Layout>
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">จัดการผู้ใช้งาน</h1>
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
                            เพิ่มผู้ใช้งาน
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
                    data={users}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                />

                <Modal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    title={selectedId ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งาน'}
                >
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="Username"
                                value={formData.username}
                                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                required
                                disabled={selectedId} // Cannot change username
                            />
                            <Input
                                label="Password"
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                required={!selectedId} // Required only on create
                                placeholder={selectedId ? 'เว้นว่างถ้าไม่ต้องการเปลี่ยน' : ''}
                            />
                        </div>

                        <Input
                            label="ชื่อ-สกุล"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <Select
                                label="ตำแหน่ง"
                                options={[
                                    { value: 'user', label: 'พนักงานทั่วไป (Order)' },
                                    { value: 'admin', label: 'ผู้ดูแลระบบ (Admin)' }
                                ]}
                                value={formData.role}
                                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                required
                            />
                            <Select
                                label="สังกัดสาขา/แผนก"
                                options={departments}
                                value={formData.department_id}
                                onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                                required
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
            </div>
        </Layout>
    );
};
