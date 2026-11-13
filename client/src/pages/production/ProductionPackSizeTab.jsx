import { useMemo, useState } from 'react';
import { productPackSizesAPI } from '../../api/productPackSizes';

// ตั้งค่า "บรรจุแพ็คละ": สินค้าที่ตั้งไว้ พิมพ์สติกเกอร์ 1 ดวงต่อแพ็ค และสแกน 1 ดวงนับเท่าจำนวนในแพ็ค
const PackRow = ({ product, pack, onSaved }) => {
  const [size, setSize] = useState(pack ? String(pack.pack_size) : '');
  // ยังไม่ตั้งแพ็ค = ช่องว่าง (ไม่เติม "ถุง" ให้ทุกสินค้า) มีแค่ตัวอย่างจาง ๆ
  const [label, setLabel] = useState(pack?.pack_unit_label || '');
  const [saving, setSaving] = useState(false);
  // ยังไม่ตั้ง: ซ่อนช่องกรอก แสดงแค่ปุ่ม "ตั้งแพ็ค" (ไม่ให้ทุกบรรทัดขึ้นต้นด้วยหน่วยแพ็ค)
  const [editing, setEditing] = useState(Boolean(pack));
  const unit = product.unit_abbr || product.unit_name || 'หน่วย';
  const changed = (pack ? String(pack.pack_size) : '') !== size.trim()
    || (pack ? (pack.pack_unit_label || 'ถุง') !== (label.trim() || 'ถุง') : false);

  const save = async () => {
    const value = size.trim() === '' ? 0 : Number(size);
    if (!(value >= 0) || value > 10000) {
      alert('จำนวนต่อแพ็คไม่ถูกต้อง');
      return;
    }
    try {
      setSaving(true);
      const response = await productPackSizesAPI.save(product.id, value, label.trim() || 'ถุง');
      onSaved(product.id, response?.data || null);
    } catch (error) {
      alert(error?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="px-3 py-3">
      <p className="text-sm font-semibold text-gray-900">{product.name}</p>
      <p className="text-xs text-gray-500">
        {pack ? `${pack.pack_unit_label || 'ถุง'}ละ ${pack.pack_size} ${unit} · สติกเกอร์ 1 ดวงต่อ${pack.pack_unit_label || 'ถุง'}` : `สติกเกอร์ดวงละ 1 ${unit}`}
      </p>
      {!editing ? (
        <button
          type="button"
          onClick={() => {
            setLabel((value) => value || 'ถุง');
            setEditing(true);
          }}
          className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700"
        >
          ตั้งแพ็ค
        </button>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="ถุง"
            className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-center text-sm placeholder:text-gray-300"
            aria-label={`หน่วยแพ็คของ ${product.name}`}
          />
          <span className="text-sm text-gray-600">ละ</span>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={size}
            onChange={(event) => setSize(event.target.value)}
            placeholder="-"
            autoFocus={!pack}
            className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-right text-sm"
            aria-label={`จำนวนต่อแพ็คของ ${product.name}`}
          />
          <span className="text-sm text-gray-600">{unit}</span>
          <button
            type="button"
            onClick={save}
            disabled={saving || !changed}
            className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
          >
            {saving ? '…' : 'บันทึก'}
          </button>
        </div>
      )}
    </li>
  );
};

export const ProductionPackSizeTab = ({ products = [], packSizes, onChange }) => {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const rows = keyword
      ? products.filter((product) => String(product.name || '').toLowerCase().includes(keyword)
        || String(product.code || '').toLowerCase().includes(keyword))
      : products;
    // ตั้งแพ็คแล้วขึ้นก่อน
    return [...rows].sort((a, b) => Number(packSizes.has(Number(b.id))) - Number(packSizes.has(Number(a.id))));
  }, [products, packSizes, search]);

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="ค้นหาสินค้า"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {filtered.map((product) => (
          <PackRow
            key={`${product.id}-${packSizes.get(Number(product.id))?.pack_size ?? 0}`}
            product={product}
            pack={packSizes.get(Number(product.id)) || null}
            onSaved={onChange}
          />
        ))}
      </ul>
    </div>
  );
};
