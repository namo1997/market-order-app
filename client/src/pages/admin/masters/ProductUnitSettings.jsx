import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Input } from '../../../components/common/Input';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { masterAPI } from '../../../api/master';
import { productUnitSettingsAPI } from '../../../api/product-unit-settings';

const unitLabel = (unit) => {
  if (!unit) return '-';
  return unit.abbr ? `${unit.name} (${unit.abbr})` : unit.name;
};

const normalizeDraft = (row) => ({
  unit_id: row?.unit_id ? String(row.unit_id) : '',
  supplier_master_id: row?.supplier_master_id ? String(row.supplier_master_id) : '',
  purchase_unit_id: row?.purchase_unit_id ? String(row.purchase_unit_id) : '',
  purchase_to_base_multiplier:
    row?.purchase_to_base_multiplier === null || row?.purchase_to_base_multiplier === undefined
      ? ''
      : String(row.purchase_to_base_multiplier),
  stock_template_id: row?.stock_template_id ? String(row.stock_template_id) : '',
  check_input_unit_id: row?.check_input_unit_id ? String(row.check_input_unit_id) : '',
  check_to_base_multiplier:
    row?.check_to_base_multiplier === null || row?.check_to_base_multiplier === undefined
      ? ''
      : String(row.check_to_base_multiplier || 1)
});

export const ProductUnitSettings = () => {
  const [rows, setRows] = useState([]);
  const [units, setUnits] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [drafts, setDrafts] = useState({});

  const fetchMeta = async () => {
    const [unitData, supplierData] = await Promise.all([
      masterAPI.getUnits(),
      masterAPI.getSupplierMasters()
    ]);
    setUnits((Array.isArray(unitData) ? unitData : [])
      .map((unit) => ({
        id: Number(unit.id),
        name: unit.name || '',
        abbr: unit.abbreviation || unit.abbr || ''
      }))
      .filter((unit) => Number.isFinite(unit.id) && unit.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'th')));
    setSuppliers((Array.isArray(supplierData) ? supplierData : [])
      .map((supplier) => ({ id: Number(supplier.id), name: supplier.name || '' }))
      .filter((supplier) => Number.isFinite(supplier.id) && supplier.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'th')));
  };

  const fetchRows = async (nextSearch = search) => {
    try {
      setLoading(true);
      const data = await productUnitSettingsAPI.list({ search: nextSearch, limit: 500 });
      const list = Array.isArray(data) ? data : [];
      setRows(list);
      const nextDrafts = {};
      list.forEach((row) => { nextDrafts[row.id] = normalizeDraft(row); });
      setDrafts(nextDrafts);
    } catch (error) {
      console.error('Error loading product unit settings:', error);
      alert('โหลดตั้งค่าหน่วยสินค้าไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeta();
    fetchRows('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unitById = useMemo(() => {
    const map = new Map();
    units.forEach((unit) => map.set(String(unit.id), unit));
    return map;
  }, [units]);

  const handleDraftChange = (productId, key, value) => {
    setDrafts((prev) => ({
      ...prev,
      [productId]: {
        ...(prev[productId] || {}),
        [key]: value
      }
    }));
  };

  const handleSearch = (event) => {
    event.preventDefault();
    fetchRows(search);
  };

  const saveRow = async (row) => {
    const draft = drafts[row.id] || {};
    if (!draft.unit_id) {
      alert('กรุณาเลือกหน่วยฐานของสินค้า');
      return;
    }
    if (draft.purchase_unit_id && Number(draft.purchase_unit_id) !== Number(draft.unit_id) && !draft.purchase_to_base_multiplier) {
      alert('กรุณากรอกตัวคูณหน่วยซื้อ');
      return;
    }
    if (draft.check_input_unit_id && Number(draft.check_input_unit_id) !== Number(draft.unit_id) && !draft.check_to_base_multiplier) {
      alert('กรุณากรอกตัวคูณหน่วยนับสต๊อก');
      return;
    }

    try {
      setSavingId(row.id);
      await productUnitSettingsAPI.save(row.id, {
        ...draft,
        stock_template_id: row.stock_template_id || draft.stock_template_id || null
      });
      await fetchRows(search);
    } catch (error) {
      console.error('Error saving product unit setting:', error);
      alert(error?.response?.data?.message || 'บันทึกตั้งค่าหน่วยสินค้าไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-4">
        <BackToSettings />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Product Units</p>
            <h1 className="text-2xl font-bold text-slate-900">ตั้งค่าหน่วยสินค้า</h1>
            <p className="text-sm text-slate-500">ตั้งหน่วยฐาน หน่วยซื้อจากซัพ และหน่วยนับสต๊อกในหน้าเดียว</p>
          </div>
          <form onSubmit={handleSearch} className="flex gap-2 sm:w-[420px]">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาสินค้า / รหัส / ซัพ"
              className="w-full"
            />
            <Button type="submit" variant="secondary" disabled={loading}>ค้นหา</Button>
          </form>
        </div>

        <Card>
          <div className="mb-3 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
            <div className="rounded-2xl bg-blue-50 p-3"><b className="text-blue-700">หน่วยฐาน</b> คือหน่วยจริงที่เก็บสต๊อก</div>
            <div className="rounded-2xl bg-emerald-50 p-3"><b className="text-emerald-700">หน่วยซื้อ</b> ใช้ตอนรับ PO เช่น 1 แพ็ค = 50 ชิ้น</div>
            <div className="rounded-2xl bg-amber-50 p-3"><b className="text-amber-700">หน่วยนับสต๊อก</b> ใช้ตอน Stock Check</div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-[1180px] w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">สินค้า</th>
                  <th className="px-3 py-2 text-left">หน่วยฐาน</th>
                  <th className="px-3 py-2 text-left">ซัพหลัก</th>
                  <th className="px-3 py-2 text-left">หน่วยซื้อ</th>
                  <th className="px-3 py-2 text-center">คูณเข้าสต๊อก</th>
                  <th className="px-3 py-2 text-left">พื้นที่นับสต๊อก</th>
                  <th className="px-3 py-2 text-left">หน่วยนับ</th>
                  <th className="px-3 py-2 text-center">คูณเข้าหน่วยฐาน</th>
                  <th className="px-3 py-2 text-center">บันทึก</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan="9" className="px-3 py-8 text-center text-slate-400">กำลังโหลด...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan="9" className="px-3 py-8 text-center text-slate-400">ไม่พบสินค้า</td></tr>
                ) : rows.map((row) => {
                  const draft = drafts[row.id] || normalizeDraft(row);
                  const baseUnit = unitById.get(String(draft.unit_id));
                  const purchaseUnit = unitById.get(String(draft.purchase_unit_id));
                  const checkUnit = unitById.get(String(draft.check_input_unit_id));
                  return (
                    <tr key={row.id} className="align-top hover:bg-slate-50/70">
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-900">{row.name}</div>
                        <div className="text-xs text-slate-400">{row.code || '-'} {row.product_group_name ? `• ${row.product_group_name}` : ''}</div>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={draft.unit_id}
                          onChange={(e) => handleDraftChange(row.id, 'unit_id', e.target.value)}
                          className="w-36 rounded-xl border border-slate-200 px-2 py-2 text-sm"
                        >
                          <option value="">เลือกหน่วย</option>
                          {units.map((unit) => <option key={unit.id} value={unit.id}>{unitLabel(unit)}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={draft.supplier_master_id}
                          onChange={(e) => handleDraftChange(row.id, 'supplier_master_id', e.target.value)}
                          className="w-44 rounded-xl border border-slate-200 px-2 py-2 text-sm"
                        >
                          <option value="">ไม่ระบุ</option>
                          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={draft.purchase_unit_id}
                          onChange={(e) => {
                            const value = e.target.value;
                            handleDraftChange(row.id, 'purchase_unit_id', value);
                            if (value && Number(value) === Number(draft.unit_id)) {
                              handleDraftChange(row.id, 'purchase_to_base_multiplier', '1');
                            }
                          }}
                          className="w-36 rounded-xl border border-slate-200 px-2 py-2 text-sm"
                          disabled={!draft.supplier_master_id}
                        >
                          <option value="">เหมือนหน่วยฐาน</option>
                          {units.map((unit) => <option key={unit.id} value={unit.id}>{unitLabel(unit)}</option>)}
                        </select>
                        <div className="mt-1 text-[11px] text-slate-400">{purchaseUnit ? unitLabel(purchaseUnit) : unitLabel(baseUnit)}</div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={draft.purchase_to_base_multiplier}
                          onChange={(e) => handleDraftChange(row.id, 'purchase_to_base_multiplier', e.target.value)}
                          placeholder="1"
                          disabled={!draft.supplier_master_id || !draft.purchase_unit_id}
                          className="w-24 rounded-xl border border-slate-200 px-2 py-2 text-center text-sm disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {row.stock_template_id
                          ? `${row.stock_branch_name || '-'} / ${row.stock_department_name || '-'}`
                          : 'ยังไม่อยู่ในสินค้าประจำหมวด'}
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={draft.check_input_unit_id}
                          onChange={(e) => {
                            const value = e.target.value;
                            handleDraftChange(row.id, 'check_input_unit_id', value);
                            if (value && Number(value) === Number(draft.unit_id)) {
                              handleDraftChange(row.id, 'check_to_base_multiplier', '1');
                            }
                          }}
                          className="w-36 rounded-xl border border-slate-200 px-2 py-2 text-sm"
                          disabled={!row.stock_template_id}
                        >
                          <option value="">เหมือนหน่วยฐาน</option>
                          {units.map((unit) => <option key={unit.id} value={unit.id}>{unitLabel(unit)}</option>)}
                        </select>
                        <div className="mt-1 text-[11px] text-slate-400">{checkUnit ? unitLabel(checkUnit) : unitLabel(baseUnit)}</div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={draft.check_to_base_multiplier}
                          onChange={(e) => handleDraftChange(row.id, 'check_to_base_multiplier', e.target.value)}
                          placeholder="1"
                          disabled={!row.stock_template_id || !draft.check_input_unit_id}
                          className="w-24 rounded-xl border border-slate-200 px-2 py-2 text-center text-sm disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Button
                          onClick={() => saveRow(row)}
                          disabled={savingId === row.id}
                          className="px-4"
                        >
                          {savingId === row.id ? '...' : 'บันทึก'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Layout>
  );
};
