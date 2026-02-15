import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Input } from '../../components/common/Input';
import { Select } from '../../components/common/Select';
import { productsAPI } from '../../api/products';
import { inventoryAPI } from '../../api/inventory';
import { useAuth } from '../../contexts/AuthContext';

const EMPTY_ROW = { product_id: '', quantity: '' };

export const ProductionTransform = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [outputProductId, setOutputProductId] = useState('');
  const [outputQuantity, setOutputQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([{ ...EMPTY_ROW }]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState(null);

  const departmentId = user?.department_id ? Number(user.department_id) : null;

  const loadData = async () => {
    if (!departmentId) return;
    try {
      setLoading(true);
      const [productsRes, balanceRes] = await Promise.all([
        productsAPI.getProducts(),
        inventoryAPI.getBalances({ departmentId })
      ]);
      const productData = productsRes?.data ?? productsRes ?? [];
      setProducts(Array.isArray(productData) ? productData : []);
      setBalances(Array.isArray(balanceRes) ? balanceRes : []);
    } catch (error) {
      console.error('Error loading transform data:', error);
      alert('โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [departmentId]);

  const stockMap = useMemo(() => {
    const map = new Map();
    for (const row of balances) {
      map.set(Number(row.product_id), Number(row.quantity || 0));
    }
    return map;
  }, [balances]);

  const productOptions = useMemo(
    () =>
      products.map((product) => ({
        value: String(product.id),
        label: `${product.name}${product.code ? ` (${product.code})` : ''}`
      })),
    [products]
  );

  const getProductName = (productId) => {
    const found = products.find((item) => String(item.id) === String(productId));
    return found?.name || '-';
  };

  const addRow = () => setRows((prev) => [...prev, { ...EMPTY_ROW }]);

  const removeRow = (index) =>
    setRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index));

  const updateRow = (index, key, value) =>
    setRows((prev) =>
      prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row))
    );

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!departmentId) {
      alert('ไม่พบแผนกผู้ใช้งาน');
      return;
    }

    const normalizedOutputQty = Number(outputQuantity);
    const normalizedRows = rows
      .map((row) => ({
        product_id: Number(row.product_id),
        quantity: Number(row.quantity)
      }))
      .filter((row) => Number.isFinite(row.product_id) && Number.isFinite(row.quantity) && row.quantity > 0);

    if (!outputProductId || !Number.isFinite(normalizedOutputQty) || normalizedOutputQty <= 0) {
      alert('กรุณาเลือกสินค้าปลายทางและจำนวนผลิตให้ถูกต้อง');
      return;
    }
    if (normalizedRows.length === 0) {
      alert('กรุณาเพิ่มวัตถุดิบอย่างน้อย 1 รายการ');
      return;
    }

    setSaving(true);
    try {
      const response = await inventoryAPI.createProductionTransform({
        department_id: departmentId,
        output_product_id: Number(outputProductId),
        output_quantity: normalizedOutputQty,
        ingredients: normalizedRows,
        notes
      });
      setSummary(response?.data || null);
      setOutputQuantity('');
      setNotes('');
      setRows([{ ...EMPTY_ROW }]);
      await loadData();
    } catch (error) {
      console.error('Error creating production transform:', error);
      alert(error?.response?.data?.message || 'บันทึกการแปรรูปไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← กลับหน้าเลือกฟังก์ชั่น
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h1 className="text-xl font-bold text-gray-900">แปรรูปสินค้า</h1>
          <p className="text-sm text-gray-600">
            ตัดวัตถุดิบจากสต็อก และเพิ่มสินค้าสำเร็จเข้าในครั้งเดียว
          </p>
          <p className="text-xs text-gray-500 mt-1">
            แผนก: {user?.department || '-'} • สาขา: {user?.branch || '-'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="สินค้าปลายทาง (ได้จากการแปรรูป)"
              value={outputProductId}
              onChange={(event) => setOutputProductId(event.target.value)}
              options={productOptions}
              required
              disabled={loading || saving}
            />
            <Input
              label="จำนวนที่ผลิต"
              type="number"
              min="0"
              step="0.01"
              value={outputQuantity}
              onChange={(event) => setOutputQuantity(event.target.value)}
              required
              disabled={loading || saving}
            />
          </div>

          {outputProductId && (
            <div className="text-xs text-gray-600 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              คงเหลือสินค้าปลายทางปัจจุบัน: {stockMap.get(Number(outputProductId)) ?? 0}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">วัตถุดิบที่ใช้</h2>
              <button
                type="button"
                onClick={addRow}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm hover:bg-slate-50"
                disabled={saving}
              >
                เพิ่มวัตถุดิบ
              </button>
            </div>

            {rows.map((row, index) => (
              <div key={`ingredient-${index}`} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-2 items-end">
                <Select
                  label={index === 0 ? 'สินค้า' : undefined}
                  value={row.product_id}
                  onChange={(event) => updateRow(index, 'product_id', event.target.value)}
                  options={productOptions}
                  placeholder="เลือกวัตถุดิบ"
                  disabled={loading || saving}
                />
                <Input
                  label={index === 0 ? 'จำนวนที่ใช้' : undefined}
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.quantity}
                  onChange={(event) => updateRow(index, 'quantity', event.target.value)}
                  placeholder="0"
                  disabled={saving}
                />
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="h-10 px-3 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  disabled={rows.length <= 1 || saving}
                >
                  ลบ
                </button>
                {row.product_id && (
                  <div className="sm:col-span-3 text-xs text-gray-500">
                    คงเหลือปัจจุบัน {getProductName(row.product_id)}: {stockMap.get(Number(row.product_id)) ?? 0}
                  </div>
                )}
              </div>
            ))}
          </div>

          <Input
            label="หมายเหตุ"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="เช่น แปรรูปสำหรับรอบเช้า"
            disabled={saving}
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || loading}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกการแปรรูป'}
            </button>
          </div>
        </form>

        {summary && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div className="font-semibold">บันทึกเรียบร้อย</div>
            <div>เลขอ้างอิง: {summary.reference_id}</div>
            <div>
              สินค้าปลายทาง: {summary.output?.product_name} +{summary.output?.quantity}
            </div>
            <div>วัตถุดิบที่ตัด: {Array.isArray(summary.ingredients) ? summary.ingredients.length : 0} รายการ</div>
          </div>
        )}
      </div>
    </Layout>
  );
};
