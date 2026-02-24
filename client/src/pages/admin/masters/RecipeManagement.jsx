import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { Input } from '../../../components/common/Input';
import { Select } from '../../../components/common/Select';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { recipesAPI } from '../../../api/recipes';
import { productsAPI } from '../../../api/products';
import { masterAPI } from '../../../api/master';
import { downloadCsv } from '../../../utils/csv';

const EMPTY_ITEM_FORM = { product_id: '', unit_id: '', quantity: '' };

export const RecipeManagement = () => {
  const [recipes, setRecipes] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [recipeSearch, setRecipeSearch] = useState('');

  const [menuSearch, setMenuSearch] = useState('');
  const [menuResults, setMenuResults] = useState([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState('');
  const [addingMenus, setAddingMenus] = useState(new Set());

  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [importingCombined, setImportingCombined] = useState(false);
  const [exportingCombined, setExportingCombined] = useState(false);
  const combinedFileRef = useRef(null);

  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState([]);
  const [productGroups, setProductGroups] = useState([]);

  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [recipeDetails, setRecipeDetails] = useState({});
  const [detailLoadingMap, setDetailLoadingMap] = useState({});

  const [productSearchMap, setProductSearchMap] = useState({});
  const [itemForms, setItemForms] = useState({});
  const [itemEdits, setItemEdits] = useState({});
  const [itemSavingMap, setItemSavingMap] = useState({});

  const [selectedRecipeIds, setSelectedRecipeIds] = useState(new Set());
  const [bulkForm, setBulkForm] = useState({ product_id: '', unit_id: '', quantity: '' });
  const [bulkProductSearch, setBulkProductSearch] = useState('');
  const [bulkProductGroupId, setBulkProductGroupId] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const fetchRecipeDetail = useCallback(async (recipeId, silent = false) => {
    if (!recipeId) return;
    if (!silent) {
      setDetailLoadingMap((prev) => ({ ...prev, [recipeId]: true }));
    }

    try {
      const response = await recipesAPI.getRecipeById(recipeId);
      const data = response?.data ?? response;
      setRecipeDetails((prev) => ({ ...prev, [recipeId]: data }));

      setItemEdits((prev) => {
        const next = { ...prev };
        (data?.items || []).forEach((item) => {
          next[item.id] = {
            unit_id: item.unit_id,
            quantity: item.quantity
          };
        });
        return next;
      });

      setItemForms((prev) => {
        if (prev[recipeId]) return prev;
        return { ...prev, [recipeId]: { ...EMPTY_ITEM_FORM } };
      });

      setProductSearchMap((prev) => {
        if (prev[recipeId] !== undefined) return prev;
        return { ...prev, [recipeId]: '' };
      });
    } catch (error) {
      console.error('Error fetching recipe detail:', error);
      if (!silent) {
        alert('ไม่สามารถโหลดรายละเอียดสูตรได้');
      }
    } finally {
      setDetailLoadingMap((prev) => ({ ...prev, [recipeId]: false }));
    }
  }, []);

  const fetchRecipes = useCallback(async () => {
    try {
      setListLoading(true);
      const data = await recipesAPI.getRecipes();
      setRecipes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching recipes:', error);
      setRecipes([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  const handleSearchMenus = useCallback(async (keywordOverride) => {
    const keyword = String(keywordOverride ?? menuSearch).trim();
    if (!keyword) {
      setMenuResults([]);
      setMenuError('');
      return;
    }

    try {
      setMenuLoading(true);
      setMenuError('');
      const data = await recipesAPI.searchMenus(keyword, 20);
      setMenuResults(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error searching menus:', error);
      setMenuResults([]);
      setMenuError('ไม่สามารถโหลดเมนูจาก ClickHouse ได้');
    } finally {
      setMenuLoading(false);
    }
  }, [menuSearch]);

  useEffect(() => {
    fetchRecipes();

    const loadMasterData = async () => {
      try {
        const [productRes, unitRes, groupRes] = await Promise.all([
          productsAPI.getProducts(),
          masterAPI.getUnits(),
          masterAPI.getProductGroups()
        ]);

        const productData = productRes?.data ?? productRes ?? [];
        setProducts(Array.isArray(productData) ? productData : []);
        setUnits(Array.isArray(unitRes) ? unitRes : []);
        setProductGroups(Array.isArray(groupRes) ? groupRes : []);
      } catch (error) {
        console.error('Error loading master data:', error);
        setProducts([]);
        setUnits([]);
        setProductGroups([]);
      }
    };

    loadMasterData();
  }, [fetchRecipes]);

  useEffect(() => {
    const keyword = menuSearch.trim();
    if (!keyword) {
      setMenuResults([]);
      setMenuError('');
      return undefined;
    }

    const timer = setTimeout(() => {
      handleSearchMenus(keyword);
    }, 350);

    return () => clearTimeout(timer);
  }, [menuSearch, handleSearchMenus]);

  const existingMenuBarcodes = useMemo(() => {
    return new Set((Array.isArray(recipes) ? recipes : []).map((recipe) => recipe.menu_barcode));
  }, [recipes]);

  const displayedRecipes = useMemo(() => {
    const keyword = recipeSearch.trim().toLowerCase();
    if (!keyword) return recipes;

    return recipes.filter((recipe) => {
      const menuName = String(recipe?.menu_name || '').toLowerCase();
      const barcode = String(recipe?.menu_barcode || '').toLowerCase();
      const unitName = String(recipe?.menu_unit_name || '').toLowerCase();
      return menuName.includes(keyword) || barcode.includes(keyword) || unitName.includes(keyword);
    });
  }, [recipeSearch, recipes]);

  useEffect(() => {
    if (displayedRecipes.length === 0) {
      setSelectedRecipeId(null);
      return;
    }

    if (!selectedRecipeId || !displayedRecipes.some((recipe) => recipe.id === selectedRecipeId)) {
      setSelectedRecipeId(displayedRecipes[0].id);
    }
  }, [displayedRecipes, selectedRecipeId]);

  const activeRecipe = useMemo(() => {
    if (!selectedRecipeId) return null;
    return displayedRecipes.find((recipe) => recipe.id === selectedRecipeId) || null;
  }, [displayedRecipes, selectedRecipeId]);

  useEffect(() => {
    if (!activeRecipe?.id) return;
    if (!recipeDetails[activeRecipe.id]) {
      fetchRecipeDetail(activeRecipe.id);
    }
  }, [activeRecipe, recipeDetails, fetchRecipeDetail]);

  const activeRecipeDetail = activeRecipe?.id ? recipeDetails[activeRecipe.id] : null;
  const activeRecipeLoading = activeRecipe?.id ? Boolean(detailLoadingMap[activeRecipe.id]) : false;

  const unitOptions = useMemo(
    () => (Array.isArray(units) ? units : []).map((unit) => ({
      value: unit.id,
      label: unit.abbreviation ? `${unit.name} (${unit.abbreviation})` : unit.name
    })),
    [units]
  );

  const productOptions = useMemo(
    () => (Array.isArray(products) ? products : []).map((product) => ({
      value: product.id,
      label: product.code ? `${product.name} (${product.code})` : product.name
    })),
    [products]
  );

  const productGroupOptions = useMemo(
    () => (Array.isArray(productGroups) ? productGroups : [])
      .filter((group) => Number(group?.id) > 0)
      .map((group) => ({ value: String(group.id), label: group.name || `กลุ่ม ${group.id}` })),
    [productGroups]
  );

  const filteredBulkProducts = useMemo(() => {
    if (!bulkProductGroupId) return products;

    const groupId = Number(bulkProductGroupId);
    if (!Number.isFinite(groupId)) return products;

    return products.filter((product) => {
      const groupIds = Array.isArray(product?.product_group_ids)
        ? product.product_group_ids.map((id) => Number(id))
        : [];
      return groupIds.includes(groupId);
    });
  }, [bulkProductGroupId, products]);

  const bulkProductOptions = useMemo(
    () => (Array.isArray(filteredBulkProducts) ? filteredBulkProducts : []).map((product) => ({
      value: product.id,
      label: product.code ? `${product.name} (${product.code})` : product.name
    })),
    [filteredBulkProducts]
  );

  const getBulkProductSuggestions = () => {
    const keyword = bulkProductSearch.trim().toLowerCase();
    if (!keyword) return [];
    return filteredBulkProducts
      .filter((product) => {
        const name = String(product?.name || '').toLowerCase();
        const code = String(product?.code || '').toLowerCase();
        return name.includes(keyword) || code.includes(keyword);
      })
      .slice(0, 10);
  };

  const getInlineProductSuggestions = (recipeId) => {
    const keyword = String(productSearchMap[recipeId] || '').trim().toLowerCase();
    if (!keyword) return [];

    return products
      .filter((product) => {
        const name = String(product?.name || '').toLowerCase();
        const code = String(product?.code || '').toLowerCase();
        return name.includes(keyword) || code.includes(keyword);
      })
      .slice(0, 10);
  };

  const handleSelectMenu = async (menu) => {
    const barcode = menu?.barcode;
    if (!barcode) return;
    if (existingMenuBarcodes.has(barcode) || addingMenus.has(barcode)) return;

    setAddingMenus((prev) => {
      const next = new Set(prev);
      next.add(barcode);
      return next;
    });

    try {
      await recipesAPI.createRecipe({
        menu_barcode: barcode,
        menu_name: menu?.name0,
        menu_unit_name: menu?.unitname || ''
      });
      await fetchRecipes();
    } catch (error) {
      console.error('Error creating recipe:', error);
      alert('ไม่สามารถสร้างสูตรเมนูได้');
    } finally {
      setAddingMenus((prev) => {
        const next = new Set(prev);
        next.delete(barcode);
        return next;
      });
    }
  };

  const handleDeleteRecipe = async (recipe) => {
    if (!recipe?.id) return;
    if (!confirm(`ลบสูตรเมนู "${recipe.menu_name}" ใช่หรือไม่?`)) return;

    try {
      await recipesAPI.deleteRecipe(recipe.id);
      setSelectedRecipeIds((prev) => {
        const next = new Set(prev);
        next.delete(recipe.id);
        return next;
      });
      await fetchRecipes();
    } catch (error) {
      console.error('Error deleting recipe:', error);
      alert('ลบสูตรไม่สำเร็จ');
    }
  };

  const handleAddItem = async (recipeId) => {
    const form = itemForms[recipeId];
    if (!form?.product_id || !form?.unit_id || form?.quantity === '') {
      alert('กรุณากรอกสินค้า หน่วย และปริมาณให้ครบถ้วน');
      return;
    }

    try {
      setItemSavingMap((prev) => ({ ...prev, [recipeId]: true }));
      await recipesAPI.addRecipeItem(recipeId, {
        product_id: Number(form.product_id),
        unit_id: Number(form.unit_id),
        quantity: Number(form.quantity)
      });

      setItemForms((prev) => ({ ...prev, [recipeId]: { ...EMPTY_ITEM_FORM } }));
      setProductSearchMap((prev) => ({ ...prev, [recipeId]: '' }));

      await fetchRecipeDetail(recipeId, true);
      await fetchRecipes();
    } catch (error) {
      console.error('Error adding recipe item:', error);
      alert('เพิ่มวัตถุดิบไม่สำเร็จ');
    } finally {
      setItemSavingMap((prev) => ({ ...prev, [recipeId]: false }));
    }
  };

  const handleUpdateItem = async (recipeId, itemId) => {
    const edit = itemEdits[itemId];
    if (!edit || edit.unit_id === '' || edit.quantity === '') {
      alert('กรุณากรอกหน่วยและปริมาณ');
      return;
    }

    try {
      setItemSavingMap((prev) => ({ ...prev, [recipeId]: true }));
      await recipesAPI.updateRecipeItem(itemId, {
        unit_id: Number(edit.unit_id),
        quantity: Number(edit.quantity)
      });
      await fetchRecipeDetail(recipeId, true);
      await fetchRecipes();
    } catch (error) {
      console.error('Error updating recipe item:', error);
      alert('อัปเดตวัตถุดิบไม่สำเร็จ');
    } finally {
      setItemSavingMap((prev) => ({ ...prev, [recipeId]: false }));
    }
  };

  const handleDeleteItem = async (recipeId, itemId) => {
    if (!confirm('ลบวัตถุดิบนี้ออกจากสูตรใช่หรือไม่?')) return;

    try {
      setItemSavingMap((prev) => ({ ...prev, [recipeId]: true }));
      await recipesAPI.deleteRecipeItem(itemId);
      await fetchRecipeDetail(recipeId, true);
      await fetchRecipes();
    } catch (error) {
      console.error('Error deleting recipe item:', error);
      alert('ลบวัตถุดิบไม่สำเร็จ');
    } finally {
      setItemSavingMap((prev) => ({ ...prev, [recipeId]: false }));
    }
  };

  const handleToggleRecipe = (recipeId) => {
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) {
        next.delete(recipeId);
      } else {
        next.add(recipeId);
      }
      return next;
    });
  };

  const allSelected = displayedRecipes.length > 0 && displayedRecipes.every((recipe) => selectedRecipeIds.has(recipe.id));

  const handleToggleAllRecipes = () => {
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        displayedRecipes.forEach((recipe) => next.delete(recipe.id));
      } else {
        displayedRecipes.forEach((recipe) => next.add(recipe.id));
      }
      return next;
    });
  };

  const handleBulkAddItem = async (event) => {
    event.preventDefault();

    if (selectedRecipeIds.size === 0) {
      alert('กรุณาเลือกเมนูอย่างน้อย 1 รายการ');
      return;
    }

    if (!bulkForm.product_id || !bulkForm.unit_id || bulkForm.quantity === '') {
      alert('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }

    try {
      setBulkSaving(true);
      const payload = {
        product_id: Number(bulkForm.product_id),
        unit_id: Number(bulkForm.unit_id),
        quantity: Number(bulkForm.quantity)
      };

      const results = await Promise.allSettled(
        Array.from(selectedRecipeIds).map((recipeId) => recipesAPI.addRecipeItem(Number(recipeId), payload))
      );

      const successCount = results.filter((item) => item.status === 'fulfilled').length;
      await fetchRecipes();
      if (activeRecipe?.id && selectedRecipeIds.has(activeRecipe.id)) {
        await fetchRecipeDetail(activeRecipe.id, true);
      }

      alert(`เพิ่มวัตถุดิบให้เมนูสำเร็จ ${successCount} รายการ`);
    } catch (error) {
      console.error('Bulk add error:', error);
      alert('เกิดข้อผิดพลาดในการเพิ่มวัตถุดิบหลายเมนู');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleDownloadCombinedTemplate = () => {
    downloadCsv(
      'recipe_import_template.csv',
      ['menu_barcode', 'menu_name', 'menu_unit_name', 'product_id', 'unit_id', 'quantity'],
      [['HL0008', 'ปลากะพงทอดน้ำปลา', 'จาน', '101', '3', '0.5']]
    );
  };

  const handleDownloadCombinedData = async () => {
    try {
      setExportingCombined(true);
      if (recipes.length === 0) {
        alert('ยังไม่มีสูตรเมนูให้ดาวน์โหลด');
        return;
      }

      const details = await Promise.all(recipes.map((recipe) => recipesAPI.getRecipeById(recipe.id)));
      const headers = ['menu_barcode', 'menu_name', 'menu_unit_name', 'product_id', 'unit_id', 'quantity'];
      const rows = [];

      details.forEach((response) => {
        const recipe = response?.data ?? response;
        if (!recipe) return;

        const items = recipe.items || [];
        if (items.length === 0) {
          rows.push([recipe.menu_barcode, recipe.menu_name, recipe.menu_unit_name || '', '', '', '']);
          return;
        }

        items.forEach((item) => {
          rows.push([
            recipe.menu_barcode,
            recipe.menu_name,
            recipe.menu_unit_name || '',
            item.product_id,
            item.unit_id,
            item.quantity
          ]);
        });
      });

      downloadCsv('recipes_data.csv', headers, rows);
    } catch (error) {
      console.error('Download recipe data failed:', error);
      alert('ดาวน์โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setExportingCombined(false);
    }
  };

  const handleImportCombined = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      setImportingCombined(true);
      alert('ฟังก์ชันนำเข้าไฟล์จะอัปเดตต่อในรอบถัดไป');
      await fetchRecipes();
    } finally {
      setImportingCombined(false);
    }
  };

  const activeSuggestions = activeRecipe?.id ? getInlineProductSuggestions(activeRecipe.id) : [];

  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] pb-8">
        <div className="mb-4">
          <BackToSettings />
        </div>

        <div className="mb-4 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-600 to-teal-500 p-5 text-white">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">ตั้งค่าสูตรเมนู</h1>
              <p className="mt-1 text-sm text-emerald-100">ซ้าย: รายการเมนู | ขวา: รายละเอียดเมนูและเพิ่มวัตถุดิบ</p>
            </div>
            <div className="rounded-xl bg-white/15 px-4 py-2 text-sm">
              <span className="font-semibold">สูตรทั้งหมด:</span> {recipes.length}
            </div>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full lg:max-w-xl">
              <h2 className="mb-1 text-base font-semibold text-gray-900">ค้นหาเมนูจาก ClickHouse แล้วเพิ่มเป็นสูตร</h2>
              <div className="flex gap-2">
                <Input
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  placeholder="พิมพ์ชื่อเมนูหรือบาร์โค้ด"
                />
                <button
                  type="button"
                  onClick={() => handleSearchMenus()}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  {menuLoading ? 'กำลังค้นหา...' : 'ค้นหา'}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvancedTools((prev) => !prev)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {showAdvancedTools ? 'ซ่อนเครื่องมือขั้นสูง' : 'แสดงเครื่องมือขั้นสูง'}
            </button>
          </div>

          {menuResults.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {menuResults.map((menu) => {
                const isAdded = existingMenuBarcodes.has(menu.barcode);
                const isSaving = addingMenus.has(menu.barcode);
                return (
                  <div key={menu.barcode} className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
                    <div className="min-w-0 pr-2">
                      <p className="truncate text-sm font-semibold text-gray-900">{menu.name0}</p>
                      <p className="truncate text-xs text-gray-500">{menu.barcode} {menu.unitname ? `• ${menu.unitname}` : ''}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectMenu(menu)}
                      disabled={isAdded || isSaving}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        isAdded
                          ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                          : isSaving
                            ? 'cursor-not-allowed bg-emerald-50 text-emerald-600'
                            : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                      }`}
                    >
                      {isAdded ? 'มีแล้ว' : isSaving ? 'กำลังเพิ่ม...' : 'เพิ่ม'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {menuError && <p className="mt-3 text-sm text-red-500">{menuError}</p>}
        </div>

        {showAdvancedTools && (
          <div className="mb-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">นำเข้า/ส่งออก CSV</h3>
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleDownloadCombinedTemplate} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    ดาวน์โหลดเทมเพลต
                  </button>
                  <button onClick={handleDownloadCombinedData} disabled={exportingCombined} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    {exportingCombined ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลดข้อมูล'}
                  </button>
                  <button onClick={() => combinedFileRef.current?.click()} disabled={importingCombined} className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800">
                    {importingCombined ? 'กำลังนำเข้า...' : 'นำเข้าไฟล์'}
                  </button>
                  <input ref={combinedFileRef} type="file" accept=".csv" className="hidden" onChange={handleImportCombined} />
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-emerald-800">ยิงวัตถุดิบเข้าหลายเมนูพร้อมกัน</h3>
                <form onSubmit={handleBulkAddItem} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">เลือกแล้ว {selectedRecipeIds.size}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleToggleAllRecipes} className="text-xs text-gray-600 underline">{allSelected ? 'เอาออกทั้งหมด' : 'เลือกทั้งหมดที่แสดง'}</button>
                      <button type="button" onClick={() => setSelectedRecipeIds(new Set())} className="text-xs text-red-500 underline">ล้าง</button>
                    </div>
                  </div>
                  <Select
                    value={bulkProductGroupId}
                    onChange={(e) => {
                      setBulkProductGroupId(e.target.value);
                      setBulkProductSearch('');
                      setBulkForm((prev) => ({ ...prev, product_id: '' }));
                    }}
                    options={productGroupOptions}
                    placeholder="เลือกกลุ่มสินค้า (วัตถุดิบ)"
                  />
                  <Input value={bulkProductSearch} onChange={e => setBulkProductSearch(e.target.value)} placeholder="ค้นหาวัตถุดิบ" />

                  {getBulkProductSuggestions().length > 0 && (
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                      {getBulkProductSuggestions().map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => {
                            setBulkForm((prev) => ({ ...prev, product_id: product.id, unit_id: prev.unit_id || product.unit_id || '' }));
                            setBulkProductSearch(product.name);
                          }}
                          className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-emerald-50"
                        >
                          {product.name} <span className="text-xs text-gray-400">{product.code}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <Select value={bulkForm.product_id} onChange={e => setBulkForm({ ...bulkForm, product_id: e.target.value })} options={bulkProductOptions} placeholder="สินค้า" />
                    <Select value={bulkForm.unit_id} onChange={e => setBulkForm({ ...bulkForm, unit_id: e.target.value })} options={unitOptions} placeholder="หน่วย" />
                    <Input type="number" step="0.01" min="0" value={bulkForm.quantity} onChange={e => setBulkForm({ ...bulkForm, quantity: e.target.value })} placeholder="จำนวน" />
                  </div>
                  <button type="submit" disabled={bulkSaving} className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                    {bulkSaving ? 'กำลังบันทึก...' : `บันทึกลง ${selectedRecipeIds.size} เมนู`}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 p-4">
              <h2 className="text-sm font-semibold text-gray-900">รายการเมนู</h2>
              <div className="mt-2">
                <Input value={recipeSearch} onChange={(e) => setRecipeSearch(e.target.value)} placeholder="ค้นหาเมนู / บาร์โค้ด" />
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-2">
              {listLoading ? (
                <div className="p-4 text-sm text-gray-500">กำลังโหลดเมนู...</div>
              ) : displayedRecipes.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">ไม่พบเมนู</div>
              ) : (
                displayedRecipes.map((recipe) => (
                  <button
                    key={recipe.id}
                    type="button"
                    onClick={() => setSelectedRecipeId(recipe.id)}
                    className={`mb-2 w-full rounded-xl border p-3 text-left transition ${
                      recipe.id === activeRecipe?.id ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {showAdvancedTools && (
                        <input
                          type="checkbox"
                          checked={selectedRecipeIds.has(recipe.id)}
                          onChange={(event) => {
                            event.stopPropagation();
                            handleToggleRecipe(recipe.id);
                          }}
                          onClick={(event) => event.stopPropagation()}
                          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">{recipe.menu_name}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{recipe.menu_barcode} • วัตถุดิบ {recipe.item_count || 0}</p>
                        {(Number(recipe.item_count || 0) === 0) && (
                          <p className="mt-1 text-xs font-medium text-red-600">ยังไม่มีวัตถุดิบ</p>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="rounded-2xl border border-gray-200 bg-white">
            {!activeRecipe ? (
              <div className="p-8 text-center text-sm text-gray-500">เลือกเมนูจากฝั่งซ้ายเพื่อดูรายละเอียด</div>
            ) : (
              <>
                <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{activeRecipe.menu_name}</h3>
                    <p className="text-xs text-gray-500">{activeRecipe.menu_barcode} • หน่วยขาย: {activeRecipe.menu_unit_name || '-'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteRecipe(activeRecipe)}
                    className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    ลบสูตร
                  </button>
                </div>

                {activeRecipeLoading ? (
                  <div className="p-6 text-sm text-gray-500">กำลังโหลดวัตถุดิบ...</div>
                ) : (
                  <div className="space-y-4 p-4">
                    <div>
                      <h4 className="mb-2 text-sm font-semibold text-gray-900">วัตถุดิบในสูตร ({(activeRecipeDetail?.items || []).length})</h4>
                      {(activeRecipeDetail?.items || []).length === 0 ? (
                        <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">ยังไม่มีวัตถุดิบในสูตรนี้</div>
                      ) : (
                        <div className="space-y-2">
                          {(activeRecipeDetail?.items || []).map((item) => {
                            const edit = itemEdits[item.id] || {};
                            const saving = itemSavingMap[activeRecipe.id];
                            return (
                              <div key={item.id} className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 lg:grid-cols-[minmax(0,1fr),120px,120px,auto,auto] lg:items-center">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-gray-900">{item.product_name}</p>
                                  <p className="text-xs text-gray-500">{item.product_code || '-'}</p>
                                </div>
                                <Select
                                  value={edit.unit_id ?? ''}
                                  onChange={(e) => setItemEdits((prev) => ({ ...prev, [item.id]: { ...prev[item.id], unit_id: e.target.value } }))}
                                  options={unitOptions}
                                />
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={edit.quantity ?? ''}
                                  onChange={(e) => setItemEdits((prev) => ({ ...prev, [item.id]: { ...prev[item.id], quantity: e.target.value } }))}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleUpdateItem(activeRecipe.id, item.id)}
                                  disabled={saving}
                                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  บันทึก
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteItem(activeRecipe.id, item.id)}
                                  disabled={saving}
                                  className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                >
                                  ลบ
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <h4 className="mb-2 text-sm font-semibold text-emerald-900">เพิ่มวัตถุดิบ</h4>
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr),140px,140px,auto]">
                        <div className="relative">
                          <Input
                            value={productSearchMap[activeRecipe.id] || ''}
                            onChange={(e) => setProductSearchMap((prev) => ({ ...prev, [activeRecipe.id]: e.target.value }))}
                            placeholder="ค้นหาวัตถุดิบ (ชื่อ/รหัส)"
                          />
                          {activeSuggestions.length > 0 && (
                            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                              {activeSuggestions.map((product) => (
                                <button
                                  key={product.id}
                                  type="button"
                                  onClick={() => {
                                    setItemForms((prev) => ({
                                      ...prev,
                                      [activeRecipe.id]: {
                                        product_id: product.id,
                                        unit_id: product.unit_id || '',
                                        quantity: prev[activeRecipe.id]?.quantity || ''
                                      }
                                    }));
                                    setProductSearchMap((prev) => ({ ...prev, [activeRecipe.id]: product.name }));
                                  }}
                                  className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-emerald-50"
                                >
                                  {product.name} <span className="text-xs text-gray-500">{product.code || '-'}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <Select
                          value={itemForms[activeRecipe.id]?.unit_id || ''}
                          onChange={(e) => setItemForms((prev) => ({ ...prev, [activeRecipe.id]: { ...prev[activeRecipe.id], unit_id: e.target.value } }))}
                          options={unitOptions}
                          placeholder="หน่วย"
                        />
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={itemForms[activeRecipe.id]?.quantity || ''}
                          onChange={(e) => setItemForms((prev) => ({ ...prev, [activeRecipe.id]: { ...prev[activeRecipe.id], quantity: e.target.value } }))}
                          placeholder="จำนวน"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddItem(activeRecipe.id)}
                          disabled={itemSavingMap[activeRecipe.id]}
                          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                        >
                          เพิ่มวัตถุดิบ
                        </button>
                      </div>

                      <div className="mt-2">
                        <Select
                          value={itemForms[activeRecipe.id]?.product_id || ''}
                          onChange={(e) => setItemForms((prev) => ({ ...prev, [activeRecipe.id]: { ...prev[activeRecipe.id], product_id: e.target.value } }))}
                          options={productOptions}
                          placeholder="หรือเลือกสินค้าโดยตรง"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
};
