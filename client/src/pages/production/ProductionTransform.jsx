import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { productsAPI } from '../../api/products';
import { inventoryAPI } from '../../api/inventory';
import { useAuth } from '../../contexts/AuthContext';

const isBaseIngredientRequired = (product) => {
  return Boolean(
    product?.requires_base_ingredient ||
    product?.requires_base_input ||
    product?.requires_ingredient_input ||
    product?.require_base_ingredient
  );
};

const todayString = new Date().toISOString().split('T')[0];

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
};

export const ProductionTransform = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [outputProducts, setOutputProducts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [outputSearch, setOutputSearch] = useState('');
  const [outputQuantities, setOutputQuantities] = useState({});
  const [baseIngredientInputs, setBaseIngredientInputs] = useState({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState(null);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('create');
  const [transformDate, setTransformDate] = useState(todayString);
  const [historyDate, setHistoryDate] = useState(todayString);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const departmentId = user?.department_id ? Number(user.department_id) : null;

  const loadData = async () => {
    if (!departmentId) return;
    try {
      setLoading(true);
      const [outputProductsRes, balanceRes] = await Promise.all([
        productsAPI.getProducts({ transformOutput: true }),
        inventoryAPI.getBalances({ departmentId })
      ]);
      const outputProductData = outputProductsRes?.data ?? outputProductsRes ?? [];
      const balanceData = Array.isArray(balanceRes) ? balanceRes : [];
      setOutputProducts(Array.isArray(outputProductData) ? outputProductData : []);
      setBalances(balanceData);
    } catch (error) {
      console.error('Error loading transform data:', error);
      alert('โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (targetDate = historyDate) => {
    if (!departmentId) return;
    try {
      setHistoryLoading(true);
      const data = await inventoryAPI.getProductionTransformHistory({
        departmentId,
        date: targetDate,
        limit: 100
      });
      setHistoryRows(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading production history:', error);
      alert('โหลดประวัติการแปรรูปไม่สำเร็จ');
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSelectTab = (tabKey) => {
    setActiveTab(tabKey);
    if (tabKey === 'history') {
      setIsListModalOpen(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [departmentId]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory(historyDate);
    }
  }, [activeTab, historyDate]);

  const stockMap = useMemo(() => {
    const map = new Map();
    for (const row of balances) {
      map.set(Number(row.product_id), Number(row.quantity || 0));
    }
    return map;
  }, [balances]);

  const filteredOutputProducts = useMemo(() => {
    const keyword = String(outputSearch || '').trim().toLowerCase();
    if (!keyword) return outputProducts;
    return outputProducts.filter((product) =>
      String(product?.name || '').toLowerCase().includes(keyword) ||
      String(product?.code || '').toLowerCase().includes(keyword)
    );
  }, [outputProducts, outputSearch]);

  const selectedOutputItems = useMemo(() => {
    return outputProducts
      .map((product) => ({
        product_id: Number(product.id),
        product_name: product.name,
        quantity: Number(outputQuantities[product.id] || 0),
        requires_base_ingredient: isBaseIngredientRequired(product),
        base_ingredient: String(baseIngredientInputs[product.id] || '').trim()
      }))
      .filter((item) => Number.isFinite(item.product_id) && Number.isFinite(item.quantity) && item.quantity > 0);
  }, [outputProducts, outputQuantities, baseIngredientInputs]);

  const getOutputQty = (productId) => Number(outputQuantities[productId] || 0);

  const setOutputQty = (productId, value) => {
    const quantity = Number(value);
    setOutputQuantities((prev) => {
      const next = { ...prev };
      if (!Number.isFinite(quantity) || quantity <= 0) {
        delete next[productId];
      } else {
        next[productId] = quantity;
      }
      return next;
    });
  };

  const setBaseIngredientInput = (productId, value) => {
    setBaseIngredientInputs((prev) => {
      const next = { ...prev };
      const normalized = String(value || '').trim();
      if (!normalized) {
        delete next[productId];
      } else {
        next[productId] = normalized;
      }
      return next;
    });
  };

  const adjustOutputQty = (productId, delta) => {
    const current = getOutputQty(productId);
    const next = Math.max(0, current + delta);
    setOutputQty(productId, next);
  };

  const handleCardClick = (productId) => {
    adjustOutputQty(productId, 1);
  };

  const handleSubmit = async () => {
    if (!departmentId) {
      alert('ไม่พบแผนกผู้ใช้งาน');
      return;
    }

    if (!transformDate) {
      alert('กรุณาเลือกวันที่แปรรูป');
      return;
    }

    if (selectedOutputItems.length === 0) {
      alert('กรุณากรอกจำนวนในการ์ดสินค้าอย่างน้อย 1 รายการ');
      return;
    }

    const missingBaseIngredientItem = selectedOutputItems.find(
      (item) => item.requires_base_ingredient && !item.base_ingredient
    );
    if (missingBaseIngredientItem) {
      alert(`กรุณากรอกวัตถุดิบตั้งต้นของ "${missingBaseIngredientItem.product_name}"`);
      return;
    }

    setSaving(true);
    try {
      const results = [];
      for (const item of selectedOutputItems) {
        const combinedNotes = [notes, item.requires_base_ingredient ? `วัตถุดิบตั้งต้น: ${item.base_ingredient}` : '']
          .filter((value) => String(value || '').trim().length > 0)
          .join(' | ');

        const response = await inventoryAPI.createProductionTransform({
          transform_date: transformDate,
          department_id: departmentId,
          output_product_id: item.product_id,
          output_quantity: item.quantity,
          notes: combinedNotes
        });
        results.push(response?.data || null);
      }

      setSummary({
        transform_date: transformDate,
        total_items: results.length,
        total_quantity: selectedOutputItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        items: results
          .map((result) => ({
            reference_id: result?.reference_id || '-',
            product_name: result?.output?.product_name || '-',
            quantity: Number(result?.output?.quantity || 0)
          }))
      });

      setOutputQuantities({});
      setBaseIngredientInputs({});
      setNotes('');
      setIsListModalOpen(false);
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
            เพิ่มสินค้าปลายทางเข้าระบบ
          </p>
          <p className="text-xs text-gray-500 mt-1">
            กรอกจำนวนบนการ์ดสินค้าได้เลย
          </p>
          <p className="text-xs text-emerald-700 mt-1">
            หลังบันทึกจะรับสินค้าเข้าแผนกนี้ทันที
          </p>
          <p className="text-xs text-gray-500 mt-1">
            แผนก: {user?.department || '-'} • สาขา: {user?.branch || '-'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleSelectTab('create')}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                activeTab === 'create'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-50 text-gray-700 hover:bg-slate-100'
              }`}
            >
              สร้างการแปรรูป
            </button>
            <button
              type="button"
              onClick={() => handleSelectTab('history')}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-50 text-gray-700 hover:bg-slate-100'
              }`}
            >
              ประวัติการแปรรูป
            </button>
          </div>
        </div>

        {activeTab === 'create' && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">วันที่แปรรูป</label>
            <input
              type="date"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={transformDate}
              onChange={(event) => setTransformDate(event.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <label className="block text-sm font-medium text-gray-700">
                สินค้าปลายทาง (ได้จากการแปรรูป)
              </label>
              {selectedOutputItems.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:text-blue-700"
                  onClick={() => {
                    setOutputQuantities({});
                    setBaseIngredientInputs({});
                  }}
                  disabled={saving}
                >
                  ล้างจำนวนทั้งหมด
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="ค้นหาสินค้าปลายทาง"
                value={outputSearch}
                onChange={(event) => setOutputSearch(event.target.value)}
                disabled={loading || saving}
              />
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => setOutputSearch((prev) => String(prev || '').trim())}
                disabled={loading || saving}
              >
                ค้นหา
              </button>
            </div>

            {filteredOutputProducts.length === 0 ? (
              <div className="text-xs text-gray-500 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                ไม่พบสินค้าปลายทางที่ค้นหา
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {filteredOutputProducts.slice(0, 120).map((product) => {
                  const qty = getOutputQty(product.id);
                  const isSelected = qty > 0;
                  const requiresBaseIngredient = isBaseIngredientRequired(product);
                  return (
                    <div
                      key={product.id}
                      onClick={() => handleCardClick(product.id)}
                      className={`text-left rounded-lg border px-3 py-2 transition ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 cursor-pointer'
                          : 'border-gray-200 bg-white hover:border-blue-300 cursor-pointer'
                      }`}
                    >
                      <p className="text-sm font-semibold text-gray-900 line-clamp-2">
                        {product.name}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-1 truncate">
                        {product.code || '-'}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-1">
                        คงเหลือ {stockMap.get(Number(product.id)) ?? 0}
                      </p>
                      {requiresBaseIngredient && (
                        <p className="text-[10px] mt-1 text-amber-700 font-medium">
                          ต้องกรอกวัตถุดิบตั้งต้น
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                          value={qty || ''}
                          onChange={(event) => setOutputQty(product.id, event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          disabled={saving}
                          placeholder="จำนวน"
                        />
                        <span className="text-[11px] text-gray-500 shrink-0">
                          {product.unit_abbr || product.unit_name || ''}
                        </span>
                      </div>
                      {requiresBaseIngredient && (
                        <input
                          type="text"
                          className="mt-2 w-full rounded-lg border border-amber-200 px-2 py-1.5 text-xs text-gray-700"
                          placeholder="ระบุวัตถุดิบตั้งต้น"
                          value={baseIngredientInputs[product.id] || ''}
                          onChange={(event) => setBaseIngredientInput(product.id, event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          disabled={saving}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {outputProducts.length === 0 && (
            <div className="text-xs text-amber-700 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              แผนกนี้ยังไม่มีพื้นที่จัดเก็บสินค้าที่ผูกไว้สำหรับสินค้าปลายทาง
            </div>
          )}
          <div className="text-xs text-gray-600 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            ตอนนี้ยังไม่มีสินค้าที่บังคับกรอกวัตถุดิบตั้งต้น
          </div>

          <Input
            label="หมายเหตุ"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="เช่น แปรรูปสำหรับรอบเช้า"
            disabled={saving}
          />
          </div>
        )}

        {activeTab === 'create' && summary && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div className="font-semibold">บันทึกเรียบร้อย</div>
            <div>วันที่แปรรูป {summary.transform_date || '-'}</div>
            <div>รวม {summary.total_items} รายการ • จำนวนรวม {summary.total_quantity}</div>
            <div>
              {Array.isArray(summary.items) && summary.items.length > 0
                ? summary.items.slice(0, 3).map((item) => `${item.product_name} +${item.quantity}`).join(' | ')
                : '-'}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">วันที่</label>
                <input
                  type="date"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={historyDate}
                  onChange={(event) => setHistoryDate(event.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => loadHistory(historyDate)}
                className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                disabled={historyLoading}
              >
                {historyLoading ? 'กำลังโหลด...' : 'รีเฟรช'}
              </button>
            </div>

            {historyLoading ? (
              <div className="text-sm text-gray-500">กำลังโหลดประวัติ...</div>
            ) : historyRows.length === 0 ? (
              <div className="text-sm text-gray-500">ยังไม่มีประวัติการแปรรูปในวันที่เลือก</div>
            ) : (
              <div className="space-y-2">
                {historyRows.map((row) => (
                  <div key={`${row.id}_${row.reference_id}`} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">{row.product_name}</p>
                        <p className="text-xs text-gray-500">{row.product_code || '-'}</p>
                        {row.notes && (
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{row.notes}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-emerald-700">
                          +{Number(row.quantity || 0)} {row.unit_abbr || row.unit_name || ''}
                        </p>
                        <p className="text-xs text-gray-500">{formatDateTime(row.created_at)}</p>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500 flex flex-wrap gap-2">
                      <span>{row.branch_name} / {row.department_name}</span>
                      <span>อ้างอิง: {row.reference_id || '-'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {activeTab === 'create' && selectedOutputItems.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40 md:left-auto md:right-8 md:w-[360px]">
          <button
            type="button"
            onClick={() => setIsListModalOpen(true)}
            className="w-full rounded-2xl bg-green-600 text-white shadow-lg px-4 py-3 flex items-center justify-between"
          >
            <div className="text-left">
              <p className="font-semibold">รายการสินค้า ({selectedOutputItems.length})</p>
              <p className="text-xs text-green-100">วันที่แปรรูป {transformDate || '-'} • กดเพื่อบันทึก</p>
            </div>
            <span className="text-sm font-semibold">เปิด</span>
          </button>
        </div>
      )}

      <Modal
        isOpen={activeTab === 'create' && isListModalOpen}
        onClose={() => setIsListModalOpen(false)}
        title={`รายการสินค้า (${selectedOutputItems.length}) • วันที่ ${transformDate || '-'}`}
        size="large"
      >
        {selectedOutputItems.length === 0 ? (
          <div className="text-center text-gray-500 py-6">ยังไม่มีรายการ</div>
        ) : (
          <div className="space-y-3">
            <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
              {selectedOutputItems.map((item) => {
                const product = outputProducts.find((row) => Number(row.id) === Number(item.product_id));
                return (
                  <div key={item.product_id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">{item.product_name}</p>
                        <p className="text-xs text-gray-500">{product?.code || '-'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOutputQty(item.product_id, 0)}
                        className="text-rose-600 text-xs px-2 py-1 rounded border border-rose-200 hover:bg-rose-50"
                        disabled={saving}
                      >
                        ลบ
                      </button>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => adjustOutputQty(item.product_id, -1)}
                        className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-lg font-bold hover:bg-gray-200"
                        disabled={saving}
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                        value={getOutputQty(item.product_id) || ''}
                        onChange={(event) => setOutputQty(item.product_id, event.target.value)}
                        disabled={saving}
                      />
                      <button
                        type="button"
                        onClick={() => adjustOutputQty(item.product_id, 1)}
                        className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-lg font-bold hover:bg-blue-100"
                        disabled={saving}
                      >
                        +
                      </button>
                      <span className="text-xs text-gray-500 shrink-0">
                        {product?.unit_abbr || product?.unit_name || ''}
                      </span>
                    </div>

                    {item.requires_base_ingredient && (
                      <input
                        type="text"
                        className="mt-2 w-full rounded-lg border border-amber-200 px-2 py-1.5 text-xs text-gray-700"
                        placeholder="ระบุวัตถุดิบตั้งต้น"
                        value={baseIngredientInputs[item.product_id] || ''}
                        onChange={(event) => setBaseIngredientInput(item.product_id, event.target.value)}
                        disabled={saving}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsListModalOpen(false)}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                disabled={saving}
              >
                เลือกสินค้าต่อ
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || loading || selectedOutputItems.length === 0}
                className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
              >
                {saving ? 'กำลังบันทึก...' : `บันทึกการแปรรูป (${selectedOutputItems.length})`}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};
