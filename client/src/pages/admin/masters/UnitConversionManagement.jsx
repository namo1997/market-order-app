import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { Select } from '../../../components/common/Select';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { masterAPI } from '../../../api/master';
import { unitConversionsAPI } from '../../../api/unit-conversions';

export const UnitConversionManagement = () => {
  const [conversions, setConversions] = useState([]);
  const [units, setUnits] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [prefillContext, setPrefillContext] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    from_unit_id: '',
    to_unit_id: '',
    multiplier: ''
  });

  useEffect(() => {
    fetchConversions();
    fetchUnits();
  }, []);

  useEffect(() => {
    const prefill = location.state?.prefill;
    if (!prefill) return;
    setSelectedId(null);
    setFormData({
      from_unit_id: prefill.from_unit_id ? String(prefill.from_unit_id) : '',
      to_unit_id: prefill.to_unit_id ? String(prefill.to_unit_id) : '',
      multiplier: prefill.multiplier ?? ''
    });
    setPrefillContext(location.state?.context || null);
    setIsModalOpen(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const fetchConversions = async () => {
    try {
      const data = await unitConversionsAPI.getConversions();
      setConversions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching conversions:', error);
      setConversions([]);
    }
  };

  const fetchUnits = async () => {
    try {
      const data = await masterAPI.getUnits();
      setUnits(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching units:', error);
      setUnits([]);
    }
  };

  const openCreate = () => {
    setSelectedId(null);
    setFormData({ from_unit_id: '', to_unit_id: '', multiplier: '' });
    setPrefillContext(null);
    setIsModalOpen(true);
  };

  const openEdit = (row) => {
    setSelectedId(row.id);
    setFormData({
      from_unit_id: row.from_unit_id,
      to_unit_id: row.to_unit_id,
      multiplier: row.multiplier
    });
    setPrefillContext(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (row) => {
    if (!confirm(`ลบการแปลงหน่วย ${row.from_unit_name} → ${row.to_unit_name} ใช่หรือไม่?`)) {
      return;
    }
    try {
      await unitConversionsAPI.deleteConversion(row.id);
      fetchConversions();
    } catch (error) {
      console.error('Error deleting conversion:', error);
      alert('ลบข้อมูลไม่สำเร็จ');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData.from_unit_id || !formData.to_unit_id || formData.multiplier === '') {
      alert('กรุณากรอกข้อมูลให้ครบ');
      return;
    }
    if (String(formData.from_unit_id) === String(formData.to_unit_id)) {
      alert('หน่วยต้นทางและปลายทางต้องไม่เหมือนกัน');
      return;
    }

    try {
      setLoading(true);
      if (selectedId) {
        await unitConversionsAPI.updateConversion(selectedId, {
          multiplier: Number(formData.multiplier)
        });
      } else {
        await unitConversionsAPI.createConversion({
          from_unit_id: Number(formData.from_unit_id),
          to_unit_id: Number(formData.to_unit_id),
          multiplier: Number(formData.multiplier)
        });
      }
      setIsModalOpen(false);
      fetchConversions();
    } catch (error) {
      console.error('Error saving conversion:', error);
      alert('บันทึกข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const unitOptions = useMemo(
    () =>
      units.map((unit) => ({
        value: unit.id,
        label: unit.abbreviation ? `${unit.name} (${unit.abbreviation})` : unit.name
      })),
    [units]
  );

  const columns = [
    {
      header: 'จากหน่วย',
      accessor: 'from_unit_name',
      render: (row) => row.from_unit_abbr ? `${row.from_unit_name} (${row.from_unit_abbr})` : row.from_unit_name
    },
    {
      header: 'ไปหน่วย',
      accessor: 'to_unit_name',
      render: (row) => row.to_unit_abbr ? `${row.to_unit_name} (${row.to_unit_abbr})` : row.to_unit_name
    },
    { header: 'ตัวคูณ', accessor: 'multiplier' }
  ];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-3">
          <BackToSettings />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ตั้งค่าแปลงหน่วย</h1>
            <p className="text-sm text-gray-500 mt-1">
              ใช้สำหรับคำนวณวัตถุดิบที่ใช้จริงจากสูตรเมนู
            </p>
          </div>
          <button
            onClick={openCreate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            เพิ่มการแปลงหน่วย
          </button>
        </div>

        <DataTable
          columns={columns}
          data={conversions}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedId ? 'แก้ไขการแปลงหน่วย' : 'เพิ่มการแปลงหน่วย'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {prefillContext && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              จากรายงานวัตถุดิบ: {prefillContext.product_name || 'รายการ'}{' '}
              {prefillContext.menu_barcode ? `(เมนู ${prefillContext.menu_barcode})` : ''}
            </div>
          )}
          <Select
            label="จากหน่วย"
            value={formData.from_unit_id}
            onChange={(e) => setFormData({ ...formData, from_unit_id: e.target.value })}
            options={unitOptions}
            placeholder="เลือกหน่วยต้นทาง"
            disabled={Boolean(selectedId)}
          />
          <Select
            label="ไปหน่วย"
            value={formData.to_unit_id}
            onChange={(e) => setFormData({ ...formData, to_unit_id: e.target.value })}
            options={unitOptions}
            placeholder="เลือกหน่วยปลายทาง"
            disabled={Boolean(selectedId)}
          />
          <Input
            label="ตัวคูณ"
            type="number"
            step="0.0001"
            min="0"
            value={formData.multiplier}
            onChange={(e) => setFormData({ ...formData, multiplier: e.target.value })}
            placeholder="เช่น 1000"
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
    </Layout>
  );
};
