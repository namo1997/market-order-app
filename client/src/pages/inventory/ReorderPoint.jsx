import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { inventoryAPI } from '../../api/inventory';

const WINDOW_OPTIONS = [
  { label: '1 สัปดาห์', value: 7 },
  { label: '2 สัปดาห์', value: 14 },
  { label: '4 สัปดาห์', value: 28 }
];

const formatNumber = (value, digits = 2) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(num);
};

const parseNullableNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const ReorderPoint = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(null);
  const [windowDays, setWindowDays] = useState(7);
  const [departmentId, setDepartmentId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [form, setForm] = useState({
    lead_time_days: '1',
    safety_stock_days: '0.8',
    min_quantity: '',
    max_quantity: ''
  });

  const loadOverview = async (nextDepartmentId, nextWindowDays, keepSelectedId) => {
    try {
      setLoading(true);
      setError('');

      const data = await inventoryAPI.getRopOverview({
        departmentId: nextDepartmentId || undefined,
        windowDays: nextWindowDays || windowDays
      });

      setOverview(data);
      setDepartmentId(String(data.department_id || ''));
      setWindowDays(Number(data.window_days || 7));

      const fallbackProductId = data.items?.[0]?.product_id || null;
      const targetSelected = keepSelectedId || selectedProductId || fallbackProductId;
      const matched = data.items?.find((item) => Number(item.product_id) === Number(targetSelected));
      const finalSelected = matched?.product_id || fallbackProductId;
      setSelectedProductId(finalSelected);

      if (matched || data.items?.length > 0) {
        const source = matched || data.items[0];
        setForm({
          lead_time_days: String(source.lead_time_days ?? data.defaults?.lead_time_days ?? 1),
          safety_stock_days: String(source.safety_stock_days ?? data.defaults?.safety_stock_days ?? 0.8),
          min_quantity: source.min_quantity ?? source.min_quantity === 0 ? String(source.min_quantity) : '',
          max_quantity: source.max_quantity ?? source.max_quantity === 0 ? String(source.max_quantity) : ''
        });
      }
    } catch (err) {
      console.error('Error loading ROP overview:', err);
      setError(err?.response?.data?.message || 'โหลดข้อมูล ROP ไม่สำเร็จ');
      setOverview(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview('', 7, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedItem = useMemo(() => {
    if (!overview?.items?.length) return null;
    return overview.items.find((item) => Number(item.product_id) === Number(selectedProductId)) || null;
  }, [overview, selectedProductId]);

  useEffect(() => {
    if (!selectedItem) return;
    setForm({
      lead_time_days: String(selectedItem.lead_time_days ?? overview?.defaults?.lead_time_days ?? 1),
      safety_stock_days: String(selectedItem.safety_stock_days ?? overview?.defaults?.safety_stock_days ?? 0.8),
      min_quantity:
        selectedItem.min_quantity ?? selectedItem.min_quantity === 0 ? String(selectedItem.min_quantity) : '',
      max_quantity:
        selectedItem.max_quantity ?? selectedItem.max_quantity === 0 ? String(selectedItem.max_quantity) : ''
    });
  }, [overview?.defaults?.lead_time_days, overview?.defaults?.safety_stock_days, selectedItem]);

  const handleSave = async () => {
    if (!selectedItem || !departmentId) return;

    const leadTime = Number(form.lead_time_days);
    const safetyDays = Number(form.safety_stock_days);
    const minQty = parseNullableNumber(form.min_quantity);
    const maxQty = parseNullableNumber(form.max_quantity);

    if (!Number.isFinite(leadTime) || leadTime < 0) {
      alert('Lead time ต้องเป็นตัวเลขและต้องไม่ติดลบ');
      return;
    }

    if (!Number.isFinite(safetyDays) || safetyDays < 0) {
      alert('Safety stock (วัน) ต้องเป็นตัวเลขและต้องไม่ติดลบ');
      return;
    }

    if (minQty !== null && maxQty !== null && minQty > maxQty) {
      alert('Min ต้องไม่มากกว่า Max');
      return;
    }

    if (Number(selectedItem.avg_daily_usage || 0) === 0 && (minQty === null || maxQty === null)) {
      alert('สินค้าที่ยังไม่มีประวัติใช้ย้อนหลัง ต้องตั้ง Min และ Max ก่อน');
      return;
    }

    try {
      setSaving(true);
      await inventoryAPI.saveRopSetting({
        department_id: Number(departmentId),
        product_id: Number(selectedItem.product_id),
        lead_time_days: leadTime,
        safety_stock_days: safetyDays,
        min_quantity: minQty,
        max_quantity: maxQty
      });
      await loadOverview(Number(departmentId), Number(windowDays), Number(selectedItem.product_id));
    } catch (err) {
      console.error('Error saving ROP setting:', err);
      alert(err?.response?.data?.message || 'บันทึกค่า ROP ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const dangerItems = useMemo(
    () => (overview?.items || []).filter((item) => Number(item.current_quantity) <= Number(item.rop_quantity)).length,
    [overview?.items]
  );
  const missingMinMaxCount = useMemo(
    () => (overview?.items || []).filter((item) => item.requires_min_max).length,
    [overview?.items]
  );

  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">จุดสั่งผลิต (ROP)</h1>
          <Button variant="secondary" onClick={() => navigate('/admin/settings')}>
            ← กลับหน้าตั้งค่า
          </Button>
        </div>

        <Card className="p-6">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-700 leading-6">
              คำนวณจาก <strong>โอนออก</strong> ย้อนหลังตามช่วงที่เลือก โดยใช้สูตร
              {' '}
              <strong>ROP = (เฉลี่ยใช้ต่อวัน × Lead time) + Safety stock</strong>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">แผนกฝ่ายผลิต</label>
                <select
                  value={departmentId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDepartmentId(next);
                    loadOverview(Number(next), Number(windowDays), null);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {(overview?.departments || []).map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name} • {dept.branch_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">ช่วงเฉลี่ยย้อนหลัง</label>
                <div className="flex flex-wrap gap-2">
                  {WINDOW_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setWindowDays(option.value);
                        loadOverview(Number(departmentId || 0), option.value, selectedProductId);
                      }}
                      className={`px-3 py-2 rounded-lg text-sm border transition ${
                        Number(windowDays) === option.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {loading && <Loading message="กำลังโหลดข้อมูล ROP..." />}

        {!loading && error && (
          <Card className="p-4 border border-red-200 bg-red-50 text-red-700 text-sm">{error}</Card>
        )}

        {!loading && !error && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card className="p-4">
                <p className="text-xs text-gray-500">จำนวนสินค้าที่แสดง</p>
                <p className="text-2xl font-bold text-gray-900">{overview?.items?.length || 0}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">ต่ำกว่า/เท่าจุด ROP</p>
                <p className="text-2xl font-bold text-amber-600">{dangerItems}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500">ยังไม่มีประวัติใช้ (ต้องตั้ง Min/Max)</p>
                <p className="text-2xl font-bold text-rose-600">{missingMinMaxCount}</p>
              </Card>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <Card className="xl:col-span-2 p-0 overflow-hidden">
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-left text-gray-600">
                        <th className="px-3 py-2 font-semibold">สินค้า</th>
                        <th className="px-3 py-2 font-semibold text-right">คงเหลือ</th>
                        <th className="px-3 py-2 font-semibold text-right">เฉลี่ย/วัน</th>
                        <th className="px-3 py-2 font-semibold text-right">ROP</th>
                        <th className="px-3 py-2 font-semibold">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(overview?.items || []).map((item) => {
                        const isSelected = Number(selectedProductId) === Number(item.product_id);
                        const unit = item.unit_abbreviation || item.unit_name || '';
                        return (
                          <tr
                            key={item.product_id}
                            onClick={() => setSelectedProductId(item.product_id)}
                            className={`border-t cursor-pointer ${
                              isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-900">{item.product_name}</div>
                              <div className="text-xs text-gray-500">{item.product_code || '-'}</div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatNumber(item.current_quantity)} {unit}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatNumber(item.avg_daily_usage, 3)} {unit}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatNumber(item.rop_quantity)} {unit}
                            </td>
                            <td className="px-3 py-2">
                              {item.requires_min_max ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-rose-100 text-rose-700">
                                  ต้องตั้ง Min/Max
                                </span>
                              ) : item.should_produce ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">
                                  ควรสั่งผลิต
                                </span>
                              ) : (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">
                                  ปกติ
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {(overview?.items || []).length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                            ไม่พบสินค้าในแผนกฝ่ายผลิตนี้
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="p-4 space-y-3">
                <h2 className="text-lg font-semibold text-gray-900">การ์ดตั้งค่า ROP</h2>
                {!selectedItem ? (
                  <p className="text-sm text-gray-500">เลือกสินค้า 1 รายการจากตารางด้านซ้าย</p>
                ) : (
                  <>
                    <div>
                      <p className="font-semibold text-gray-900">{selectedItem.product_name}</p>
                      <p className="text-xs text-gray-500">
                        {selectedItem.product_code || '-'} • {selectedItem.unit_abbreviation || selectedItem.unit_name || '-'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg bg-gray-50 p-2">
                        <p className="text-xs text-gray-500">เฉลี่ยใช้/วัน</p>
                        <p className="font-semibold text-gray-900">
                          {formatNumber(selectedItem.avg_daily_usage, 3)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <p className="text-xs text-gray-500">คงเหลือปัจจุบัน</p>
                        <p className="font-semibold text-gray-900">
                          {formatNumber(selectedItem.current_quantity)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Lead time (วัน)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={form.lead_time_days}
                          onChange={(e) => setForm((prev) => ({ ...prev, lead_time_days: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Safety stock (วัน)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={form.safety_stock_days}
                          onChange={(e) => setForm((prev) => ({ ...prev, safety_stock_days: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Min {Number(selectedItem.avg_daily_usage || 0) === 0 ? '*' : ''}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={form.min_quantity}
                          onChange={(e) => setForm((prev) => ({ ...prev, min_quantity: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Max {Number(selectedItem.avg_daily_usage || 0) === 0 ? '*' : ''}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={form.max_quantity}
                          onChange={(e) => setForm((prev) => ({ ...prev, max_quantity: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-800">
                      สูตร: ROP = (เฉลี่ย/วัน × Lead time) + (เฉลี่ย/วัน × Safety stock)
                      <br />
                      ค่าปัจจุบัน: {formatNumber(selectedItem.rop_quantity)} {selectedItem.unit_abbreviation || selectedItem.unit_name || ''}
                    </div>

                    <div className="text-xs text-gray-500">
                      อัปเดตล่าสุด:{' '}
                      {selectedItem.updated_at
                        ? `${new Date(selectedItem.updated_at).toLocaleString('th-TH')} โดย ${selectedItem.updated_by_name || '-'}`
                        : 'ยังไม่เคยตั้งค่า'}
                    </div>

                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? 'กำลังบันทึก...' : 'บันทึกค่า ROP'}
                    </Button>
                  </>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};
