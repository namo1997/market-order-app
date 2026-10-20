import { useEffect, useMemo, useState } from 'react';
import { inventoryAPI } from '../../api/inventory';
import { masterAPI } from '../../api/master';
import { formatNumber } from '../../utils/usage-unit';

const unitText = (name, abbr) => (abbr && abbr !== name ? `${name} (${abbr})` : name || '-');

const toDraft = (row) => ({
  usage_unit_id: row.usage_unit_id ? String(row.usage_unit_id) : '',
  usage_per_base: row.usage_per_base ? String(row.usage_per_base) : ''
});

// แท็บตั้งค่าหน่วยใช้ในหน้าแปรรูป: แสดงเฉพาะวัตถุดิบในสูตรแปรรูปของแผนกนี้
export const ProductionUsageUnitTab = ({ departmentId, onSaved }) => {
  const [rows, setRows] = useState([]);
  const [units, setUnits] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState({});

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [list, unitList] = await Promise.all([
        inventoryAPI.getProductionUsageUnits({ departmentId }),
        masterAPI.getUnits()
      ]);
      const data = Array.isArray(list) ? list : [];
      setRows(data);
      setDrafts(Object.fromEntries(data.map((row) => [row.product_id, toDraft(row)])));
      setUnits((Array.isArray(unitList) ? unitList : [])
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'th')));
    } catch (loadError) {
      setError(loadError?.response?.data?.message || 'โหลดรายการวัตถุดิบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (departmentId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  const unitById = useMemo(() => new Map(units.map((unit) => [String(unit.id), unit])), [units]);
  const keyword = search.trim().toLowerCase();
  const visibleRows = rows.filter((row) => !keyword
    || String(row.product_name || '').toLowerCase().includes(keyword)
    || String(row.product_code || '').toLowerCase().includes(keyword));

  const setDraft = (productId, key, value) => {
    setDrafts((prev) => ({ ...prev, [productId]: { ...prev[productId], [key]: value } }));
    setMessages((prev) => ({ ...prev, [productId]: null }));
  };

  const save = async (row) => {
    const draft = drafts[row.product_id] || toDraft(row);
    const usesUnit = draft.usage_unit_id && Number(draft.usage_unit_id) !== Number(row.base_unit_id);
    if (usesUnit && !(Number(draft.usage_per_base) > 0)) {
      setMessages((prev) => ({ ...prev, [row.product_id]: { type: 'error', text: 'กรุณากรอกจำนวนให้มากกว่า 0' } }));
      return;
    }
    setSavingId(row.product_id);
    try {
      const result = await inventoryAPI.saveProductionUsageUnit(row.product_id, {
        department_id: departmentId,
        usage_unit_id: usesUnit ? Number(draft.usage_unit_id) : '',
        usage_per_base: usesUnit ? Number(draft.usage_per_base) : ''
      });
      const updated = result?.data || row;
      setRows((prev) => prev.map((item) => (item.product_id === row.product_id ? { ...item, ...updated } : item)));
      setDrafts((prev) => ({ ...prev, [row.product_id]: toDraft(updated) }));
      setMessages((prev) => ({ ...prev, [row.product_id]: { type: 'success', text: result?.message || 'บันทึกแล้ว' } }));
      onSaved?.();
    } catch (saveError) {
      setMessages((prev) => ({
        ...prev,
        [row.product_id]: { type: 'error', text: saveError?.response?.data?.message || 'บันทึกไม่สำเร็จ' }
      }));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">ตั้งค่าแปลงหน่วยวัตถุดิบ</h2>
        <p className="text-xs text-gray-500 mt-1">
          แสดงเฉพาะวัตถุดิบในสูตรแปรรูปของแผนกนี้ ตั้งหน่วยที่ใช้กรอกตอนแปรรูป เช่น 1 แกลลอน = 4,500 มล.
          สต๊อก การสั่งของ และการเบิกยังเป็นหน่วยฐานเหมือนเดิม ค่านี้ใช้กับทุกแผนกที่ใช้วัตถุดิบตัวเดียวกัน
        </p>
      </div>

      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="ค้นหาวัตถุดิบ"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
      />

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error} <button type="button" onClick={load} className="underline">ลองอีกครั้ง</button>
        </div>
      )}

      {loading ? (
        <p className="py-6 text-center text-sm text-gray-500">กำลังโหลด...</p>
      ) : visibleRows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          {rows.length === 0 ? 'แผนกนี้ยังไม่มีวัตถุดิบในสูตรแปรรูป' : 'ไม่พบวัตถุดิบที่ค้นหา'}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">แสดง {visibleRows.length} จาก {rows.length} รายการ</p>
          {visibleRows.map((row) => {
            const draft = drafts[row.product_id] || toDraft(row);
            const baseLabel = unitText(row.base_unit_name, row.base_unit_abbr);
            const usageUnit = unitById.get(String(draft.usage_unit_id));
            const usesUnit = Boolean(draft.usage_unit_id) && Number(draft.usage_unit_id) !== Number(row.base_unit_id);
            const perBase = Number(draft.usage_per_base);
            const message = messages[row.product_id];
            return (
              <div key={row.product_id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div>
                  <p className="font-semibold text-gray-900">{row.product_name}</p>
                  <p className="text-xs text-gray-500">
                    {row.product_code || '-'} • หน่วยฐาน (สต๊อก): {baseLabel}
                  </p>
                  {row.used_in && <p className="text-xs text-gray-400 mt-0.5">ใช้ใน: {row.used_in}</p>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <label className="block">
                    <span className="block text-xs text-gray-600 mb-1">หน่วยที่กรอกตอนแปรรูป</span>
                    <select
                      value={draft.usage_unit_id}
                      onChange={(event) => setDraft(row.product_id, 'usage_unit_id', event.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm"
                      disabled={savingId === row.product_id}
                    >
                      <option value="">เหมือนหน่วยฐาน ({row.base_unit_abbr || row.base_unit_name || '-'})</option>
                      {units
                        .filter((unit) => Number(unit.id) !== Number(row.base_unit_id))
                        .map((unit) => (
                          <option key={unit.id} value={unit.id}>{unitText(unit.name, unit.abbreviation)}</option>
                        ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-xs text-gray-600 mb-1">
                      1 {row.base_unit_abbr || row.base_unit_name || 'หน่วยฐาน'} = กี่ {usageUnit?.abbreviation || usageUnit?.name || 'หน่วยใช้'}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={draft.usage_per_base}
                      onChange={(event) => setDraft(row.product_id, 'usage_per_base', event.target.value)}
                      placeholder="เช่น 4500"
                      disabled={!usesUnit || savingId === row.product_id}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => save(row)}
                    disabled={savingId === row.product_id}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300"
                  >
                    {savingId === row.product_id ? 'กำลังบันทึก...' : 'บันทึก'}
                  </button>
                </div>
                {usesUnit && perBase > 0 && (
                  <p className="text-xs text-violet-700">
                    1 {row.base_unit_name} = {formatNumber(perBase)} {usageUnit?.name} (ระบบตัดสต๊อกเป็น{row.base_unit_name} ปัดทศนิยม 2 ตำแหน่ง)
                  </p>
                )}
                {message && (
                  <p role={message.type === 'error' ? 'alert' : 'status'} className={`text-xs ${message.type === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
                    {message.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
