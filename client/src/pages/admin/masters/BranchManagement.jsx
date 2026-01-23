import { useState, useEffect, useRef } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { masterAPI } from '../../../api/master';
import { parseCsv, downloadCsv } from '../../../utils/csv';

export const BranchManagement = () => {
    const [branches, setBranches] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({ name: '', code: '', clickhouse_branch_id: '' });
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [syncLoading, setSyncLoading] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        fetchBranches();
    }, []);

    const fetchBranches = async () => {
        try {
            const data = await masterAPI.getBranches();
            setBranches(data);
        } catch (error) {
            console.error('Error fetching branches:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (selectedId) {
                await masterAPI.updateBranch(selectedId, formData);
            } else {
                await masterAPI.createBranch(formData);
            }
            setIsModalOpen(false);
            fetchBranches();
            resetForm();
        } catch (error) {
            console.error('Error saving branch:', error);
            alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (row) => {
        if (confirm(`คุณต้องการลบสาขา "${row.name}" ใช่หรือไม่?`)) {
            try {
                await masterAPI.deleteBranch(row.id);
                fetchBranches();
            } catch (error) {
                console.error('Error deleting branch:', error);
                alert('เกิดข้อผิดพลาดในการลบข้อมูล');
            }
        }
    };

    const openEdit = (row) => {
        setFormData({
            name: row.name,
            code: row.code,
            clickhouse_branch_id: row.clickhouse_branch_id || ''
        });
        setSelectedId(row.id);
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({ name: '', code: '', clickhouse_branch_id: '' });
        setSelectedId(null);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleDownloadData = () => {
        const headers = ['name', 'code', 'clickhouse_branch_id'];
        const rows = branches.map((branch) => [
            branch.name,
            branch.code,
            branch.clickhouse_branch_id || ''
        ]);
        downloadCsv('branches_data.csv', headers, rows);
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
                    clickhouse_branch_id: row.clickhouse_branch_id
                }))
                .filter((row) => row.name);

            if (payloads.length === 0) {
                alert('ไม่พบข้อมูลที่นำเข้าได้');
                return;
            }

            const results = await Promise.allSettled(
                payloads.map((payload) =>
                    masterAPI.createBranch({
                        name: payload.name,
                        code: payload.code || undefined,
                        clickhouse_branch_id: payload.clickhouse_branch_id || undefined
                    })
                )
            );
            const successCount = results.filter((r) => r.status === 'fulfilled').length;
            const failedCount = results.length - successCount;

            fetchBranches();
            alert(`นำเข้าเสร็จสิ้น สำเร็จ ${successCount} รายการ` + (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : ''));
        } catch (error) {
            console.error('Error importing branches:', error);
            alert('นำเข้าไม่สำเร็จ');
        }
    };

    const handleSyncClickhouseIds = async () => {
        if (!confirm('ซิงก์ ClickHouse ID ตามค่ามาตรฐานของระบบใช่หรือไม่?')) {
            return;
        }
        try {
            setSyncLoading(true);
            const response = await masterAPI.syncBranchClickhouseIds();
            const data = response?.data ?? response;
            if (data?.branches) {
                setBranches(data.branches);
            } else {
                fetchBranches();
            }
            alert(`ซิงก์เรียบร้อย (${data?.updated || 0} รายการ)`);
        } catch (error) {
            console.error('Error syncing ClickHouse IDs:', error);
            alert('ซิงก์ ClickHouse ID ไม่สำเร็จ');
        } finally {
            setSyncLoading(false);
        }
    };

    const columns = [
        { header: 'รหัสสาขา', accessor: 'code' },
        { header: 'ชื่อสาขา', accessor: 'name' },
        { header: 'ClickHouse Branch ID', accessor: 'clickhouse_branch_id' }
    ];

    return (
        <Layout>
            <div className="max-w-6xl mx-auto">
                <div className="mb-3">
                    <BackToSettings />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">จัดการสาขา</h1>
                    <div className="flex gap-2">
                        <button
                            onClick={handleSyncClickhouseIds}
                            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                            disabled={syncLoading}
                        >
                            {syncLoading ? 'กำลังซิงก์...' : 'ซิงก์ ClickHouse ID'}
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
                            เพิ่มสาขา
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
                    data={branches}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                />

                <Modal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    title={selectedId ? 'แก้ไขสาขา' : 'เพิ่มสาขา'}
                >
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <Input
                            label="รหัสสาขา"
                            value={formData.code}
                            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                            placeholder="เว้นว่างให้ระบบกำหนด"
                        />
                        <Input
                            label="ClickHouse Branch ID"
                            value={formData.clickhouse_branch_id}
                            onChange={(e) =>
                                setFormData({ ...formData, clickhouse_branch_id: e.target.value })
                            }
                            placeholder="สำหรับรายงานขาย"
                        />
                        <Input
                            label="ชื่อสาขา"
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
