import { useEffect, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { masterAPI } from '../../../api/master';

export const SupplierMasterManagement = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    contact_person: '',
    phone: '',
    address: '',
    line_id: ''
  });

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    try {
      const data = await masterAPI.getSupplierMasters();
      setSuppliers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching supplier masters:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      contact_person: '',
      phone: '',
      address: '',
      line_id: ''
    });
    setSelectedId(null);
  };

  const openEdit = (row) => {
    setFormData({
      name: row.name || '',
      code: row.code || '',
      contact_person: row.contact_person || '',
      phone: row.phone || '',
      address: row.address || '',
      line_id: row.line_id || ''
    });
    setSelectedId(row.id);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (selectedId) {
        await masterAPI.updateSupplierMaster(selectedId, formData);
      } else {
        await masterAPI.createSupplierMaster(formData);
      }
      setIsModalOpen(false);
      resetForm();
      fetchSuppliers();
    } catch (error) {
      console.error('Error saving supplier master:', error);
      alert('บันทึกซัพพลายเออร์ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (row) => {
    if (!confirm(`ต้องการลบซัพพลายเออร์ "${row.name}" ใช่หรือไม่?`)) return;

    try {
      await masterAPI.deleteSupplierMaster(row.id);
      fetchSuppliers();
    } catch (error) {
      console.error('Error deleting supplier master:', error);
      alert('ลบซัพพลายเออร์ไม่สำเร็จ');
    }
  };

  const columns = [
    { header: 'รหัส', accessor: 'code' },
    { header: 'ชื่อซัพพลายเออร์', accessor: 'name' },
    { header: 'ผู้ติดต่อ', accessor: 'contact_person' },
    { header: 'เบอร์โทร', accessor: 'phone' },
    { header: 'Line ID', accessor: 'line_id' },
    {
      header: 'ที่อยู่',
      accessor: 'address',
      wrap: true,
      render: (row) => row.address || '-'
    }
  ];

  return (
    <Layout mainClassName="!max-w-none">
      <div className="w-full">
        <div className="mb-3">
          <BackToSettings />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">จัดการซัพพลายเออร์</h1>
          <button
            onClick={() => {
              resetForm();
              setIsModalOpen(true);
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            เพิ่มซัพพลายเออร์
          </button>
        </div>

        <DataTable
          columns={columns}
          data={suppliers}
          onEdit={openEdit}
          onDelete={handleDelete}
        />

        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={selectedId ? 'แก้ไขซัพพลายเออร์' : 'เพิ่มซัพพลายเออร์'}
          size="xlarge"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="รหัส"
                value={formData.code}
                onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="เว้นว่างให้ระบบกำหนด"
              />
              <Input
                label="ชื่อซัพพลายเออร์"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="ผู้ติดต่อ"
                value={formData.contact_person}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, contact_person: e.target.value }))
                }
              />
              <Input
                label="เบอร์โทร"
                value={formData.phone}
                onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Line ID"
                value={formData.line_id}
                onChange={(e) => setFormData((prev) => ({ ...prev, line_id: e.target.value }))}
              />
              <Input
                label="ที่อยู่"
                value={formData.address}
                onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
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
