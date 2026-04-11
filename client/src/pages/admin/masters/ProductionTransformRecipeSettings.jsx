import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Loading } from '../../../components/common/Loading';
import { masterAPI } from '../../../api/master';
import { inventoryAPI } from '../../../api/inventory';

const dedupeIds = (values = []) => {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return;
    seen.add(id);
    result.push(id);
  });
  return result;
};

export const ProductionTransformRecipeSettings = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [selectedIngredientGroup, setSelectedIngredientGroup] = useState('all');
  const [overview, setOverview] = useState(null);
  const [formMap, setFormMap] = useState({});
  const [selectedProductId, setSelectedProductId] = useState(null);

  const loadDepartments = async () => {
    const allDepartments = await masterAPI.getDepartmentsAll();
    const productionDepartments = (Array.isArray(allDepartments) ? allDepartments : [])
      .filter((row) => Boolean(Number(row?.is_production || 0)) && Boolean(Number(row?.is_active ?? 1)))
      .sort((a, b) => String(a.branch_name || '').localeCompare(String(b.branch_name || ''))
        || String(a.name || '').localeCompare(String(b.name || '')));
    setDepartments(productionDepartments);
    return productionDepartments;
  };

  const loadOverview = async (targetDepartmentId, keyword = '', keepSelectedId = null) => {
    if (!targetDepartmentId) return;
    const data = await inventoryAPI.getProductionTransformConfigs({
      departmentId: targetDepartmentId,
      search: keyword
    });
    setOverview(data);
    setSelectedIngredientGroup('all');

    const nextFormMap = {};
    for (const product of (data?.output_products || [])) {
      nextFormMap[product.product_id] = {
        requires_base_ingredient: Boolean(product.requires_base_ingredient),
        required_ingredient_product_ids: dedupeIds(product.required_ingredient_product_ids || [])
      };
    }
    setFormMap(nextFormMap);

    const availableIds = (data?.output_products || []).map((row) => Number(row.product_id));
    if (availableIds.length === 0) {
      setSelectedProductId(null);
      return;
    }
    const preferred = Number(keepSelectedId || selectedProductId || availableIds[0]);
    setSelectedProductId(availableIds.includes(preferred) ? preferred : availableIds[0]);
  };

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const productionDepartments = await loadDepartments();
        const firstDepartmentId = productionDepartments?.[0]?.id;
        if (firstDepartmentId) {
          setDepartmentId(String(firstDepartmentId));
          await loadOverview(firstDepartmentId, '');
        }
      } catch (error) {
        console.error('Error loading production transform settings:', error);
        alert(error?.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outputProducts = overview?.output_products || [];
  const selectedProduct = outputProducts.find((row) => Number(row.product_id) === Number(selectedProductId)) || null;
  const selectedForm = selectedProduct
    ? (formMap[selectedProduct.product_id] || {
        requires_base_ingredient: false,
        required_ingredient_product_ids: []
      })
    : null;

  const ingredientOptions = useMemo(
    () => (overview?.ingredient_products || []).map((item) => ({
      id: Number(item.id),
      name: item.name,
      code: item.code,
      product_group_name: item.product_group_name || 'ไม่ระบุกลุ่มสินค้า',
      unit_name: item.unit_name,
      unit_abbr: item.unit_abbr
    })),
    [overview?.ingredient_products]
  );

  const ingredientGroups = useMemo(() => {
    const names = Array.from(
      new Set(
        ingredientOptions
          .map((item) => String(item.product_group_name || '').trim())
          .filter(Boolean)
      )
    );
    names.sort((a, b) => a.localeCompare(b, 'th'));
    return names;
  }, [ingredientOptions]);

  const filteredIngredientOptions = useMemo(() => {
    const keyword = String(ingredientSearch || '').trim().toLowerCase();
    const byGroup = selectedIngredientGroup === 'all'
      ? ingredientOptions
      : ingredientOptions.filter(
          (row) => String(row.product_group_name || '') === String(selectedIngredientGroup)
        );
    if (!keyword) return byGroup;
    return byGroup.filter((row) =>
      String(row.name || '').toLowerCase().includes(keyword) ||
      String(row.code || '').toLowerCase().includes(keyword)
    );
  }, [ingredientOptions, ingredientSearch, selectedIngredientGroup]);

  const groupedIngredientOptions = useMemo(() => {
    const groups = new Map();
    filteredIngredientOptions.forEach((item) => {
      const key = String(item.product_group_name || 'ไม่ระบุกลุ่มสินค้า');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return Array.from(groups.entries()).map(([groupName, items]) => ({ groupName, items }));
  }, [filteredIngredientOptions]);

  const requiredCount = outputProducts.filter((row) => Boolean(row.requires_base_ingredient)).length;
  const configuredCount = outputProducts.filter((row) =>
    Boolean(row.requires_base_ingredient) &&
    Array.isArray(row.required_ingredient_product_ids) &&
    row.required_ingredient_product_ids.length > 0
  ).length;

  const handleSelectedChange = (key, value) => {
    if (!selectedProduct) return;
    setFormMap((prev) => {
      const current = prev[selectedProduct.product_id] || {
        requires_base_ingredient: false,
        required_ingredient_product_ids: []
      };
      return {
        ...prev,
        [selectedProduct.product_id]: {
          ...current,
          [key]: value
        }
      };
    });
  };

  const handleToggleIngredient = (ingredientId, checked) => {
    if (!selectedForm) return;
    const currentIds = Array.isArray(selectedForm.required_ingredient_product_ids)
      ? [...selectedForm.required_ingredient_product_ids]
      : [];
    const nextIds = checked
      ? dedupeIds([...currentIds, ingredientId])
      : currentIds.filter((id) => Number(id) !== Number(ingredientId));
    handleSelectedChange('required_ingredient_product_ids', nextIds);
  };

  const handleSaveSelected = async () => {
    if (!selectedProduct || !selectedForm || !departmentId) return;
    const requiresBase = Boolean(selectedForm.requires_base_ingredient);
    const requiredIds = dedupeIds(selectedForm.required_ingredient_product_ids || []);

    if (requiresBase && requiredIds.length === 0) {
      alert('กรุณาเลือกวัตถุดิบหลักอย่างน้อย 1 รายการ');
      return;
    }

    try {
      setSaving(true);
      await inventoryAPI.upsertProductionTransformConfig({
        department_id: Number(departmentId),
        output_product_id: Number(selectedProduct.product_id),
        requires_base_ingredient: requiresBase,
        required_ingredient_product_ids: requiresBase ? requiredIds : []
      });
      await loadOverview(Number(departmentId), search, selectedProduct.product_id);
    } catch (error) {
      console.error('Error saving transform config:', error);
      alert(error?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ตั้งค่าสูตรเมนู(สำหรับแปรรูปสินค้า)</h1>
            <p className="text-sm text-gray-600 mt-1">
              กำหนดวัตถุดิบหลักที่ต้องกรอกตอนแปรรูปสินค้าในหน้า `แปรรูปสินค้า`
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/admin/settings')}>
            ← กลับหน้าตั้งค่า
          </Button>
        </div>

        {loading ? (
          <Loading message="กำลังโหลดข้อมูล..." />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card className="p-3">
                <p className="text-xs text-gray-500">สินค้าปลายทางทั้งหมด</p>
                <p className="text-xl font-bold text-gray-900">{outputProducts.length}</p>
              </Card>
              <Card className="p-3">
                <p className="text-xs text-gray-500">บังคับวัตถุดิบหลัก</p>
                <p className="text-xl font-bold text-amber-700">{requiredCount}</p>
              </Card>
              <Card className="p-3">
                <p className="text-xs text-gray-500">ตั้งค่าวัตถุดิบครบแล้ว</p>
                <p className="text-xl font-bold text-emerald-700">{configuredCount}</p>
              </Card>
              <Card className="p-3">
                <p className="text-xs text-gray-500">ยังไม่ครบ</p>
                <p className="text-xl font-bold text-rose-700">{Math.max(requiredCount - configuredCount, 0)}</p>
              </Card>
            </div>

            <Card className="p-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">แผนกฝ่ายผลิต</label>
                  <select
                    value={departmentId}
                    onChange={async (event) => {
                      const nextDepartmentId = event.target.value;
                      setDepartmentId(nextDepartmentId);
                      try {
                        setLoading(true);
                        await loadOverview(Number(nextDepartmentId), search, null);
                      } catch (error) {
                        console.error(error);
                        alert(error?.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name} • {department.branch_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">ค้นหาสินค้าปลายทาง</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      placeholder="ชื่อสินค้า / รหัสสินค้า"
                    />
                    <Button
                      onClick={async () => {
                        try {
                          setLoading(true);
                          await loadOverview(Number(departmentId), search, selectedProductId);
                        } catch (error) {
                          console.error(error);
                          alert(error?.response?.data?.message || 'ค้นหาไม่สำเร็จ');
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      ค้นหา
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <Card className="lg:col-span-4 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-gray-900">รายการสินค้า ({outputProducts.length})</h2>
                </div>
                <div className="max-h-[68vh] overflow-y-auto space-y-1 pr-1">
                  {outputProducts.map((product) => {
                    const isSelected = Number(product.product_id) === Number(selectedProductId);
                    const ingredientCount = Array.isArray(product.required_ingredient_product_ids)
                      ? product.required_ingredient_product_ids.length
                      : 0;
                    return (
                      <button
                        key={product.product_id}
                        type="button"
                        onClick={() => setSelectedProductId(Number(product.product_id))}
                        className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                          isSelected
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">{product.product_name}</p>
                        <div className="mt-1 flex items-center justify-between">
                          <p className="text-xs text-gray-500">{product.product_code || '-'}</p>
                          <span className="text-xs text-gray-500">{ingredientCount} วัตถุดิบ</span>
                        </div>
                      </button>
                    );
                  })}
                  {outputProducts.length === 0 && (
                    <div className="px-2 py-4 text-sm text-gray-500 text-center">
                      ยังไม่พบสินค้าปลายทางที่ผูกกับแผนกนี้
                    </div>
                  )}
                </div>
              </Card>

              <Card className="lg:col-span-8 p-4 space-y-3">
                {!selectedProduct || !selectedForm ? (
                  <p className="text-sm text-gray-500">เลือกสินค้าปลายทางจากตารางด้านซ้าย</p>
                ) : (
                  <>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{selectedProduct.product_name}</p>
                      <p className="text-xs text-gray-500">
                        {selectedProduct.product_code || '-'} • {selectedProduct.unit_abbr || selectedProduct.unit_name || '-'}
                      </p>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-gray-800">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedForm.requires_base_ingredient)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          handleSelectedChange('requires_base_ingredient', checked);
                          if (!checked) {
                            handleSelectedChange('required_ingredient_product_ids', []);
                          }
                        }}
                      />
                      บังคับวัตถุดิบหลักก่อนแปรรูป
                    </label>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">เลือกกลุ่มสินค้า</label>
                      <div className="mb-2 flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => setSelectedIngredientGroup('all')}
                          disabled={!selectedForm.requires_base_ingredient}
                          className={`px-2 py-1 rounded-full text-xs border ${
                            selectedIngredientGroup === 'all'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-600 border-gray-300'
                          } disabled:bg-gray-100 disabled:text-gray-400`}
                        >
                          ทั้งหมด
                        </button>
                        {ingredientGroups.map((groupName) => (
                          <button
                            key={groupName}
                            type="button"
                            onClick={() => setSelectedIngredientGroup(groupName)}
                            disabled={!selectedForm.requires_base_ingredient}
                            className={`px-2 py-1 rounded-full text-xs border ${
                              selectedIngredientGroup === groupName
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-600 border-gray-300'
                            } disabled:bg-gray-100 disabled:text-gray-400`}
                          >
                            {groupName}
                          </button>
                        ))}
                      </div>
                      <label className="block text-xs text-gray-600 mb-1">ค้นหาวัตถุดิบหลัก</label>
                      <input
                        type="text"
                        value={ingredientSearch}
                        onChange={(event) => setIngredientSearch(event.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        placeholder="ชื่อสินค้า / รหัสสินค้า"
                        disabled={!selectedForm.requires_base_ingredient}
                      />
                    </div>

                    <div className="rounded-lg border border-gray-200 p-2 max-h-72 overflow-y-auto space-y-3">
                      {groupedIngredientOptions.map((group) => (
                        <div key={group.groupName} className="space-y-1">
                          <p className="text-xs font-semibold text-gray-600">{group.groupName}</p>
                          {group.items.map((ingredient) => {
                            const checked = (selectedForm.required_ingredient_product_ids || []).includes(Number(ingredient.id));
                            return (
                              <label key={ingredient.id} className="flex items-start gap-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!selectedForm.requires_base_ingredient}
                                  onChange={(event) => handleToggleIngredient(ingredient.id, event.target.checked)}
                                />
                                <span>
                                  {ingredient.name}
                                  <span className="text-xs text-gray-500 ml-1">
                                    {ingredient.code ? `(${ingredient.code})` : ''} {ingredient.unit_abbr || ingredient.unit_name || ''}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ))}
                      {groupedIngredientOptions.length === 0 && (
                        <div className="text-xs text-gray-500 py-2">ไม่พบวัตถุดิบตามคำค้นหา</div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => handleSelectedChange('required_ingredient_product_ids', [])}
                        disabled={!selectedForm.requires_base_ingredient}
                        fullWidth
                      >
                        ล้างวัตถุดิบ
                      </Button>
                      <Button onClick={handleSaveSelected} disabled={saving} fullWidth>
                        {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                      </Button>
                    </div>
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
