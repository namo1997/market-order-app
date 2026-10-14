import { useState, useEffect, useRef } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { masterAPI } from '../../../api/master';
import { parseCsv, downloadCsv } from '../../../utils/csv';

export const UnitManagement = () => {
    const [units, setUnits] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({ name: '', abbreviation: '' });
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        fetchUnits();
    }, []);

    const fetchUnits = async () => {
        try {
            const data = await masterAPI.getUnits();
            setUnits(data);
        } catch (error) {
            console.error('Error fetching units:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (selectedId) {
                await masterAPI.updateUnit(selectedId, formData);
            } else {
                await masterAPI.createUnit(formData);
            }
            setIsModalOpen(false);
            fetchUnits();
            resetForm();
        } catch (error) {
            console.error('Error saving unit:', error);
            alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (row) => {
        if (confirm(`คุณต้องการลบหน่วยนับ "${row.name}" ใช่หรือไม่?`)) {
            try {
                await masterAPI.deleteUnit(row.id);
                fetchUnits();
            } catch (error) {
                console.error('Error deleting unit:', error);
                alert('เกิดข้อผิดพลาดในการลบข้อมูล');
            }
        }
    };

    const openEdit = (row) => {
        setFormData({ name: row.name, abbreviation: row.abbreviation });
        setSelectedId(row.id);
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({ name: '', abbreviation: '' });
        setSelectedId(null);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleDownloadData = () => {
        const headers = ['name', 'abbreviation'];
        const rows = units.map((unit) => [unit.name, unit.abbreviation]);
        downloadCsv('units_data.csv', headers, rows);
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
                    abbreviation: row.abbreviation
                }))
                .filter((row) => row.name && row.abbreviation);

            if (payloads.length === 0) {
                alert('ไม่พบข้อมูลที่นำเข้าได้');
                return;
            }

            const results = await Promise.allSettled(
                payloads.map((payload) => masterAPI.createUnit(payload))
            );
            const successCount = results.filter((r) => r.status === 'fulfilled').length;
            const failedCount = results.length - successCount;

            fetchUnits();
            alert(`นำเข้าเสร็จสิ้น สำเร็จ ${successCount} รายการ` + (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : ''));
        } catch (error) {
            console.error('Error importing units:', error);
            alert('นำเข้าไม่สำเร็จ');
        }
    };

    const columns = [
        { header: 'ชื่อหน่วยนับ', accessor: 'name' },
        { header: 'ตัวย่อ', accessor: 'abbreviation' }
    ];

    return (
        <Layout>
            <div className="max-w-6xl mx-auto">
                <div className="mb-3">
                    <BackToSettings />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">จัดการหน่วยนับ</h1>
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
                            เพิ่มหน่วยนับ
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
                    data={units}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                />

                <Modal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    title={selectedId ? 'แก้ไขหน่วยนับ' : 'เพิ่มหน่วยนับ'}
                >
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <Input
                            label="ชื่อหน่วยนับ"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                        />
                        <Input
                            label="ตัวย่อ"
                            value={formData.abbreviation}
                            onChange={(e) => setFormData({ ...formData, abbreviation: e.target.value })}
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
