import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { productsAPI } from '../../api/products';
import { inventoryAPI } from '../../api/inventory';
import { useAuth } from '../../contexts/AuthContext';
import { usageUnitOf, inputUnitLabel, toBaseQuantity, formatNumber } from '../../utils/usage-unit';
import { ProductionUsageUnitTab } from './ProductionUsageUnitTab';
import { printTransformStickers } from './transformStickerPrint';
import { bangkokDate } from '../../utils/salesReportDates';

const isBaseIngredientRequired = (product) => {
  return Boolean(
    (Array.isArray(product?.required_ingredients) && product.required_ingredients.length > 0) ||
    (Array.isArray(product?.required_ingredient_product_ids) && product.required_ingredient_product_ids.length > 0) ||
    product?.requires_base_ingredient ||
    product?.requires_base_input ||
    product?.requires_ingredient_input ||
    product?.require_base_ingredient
  );
};


const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
};

const formatQuantity = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
};

const extractTransformNote = (rawNote) => {
  const text = String(rawNote || '').trim();
  if (!text) return '';
  const match = text.match(/^แปรรูปสินค้า:\s*(?:รับเข้าแผนกทันที|ตัดวัตถุดิบ)(?:\s*\((.*)\))?$/);
  if (!match) return text;
  return String(match[1] || '').trim();
};

export const ProductionTransform = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [outputProducts, setOutputProducts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [outputSearch, setOutputSearch] = useState('');
  const [outputQuantities, setOutputQuantities] = useState({});
  const [ingredientUsageByOutput, setIngredientUsageByOutput] = useState({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState(null);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('create');
  // วันไทย ไม่ใช่ UTC: ก่อน 07:00 น. toISOString() ได้วันก่อนหน้า ทำให้แปรรูปลงวันผิด
  const [transformDate, setTransformDate] = useState(() => bangkokDate());
  const [historyDate, setHistoryDate] = useState(() => bangkokDate());
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [ingredientModal, setIngredientModal] = useState({
    isOpen: false,
    product: null,
    outputQuantity: '',
    ingredientQtyMap: {}
  });

  const departmentId = user?.department_id ? Number(user.department_id) : null;

  const loadData = async () => {
    if (!departmentId) return;
    try {
      setLoading(true);
      const [outputProductsRes, balanceRes, configRes] = await Promise.all([
        productsAPI.getProducts({ transformOutput: true }),
        inventoryAPI.getBalances({ departmentId }),
        inventoryAPI.getProductionTransformConfigs({ departmentId })
      ]);
      const outputProductData = outputProductsRes?.data ?? outputProductsRes ?? [];
      const balanceData = Array.isArray(balanceRes) ? balanceRes : [];
      const configMap = new Map(
        (configRes?.output_products || []).map((row) => [Number(row.product_id), row])
      );
      const mergedProducts = (Array.isArray(outputProductData) ? outputProductData : []).map((product) => {
        const config = configMap.get(Number(product.id));
        return {
          ...product,
          requires_base_ingredient: Boolean(config?.requires_base_ingredient),
          required_ingredient_product_ids: Array.isArray(config?.required_ingredient_product_ids)
            ? config.required_ingredient_product_ids
            : [],
          required_ingredients: Array.isArray(config?.required_ingredients)
            ? config.required_ingredients
            : []
        };
      });
      setOutputProducts(mergedProducts);
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
    if (tabKey !== 'create') {
      setIsListModalOpen(false);
    }
  };

  const openEditHistory = (row) => {
    setEditingRow(row);
    setEditQuantity(Number(row?.quantity || 0) > 0 ? String(Number(row.quantity)) : '');
    setEditNotes(extractTransformNote(row?.notes));
  };

  const closeEditHistory = () => {
    setEditingRow(null);
    setEditQuantity('');
    setEditNotes('');
    setEditSaving(false);
  };

  const handleSaveHistoryEdit = async () => {
    if (!editingRow?.id) return;
    const quantity = Number(editQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      alert('จำนวนต้องมากกว่า 0');
      return;
    }

    try {
      setEditSaving(true);
      await inventoryAPI.updateProductionTransform(editingRow.id, {
        output_quantity: quantity,
        notes: editNotes
      });
      await Promise.all([loadHistory(historyDate), loadData()]);
      closeEditHistory();
    } catch (error) {
      console.error('Error updating production transform:', error);
      alert(error?.response?.data?.message || 'แก้ไขประวัติการแปรรูปไม่สำเร็จ');
    } finally {
      setEditSaving(false);
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
        product_unit: product.unit_abbr || product.unit_name || '',
        quantity: Number(outputQuantities[product.id] || 0),
        requires_base_ingredient: isBaseIngredientRequired(product),
        ingredients: (ingredientUsageByOutput[product.id]?.ingredients || []).map((item) => ({
          product_id: Number(item.product_id),
          quantity: Number(item.quantity || 0),
          ...(item.input_unit_id ? { input_unit_id: Number(item.input_unit_id) } : {})
        }))
      }))
      .filter((item) => Number.isFinite(item.product_id) && Number.isFinite(item.quantity) && item.quantity > 0);
  }, [outputProducts, outputQuantities, ingredientUsageByOutput]);

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
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setIngredientUsageByOutput((prev) => {
        if (!prev[productId]) return prev;
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    }
  };

  const adjustOutputQty = (productId, delta) => {
    const current = getOutputQty(productId);
    const next = Math.max(0, current + delta);
    setOutputQty(productId, next);
  };

  const openIngredientModal = (productId) => {
    const product = outputProducts.find((item) => Number(item.id) === Number(productId));
    if (!product) return;

    const requiredIngredients = Array.isArray(product.required_ingredients)
      ? product.required_ingredients
      : [];
    if (requiredIngredients.length === 0) {
      alert(`สินค้า "${product.name}" ถูกบังคับวัตถุดิบหลัก แต่ยังไม่ได้ตั้งค่าวัตถุดิบหลัก`);
      return;
    }

    const savedUsage = ingredientUsageByOutput[productId]?.ingredients || [];
    const savedMap = new Map(savedUsage.map((row) => [Number(row.product_id), Number(row.quantity || 0)]));
    const ingredientQtyMap = {};
    requiredIngredients.forEach((ingredient) => {
      const ingredientId = Number(ingredient.product_id);
      const saved = savedMap.get(ingredientId);
      ingredientQtyMap[ingredientId] = Number.isFinite(saved) && saved > 0 ? String(saved) : '';
    });

    setIngredientModal({
      isOpen: true,
      product,
      outputQuantity: getOutputQty(productId) > 0 ? String(getOutputQty(productId)) : '',
      ingredientQtyMap
    });
  };

  const handleIngredientModalSave = () => {
    const product = ingredientModal.product;
    if (!product) return;

    const outputQty = Number(ingredientModal.outputQuantity);
    if (!Number.isFinite(outputQty) || outputQty <= 0) {
      alert('กรุณากรอกจำนวนสินค้าที่แปรรูปออกมาให้มากกว่า 0');
      return;
    }

    const requiredIngredients = Array.isArray(product.required_ingredients)
      ? product.required_ingredients
      : [];
    const ingredientPayload = [];
    for (const ingredient of requiredIngredients) {
      const ingredientId = Number(ingredient.product_id);
      const qty = Number(ingredientModal.ingredientQtyMap?.[ingredientId]);
      if (!Number.isFinite(qty) || qty <= 0) {
        alert(`กรุณากรอกจำนวนวัตถุดิบหลัก "${ingredient.product_name}"`);
        return;
      }
      const usage = usageUnitOf(ingredient);
      const baseQty = toBaseQuantity(ingredient, qty);
      if (usage && !(baseQty > 0)) {
        alert(`จำนวน "${ingredient.product_name}" น้อยเกินไป (ต่ำกว่า 0.01 ${ingredient.unit_abbr || ingredient.unit_name || 'หน่วยฐาน'})`);
        return;
      }
      ingredientPayload.push({
        product_id: ingredientId,
        product_name: ingredient.product_name,
        quantity: qty,
        // กรอกเป็นหน่วยใช้ (เช่น มล.) → server แปลงเป็นหน่วยฐานก่อนตัดสต๊อก
        input_unit_id: usage ? usage.id : null,
        unit_name: usage ? usage.name : (ingredient.unit_name || ''),
        unit_abbr: usage ? (usage.abbr || usage.name) : (ingredient.unit_abbr || ''),
        base_quantity: baseQty,
        base_unit_label: ingredient.unit_abbr || ingredient.unit_name || ''
      });
    }

    setOutputQty(product.id, outputQty);
    setIngredientUsageByOutput((prev) => ({
      ...prev,
      [product.id]: {
        ingredients: ingredientPayload
      }
    }));
    setIngredientModal({
      isOpen: false,
      product: null,
      outputQuantity: '',
      ingredientQtyMap: {}
    });
  };

  const handleCardClick = (productId) => {
    const product = outputProducts.find((item) => Number(item.id) === Number(productId));
    if (!product) return;
    if (isBaseIngredientRequired(product)) {
      openIngredientModal(productId);
      return;
    }
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
      (item) => item.requires_base_ingredient && (!Array.isArray(item.ingredients) || item.ingredients.length === 0)
    );
    if (missingBaseIngredientItem) {
      alert(`สินค้า "${missingBaseIngredientItem.product_name}" ยังไม่ได้กรอกจำนวนวัตถุดิบหลัก`);
      return;
    }

    setSaving(true);
    try {
      // บันทึกทีละรายการ ถ้าพังกลางทาง รายการก่อนหน้าบันทึกไปแล้ว
      // ต้องเอารายการที่บันทึกแล้วออกจากฟอร์ม ไม่งั้นกดบันทึกซ้ำจะรับสินค้าเข้าซ้ำ
      const results = [];
      const savedItems = [];
      let failure = null;
      for (const item of selectedOutputItems) {
        try {
          const response = await inventoryAPI.createProductionTransform({
            transform_date: transformDate,
            department_id: departmentId,
            output_product_id: item.product_id,
            output_quantity: item.quantity,
            ingredients: item.ingredients || [],
            notes: notes ? String(notes).trim() : ''
          });
          results.push(response?.data || null);
          savedItems.push(item);
        } catch (error) {
          failure = { item, error };
          break;
        }
      }

      if (failure) {
        console.error('Error creating production transform:', failure.error);
      }

      if (savedItems.length > 0) {
        const insufficientLines = results.flatMap((result) => {
          const rows = Array.isArray(result?.insufficient_ingredients)
            ? result.insufficient_ingredients
            : [];
          return rows.map((row) => {
            const productName = String(row?.product_name || '-');
            const shortageQty = Number(row?.shortage_quantity || 0);
            return `- ${productName} ขาด ${shortageQty}`;
          });
        });

        const selectedUnitByProductId = new Map(
          savedItems.map((item) => [Number(item.product_id), item.product_unit || ''])
        );

        setSummary({
          transform_date: transformDate,
          printed_at: new Date().toISOString(),
          total_items: results.length,
          total_quantity: savedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          items: results
            .map((result) => ({
              reference_id: result?.reference_id || '-',
              product_id: result?.output?.product_id || null,
              product_code: result?.output?.product_code || '',
              product_name: result?.output?.product_name || '-',
              product_unit: selectedUnitByProductId.get(Number(result?.output?.product_id)) || '',
              quantity: Number(result?.output?.quantity || 0)
            }))
        });

        const savedIds = new Set(savedItems.map((item) => Number(item.product_id)));
        const withoutSaved = (prev) => Object.fromEntries(
          Object.entries(prev).filter(([productId]) => !savedIds.has(Number(productId)))
        );
        setOutputQuantities(withoutSaved);
        setIngredientUsageByOutput(withoutSaved);
        if (!failure) {
          setNotes('');
          setIsListModalOpen(false);
        }
        await loadData();

        if (insufficientLines.length > 0) {
          alert(
            `บันทึกสำเร็จ แต่มีวัตถุดิบไม่พอ ระบบตัดติดลบให้แล้ว:\n${insufficientLines.join('\n')}`
          );
        }
      }

      if (failure) {
        const message = failure.error?.response?.data?.message || 'บันทึกการแปรรูปไม่สำเร็จ';
        alert(
          savedItems.length > 0
            ? `บันทึกแล้ว ${savedItems.length} รายการ\n"${failure.item.product_name}" ไม่สำเร็จ: ${message}\nรายการที่เหลือยังอยู่ในฟอร์ม กดบันทึกอีกครั้งได้`
            : message
        );
      }
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
          <div className="grid grid-cols-3 gap-2">
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
            <button
              type="button"
              onClick={() => handleSelectTab('units')}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                activeTab === 'units'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-50 text-gray-700 hover:bg-slate-100'
              }`}
            >
              ตั้งค่าแปลงหน่วย
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
                    setIngredientUsageByOutput({});
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
                          วัตถุดิบหลัก: {Array.isArray(product.required_ingredients) && product.required_ingredients.length > 0
                            ? product.required_ingredients.map((item) => item.product_name).join(', ')
                            : 'ยังไม่ได้ตั้งค่า'}
                        </p>
                      )}
                      {!requiresBaseIngredient ? (
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
                      ) : (
                        <button
                          type="button"
                          className="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            openIngredientModal(product.id);
                          }}
                          disabled={saving}
                        >
                          {qty > 0
                            ? `แก้ไขวัตถุดิบและจำนวน (${qty} ${product.unit_abbr || product.unit_name || ''})`
                            : 'กรอกวัตถุดิบหลักและจำนวนแปรรูป'}
                        </button>
                      )}
                      {requiresBaseIngredient && (
                        <p className="mt-1 text-[10px] text-amber-700">
                          กดการ์ดเพื่อใส่จำนวนวัตถุดิบหลักและจำนวนสินค้าที่แปรรูป
                        </p>
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
            สินค้าที่ตั้งค่า "บังคับวัตถุดิบหลัก" จะตัดวัตถุดิบออกจากคลังอัตโนมัติเมื่อบันทึกการแปรรูป
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
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              onClick={() =>
                printTransformStickers(
                  (summary.items || []).map((item) => ({
                    productName: item.product_name,
                    productUnit: item.product_unit || '',
                    productCode: item.product_code || item.product_id || '',
                    productId: item.product_id || '',
                    producedAt: summary.transform_date || summary.printed_at,
                    referenceId: item.reference_id,
                    branchName: user?.branch || '-',
                    departmentName: user?.department || '-',
                    quantityText: `+${Number(item.quantity || 0)}`,
                    quantityValue: Number(item.quantity || 0)
                  })),
                  { layout: '3x2' }
                )
              }
            >
              พิมพ์สติกเกอร์ 3x2 นิ้ว
            </button>
          </div>
        </div>
      )}

        {activeTab === 'units' && (
          <ProductionUsageUnitTab departmentId={departmentId} onSaved={loadData} />
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
                        <p className="text-xs text-gray-500">{formatDateTime(row.effective_at || row.created_at)}</p>
                        <button
                          type="button"
                          onClick={() => openEditHistory(row)}
                          className="mt-1 text-xs text-blue-600 hover:text-blue-700"
                        >
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            printTransformStickers([{
                              productName: row.product_name,
                              productUnit: row.unit_abbr || row.unit_name || '',
                              productCode: row.product_code || row.product_id || '',
                              productId: row.product_id || '',
                              producedAt: row.effective_at || row.created_at,
                              referenceId: row.reference_id,
                              branchName: row.branch_name,
                              departmentName: row.department_name,
                              quantityText: `+${Number(row.quantity || 0)} ${row.unit_abbr || row.unit_name || ''}`.trim(),
                              quantityValue: Number(row.quantity || 0)
                            }], { layout: '3x2' })
                          }
                          className="ml-2 mt-1 text-xs text-emerald-700 hover:text-emerald-800"
                        >
                          พิมพ์ 3x2 นิ้ว
                        </button>
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
                const ingredientSummaryRows = ingredientUsageByOutput[item.product_id]?.ingredients || [];
                const outputUnit = product?.unit_abbr || product?.unit_name || '-';
                return (
                  <div key={item.product_id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">
                          {item.product_name}
                          <span className="ml-1 text-xs font-medium text-gray-500">({outputUnit})</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.requires_base_ingredient && (
                          <p className="font-semibold text-gray-900 whitespace-nowrap">
                            ผลิต {formatQuantity(item.quantity)} {outputUnit}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => setOutputQty(item.product_id, 0)}
                          className="text-rose-600 text-sm font-semibold hover:underline"
                          disabled={saving}
                        >
                          ลบ
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      {!item.requires_base_ingredient ? (
                        <>
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
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openIngredientModal(item.product_id)}
                          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-2 text-xs text-amber-800 hover:bg-amber-100"
                          disabled={saving}
                        >
                          แก้ไขวัตถุดิบหลักและจำนวน
                        </button>
                      )}
                    </div>

                    {item.requires_base_ingredient && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
                        {ingredientSummaryRows.length > 0 ? (
                          <div className="space-y-1">
                            {ingredientSummaryRows.map((ingredient, index) => (
                              <div
                                key={`${item.product_id}-${ingredient.product_id}`}
                                className="flex items-center justify-between gap-2 text-[13px] text-amber-900"
                              >
                                <span className="truncate">
                                  {index === 0 ? 'วัตถุดิบ: ' : ''}
                                  {ingredient.product_name || ingredient.product_id}
                                </span>
                                <span className="font-semibold whitespace-nowrap">
                                  {formatQuantity(ingredient.quantity)} {ingredient.unit_abbr || ingredient.unit_name || '-'}
                                  {ingredient.input_unit_id && (
                                    <span className="ml-1 text-xs font-normal text-amber-700">
                                      (ตัด {formatNumber(ingredient.base_quantity)} {ingredient.base_unit_label})
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-rose-700">ยังไม่ได้กรอกวัตถุดิบหลัก</p>
                        )}
                      </div>
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

      <Modal
        isOpen={Boolean(editingRow)}
        onClose={closeEditHistory}
        title="แก้ไขประวัติการแปรรูป"
        size="medium"
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="font-semibold text-gray-900">{editingRow?.product_name || '-'}</div>
            <div className="text-xs text-gray-600">{editingRow?.product_code || '-'}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนที่ผลิต</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={editQuantity}
              onChange={(event) => setEditQuantity(event.target.value)}
              disabled={editSaving}
            />
          </div>
          <Input
            label="หมายเหตุ"
            value={editNotes}
            onChange={(event) => setEditNotes(event.target.value)}
            placeholder="ระบุหมายเหตุ (ถ้ามี)"
            disabled={editSaving}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeEditHistory}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              disabled={editSaving}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleSaveHistoryEdit}
              className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
              disabled={editSaving}
            >
              {editSaving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(ingredientModal.isOpen && ingredientModal.product)}
        onClose={() =>
          setIngredientModal({ isOpen: false, product: null, outputQuantity: '', ingredientQtyMap: {} })}
        title={ingredientModal.product ? `ตั้งค่าการแปรรูป: ${ingredientModal.product.name}` : 'ตั้งค่าการแปรรูป'}
        size="medium"
      >
        {ingredientModal.product && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนสินค้าที่แปรรูปออกมา</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={ingredientModal.outputQuantity}
                onChange={(event) =>
                  setIngredientModal((prev) => ({ ...prev, outputQuantity: event.target.value }))}
              />
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-900">วัตถุดิบหลักที่ต้องใช้</p>
              {(ingredientModal.product.required_ingredients || []).map((ingredient) => {
                const ingredientId = Number(ingredient.product_id);
                const usage = usageUnitOf(ingredient);
                const baseLabel = ingredient.unit_abbr || ingredient.unit_name || '';
                const typedQty = Number(ingredientModal.ingredientQtyMap?.[ingredientId]);
                return (
                  <div key={ingredientId} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
                    <div className="text-sm text-gray-800">
                      {ingredient.product_name}
                      <span className="text-xs text-gray-500 ml-1">
                        ({inputUnitLabel(ingredient)})
                      </span>
                      {usage && (
                        <div className="text-xs text-gray-500">
                          1 {baseLabel} = {formatNumber(usage.per_base)} {usage.abbr || usage.name}
                          {typedQty > 0 && (
                            <span className="ml-1 font-medium text-amber-800">
                              → ตัดสต๊อก {formatNumber(toBaseQuantity(ingredient, typedQty))} {baseLabel}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      value={ingredientModal.ingredientQtyMap?.[ingredientId] || ''}
                      onChange={(event) =>
                        setIngredientModal((prev) => ({
                          ...prev,
                          ingredientQtyMap: {
                            ...(prev.ingredientQtyMap || {}),
                            [ingredientId]: event.target.value
                          }
                        }))}
                      placeholder={`จำนวนที่ใช้ (${inputUnitLabel(ingredient)})`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="w-full px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() =>
                  setIngredientModal({
                    isOpen: false,
                    product: null,
                    outputQuantity: '',
                    ingredientQtyMap: {}
                  })}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                onClick={handleIngredientModalSave}
              >
                บันทึกข้อมูลสินค้า
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};
