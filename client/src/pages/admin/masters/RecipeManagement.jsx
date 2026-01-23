import { useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { Select } from '../../../components/common/Select';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { recipesAPI } from '../../../api/recipes';
import { productsAPI } from '../../../api/products';
import { masterAPI } from '../../../api/master';
import { parseCsv, downloadCsv } from '../../../utils/csv';

export const RecipeManagement = () => {
  const [recipes, setRecipes] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');
  const [menuResults, setMenuResults] = useState([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [itemForm, setItemForm] = useState({ product_id: '', unit_id: '', quantity: '' });
  const [itemEdits, setItemEdits] = useState({});
  const [itemSaving, setItemSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importingCombined, setImportingCombined] = useState(false);
  const [exportingCombined, setExportingCombined] = useState(false);
  const [addingMenus, setAddingMenus] = useState(new Set());
  const [selectedRecipeIds, setSelectedRecipeIds] = useState(new Set());
  const [bulkForm, setBulkForm] = useState({ product_id: '', unit_id: '', quantity: '' });
  const [bulkProductSearch, setBulkProductSearch] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const combinedFileRef = useRef(null);

  useEffect(() => {
    fetchRecipes();
    fetchProducts();
    fetchUnits();
  }, []);

  useEffect(() => {
    const keyword = menuSearch.trim();
    if (!keyword) {
      setMenuResults([]);
      setMenuError('');
      return undefined;
    }

    const timer = setTimeout(() => {
      handleSearchMenus(keyword);
    }, 400);

    return () => clearTimeout(timer);
  }, [menuSearch]);

  const fetchRecipes = async () => {
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
  };

  const fetchProducts = async () => {
    try {
      const response = await productsAPI.getProducts();
      const data = response?.data ?? response ?? [];
      setProducts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching products:', error);
      setProducts([]);
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

  const handleSearchMenus = async (termOverride) => {
    const term = (termOverride ?? menuSearch).trim();
    if (!term) {
      setMenuResults([]);
      setMenuError('');
      return;
    }

    try {
      setMenuLoading(true);
      setMenuError('');
      const data = await recipesAPI.searchMenus(term, 20);
      setMenuResults(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error searching menus:', error);
      setMenuResults([]);
      setMenuError('ไม่สามารถโหลดเมนูจาก ClickHouse ได้');
    } finally {
      setMenuLoading(false);
    }
  };

  const handleSelectMenu = async (menu) => {
    const barcode = menu.barcode;
    if (existingMenuBarcodes.has(barcode) || addingMenus.has(barcode)) {
      return;
    }
    setAddingMenus((prev) => {
      const next = new Set(prev);
      next.add(barcode);
      return next;
    });
    try {
      await recipesAPI.createRecipe({
        menu_barcode: barcode,
        menu_name: menu.name0,
        menu_unit_name: menu.unitname || ''
      });
      fetchRecipes();
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

  const openRecipeDetail = async (recipe) => {
    setIsModalOpen(true);
    setSelectedRecipe(null);
    setItemForm({ product_id: '', unit_id: '', quantity: '' });
    setProductSearch('');
    setItemEdits({});
    setDetailLoading(true);

    try {
      const response = await recipesAPI.getRecipeById(recipe.id);
      const data = response?.data ?? response;
      setSelectedRecipe(data);
      setItemEdits(
        (data?.items || []).reduce((acc, item) => {
          acc[item.id] = {
            unit_id: item.unit_id,
            quantity: item.quantity
          };
          return acc;
        }, {})
      );
    } catch (error) {
      console.error('Error fetching recipe detail:', error);
      alert('ไม่สามารถโหลดรายละเอียดสูตรได้');
      setIsModalOpen(false);
    } finally {
      setDetailLoading(false);
    }

    if (products.length === 0) {
      fetchProducts();
    }
    if (units.length === 0) {
      fetchUnits();
    }
  };

  const handleDeleteRecipe = async (recipe) => {
    if (!confirm(`ลบสูตรเมนู "${recipe.menu_name}" ใช่หรือไม่?`)) {
      return;
    }
    try {
      await recipesAPI.deleteRecipe(recipe.id);
      fetchRecipes();
    } catch (error) {
      console.error('Error deleting recipe:', error);
      alert('ลบสูตรไม่สำเร็จ');
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

  const handleToggleAllRecipes = () => {
    setSelectedRecipeIds((prev) => {
      if (prev.size === recipes.length) {
        return new Set();
      }
      return new Set(recipes.map((recipe) => recipe.id));
    });
  };

  const handleBulkAddItem = async (event) => {
    event.preventDefault();
    if (selectedRecipeIds.size === 0) {
      alert('กรุณาเลือกเมนูอย่างน้อย 1 รายการ');
      return;
    }
    if (!bulkForm.product_id || !bulkForm.unit_id || bulkForm.quantity === '') {
      alert('กรุณากรอกสินค้า หน่วย และปริมาณ');
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
        Array.from(selectedRecipeIds).map((recipeId) =>
          recipesAPI.addRecipeItem(Number(recipeId), payload)
        )
      );
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failedCount = results.length - successCount;
      fetchRecipes();
      alert(
        `เพิ่มวัตถุดิบให้เมนูสำเร็จ ${successCount} รายการ` +
          (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : '')
      );
    } catch (error) {
      console.error('Error bulk adding items:', error);
      alert('เพิ่มวัตถุดิบแบบหลายเมนูไม่สำเร็จ');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleDownloadCombinedTemplate = () => {
    const headers = ['menu_barcode', 'menu_name', 'menu_unit_name', 'product_id', 'unit_id', 'quantity'];
    const rows = [
      ['HL0008', 'ปลากะพงทอดน้ำปลา', 'จาน', '101', '3', '0.5'],
      ['HL0008', 'ปลากะพงทอดน้ำปลา', 'จาน', '102', '3', '0.1']
    ];
    downloadCsv('recipe_import_template.csv', headers, rows);
  };

  const handleDownloadCombinedData = async () => {
    try {
      setExportingCombined(true);
      const recipesData = await recipesAPI.getRecipes();
      const list = Array.isArray(recipesData) ? recipesData : [];
      if (list.length === 0) {
        alert('ยังไม่มีสูตรเมนูให้ดาวน์โหลด');
        return;
      }

      const details = await Promise.all(
        list.map((recipe) => recipesAPI.getRecipeById(recipe.id))
      );

      const headers = ['menu_barcode', 'menu_name', 'menu_unit_name', 'product_id', 'unit_id', 'quantity'];
      const rows = [];

      details.forEach((response) => {
        const recipe = response?.data ?? response;
        if (!recipe) return;
        const items = recipe.items || [];

        if (items.length === 0) {
          rows.push([
            recipe.menu_barcode,
            recipe.menu_name,
            recipe.menu_unit_name || '',
            '',
            '',
            ''
          ]);
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
      console.error('Error downloading recipe data:', error);
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
      const text = await file.text();
      const { rows } = parseCsv(text);
      const recipeMapInput = new Map();
      const itemRows = [];
      let skippedItems = 0;

      rows.forEach((row) => {
        const menuBarcode = row.menu_barcode;
        const menuName = row.menu_name;
        const menuUnitName = row.menu_unit_name;
        if (menuBarcode && menuName && !recipeMapInput.has(menuBarcode)) {
          recipeMapInput.set(menuBarcode, {
            menu_barcode: menuBarcode,
            menu_name: menuName,
            menu_unit_name: menuUnitName
          });
        }

        const hasItem = row.product_id && row.unit_id && row.quantity !== '';
        if (menuBarcode && hasItem) {
          itemRows.push({
            menu_barcode: menuBarcode,
            product_id: row.product_id,
            unit_id: row.unit_id,
            quantity: row.quantity
          });
        } else if (menuBarcode && (row.product_id || row.unit_id || row.quantity !== '')) {
          skippedItems += 1;
        }
      });

      if (recipeMapInput.size === 0 && itemRows.length === 0) {
        alert('ไม่พบข้อมูลที่นำเข้าได้');
        return;
      }

      const recipePayloads = Array.from(recipeMapInput.values());
      const recipeResults = await Promise.allSettled(
        recipePayloads.map((payload) => recipesAPI.createRecipe(payload))
      );
      const recipeSuccess = recipeResults.filter((r) => r.status === 'fulfilled').length;
      const recipeFailed = recipeResults.length - recipeSuccess;

      const recipesData = await recipesAPI.getRecipes();
      const recipeIdMap = new Map(
        (Array.isArray(recipesData) ? recipesData : []).map((recipe) => [recipe.menu_barcode, recipe.id])
      );
      const missingRecipes = new Set();
      const itemPayloads = itemRows
        .map((item) => {
          const recipeId = recipeIdMap.get(item.menu_barcode);
          if (!recipeId) {
            missingRecipes.add(item.menu_barcode);
            return null;
          }
          const productId = Number(item.product_id);
          const unitId = Number(item.unit_id);
          const quantity = Number(item.quantity);
          if (!Number.isFinite(productId) || !Number.isFinite(unitId) || !Number.isFinite(quantity)) {
            skippedItems += 1;
            return null;
          }
          return {
            recipeId,
            product_id: productId,
            unit_id: unitId,
            quantity
          };
        })
        .filter(Boolean);

      const itemResults = await Promise.allSettled(
        itemPayloads.map((payload) =>
          recipesAPI.addRecipeItem(payload.recipeId, {
            product_id: payload.product_id,
            unit_id: payload.unit_id,
            quantity: payload.quantity
          })
        )
      );
      const itemSuccess = itemResults.filter((r) => r.status === 'fulfilled').length;
      const itemFailed = itemResults.length - itemSuccess;

      fetchRecipes();

      let message = `นำเข้าสูตรเมนูสำเร็จ ${recipeSuccess} รายการ`;
      if (recipeFailed) {
        message += `, สูตรล้มเหลว ${recipeFailed} รายการ`;
      }
      message += `\nนำเข้าวัตถุดิบสำเร็จ ${itemSuccess} รายการ`;
      if (itemFailed) {
        message += `, วัตถุดิบล้มเหลว ${itemFailed} รายการ`;
      }
      if (missingRecipes.size > 0) {
        message += `\nไม่พบสูตรเมนูสำหรับ ${missingRecipes.size} รายการ`;
      }
      if (skippedItems > 0) {
        message += `\nข้ามรายการวัตถุดิบ ${skippedItems} รายการ (ข้อมูลไม่ครบ)`;
      }
      alert(message);
    } catch (error) {
      console.error('Error importing combined recipes:', error);
      alert('นำเข้าข้อมูลไม่สำเร็จ');
    } finally {
      setImportingCombined(false);
    }
  };

  const handleAddItem = async (event) => {
    event.preventDefault();
    if (!selectedRecipe) return;
    if (!itemForm.product_id || !itemForm.unit_id || itemForm.quantity === '') {
      alert('กรุณากรอกสินค้า หน่วย และปริมาณ');
      return;
    }

    try {
      setItemSaving(true);
      await recipesAPI.addRecipeItem(selectedRecipe.id, {
        product_id: Number(itemForm.product_id),
        unit_id: Number(itemForm.unit_id),
        quantity: Number(itemForm.quantity)
      });
      openRecipeDetail({ id: selectedRecipe.id });
      fetchRecipes();
    } catch (error) {
      console.error('Error adding recipe item:', error);
      alert('เพิ่มวัตถุดิบไม่สำเร็จ');
    } finally {
      setItemSaving(false);
    }
  };

  const handleUpdateItem = async (itemId) => {
    const next = itemEdits[itemId];
    if (!next) return;
    if (next.unit_id === '' || next.quantity === '') {
      alert('กรุณากรอกหน่วยและปริมาณ');
      return;
    }

    try {
      setItemSaving(true);
      await recipesAPI.updateRecipeItem(itemId, {
        unit_id: Number(next.unit_id),
        quantity: Number(next.quantity)
      });
      openRecipeDetail({ id: selectedRecipe.id });
      fetchRecipes();
    } catch (error) {
      console.error('Error updating recipe item:', error);
      alert('อัปเดตวัตถุดิบไม่สำเร็จ');
    } finally {
      setItemSaving(false);
    }
  };

  const handleDeleteItem = async (itemId) => {
    if (!confirm('ลบวัตถุดิบนี้ออกจากสูตรใช่หรือไม่?')) {
      return;
    }
    try {
      setItemSaving(true);
      await recipesAPI.deleteRecipeItem(itemId);
      openRecipeDetail({ id: selectedRecipe.id });
      fetchRecipes();
    } catch (error) {
      console.error('Error deleting recipe item:', error);
      alert('ลบวัตถุดิบไม่สำเร็จ');
    } finally {
      setItemSaving(false);
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

  const existingMenuBarcodes = useMemo(() => {
    const list = Array.isArray(recipes) ? recipes : [];
    return new Set(list.map((recipe) => recipe.menu_barcode));
  }, [recipes]);

  const bulkFilteredProducts = useMemo(() => {
    const keyword = bulkProductSearch.trim().toLowerCase();
    const list = Array.isArray(products) ? products : [];
    if (!keyword) return list.slice(0, 200);

    return list
      .filter((product) => {
        const name = String(product.name || '').toLowerCase();
        const code = String(product.code || '').toLowerCase();
        return name.includes(keyword) || code.includes(keyword);
      })
      .slice(0, 200);
  }, [bulkProductSearch, products]);

  const bulkSelectedProduct = useMemo(() => {
    if (!bulkForm.product_id) return null;
    return products.find((product) => String(product.id) === String(bulkForm.product_id));
  }, [products, bulkForm.product_id]);

  const bulkSuggestions = useMemo(() => {
    const keyword = bulkProductSearch.trim().toLowerCase();
    if (!keyword) return [];
    if (bulkSelectedProduct && bulkSelectedProduct.name?.toLowerCase() === keyword) {
      return [];
    }
    return bulkFilteredProducts.slice(0, 10);
  }, [bulkFilteredProducts, bulkProductSearch, bulkSelectedProduct]);

  const handleSelectBulkProduct = (product) => {
    setBulkForm((prev) => ({
      ...prev,
      product_id: product.id,
      unit_id: prev.unit_id || product.unit_id || ''
    }));
    setBulkProductSearch(product.name || '');
  };

  const filteredProducts = useMemo(() => {
    const keyword = productSearch.trim().toLowerCase();
    const list = Array.isArray(products) ? products : [];
    if (!keyword) return list.slice(0, 200);

    return list
      .filter((product) => {
        const name = String(product.name || '').toLowerCase();
        const code = String(product.code || '').toLowerCase();
        return name.includes(keyword) || code.includes(keyword);
      })
      .slice(0, 200);
  }, [productSearch, products]);

  const selectedProduct = useMemo(() => {
    if (!itemForm.product_id) return null;
    return products.find((product) => String(product.id) === String(itemForm.product_id));
  }, [products, itemForm.product_id]);

  const suggestionProducts = useMemo(() => {
    const keyword = productSearch.trim().toLowerCase();
    if (!keyword) return [];
    if (selectedProduct && selectedProduct.name?.toLowerCase() === keyword) {
      return [];
    }
    return filteredProducts.slice(0, 10);
  }, [filteredProducts, productSearch, selectedProduct]);

  const handleSelectProduct = (product) => {
    setItemForm((prev) => ({
      ...prev,
      product_id: product.id,
      unit_id: prev.unit_id || product.unit_id || ''
    }));
    setProductSearch(product.name || '');
  };

  const productOptions = useMemo(
    () =>
      filteredProducts.map((product) => ({
        value: product.id,
        label: product.code ? `${product.name} (${product.code})` : product.name
      })),
    [filteredProducts]
  );

  const bulkProductOptions = useMemo(
    () =>
      bulkFilteredProducts.map((product) => ({
        value: product.id,
        label: product.code ? `${product.name} (${product.code})` : product.name
      })),
    [bulkFilteredProducts]
  );

  const allSelected = recipes.length > 0 && selectedRecipeIds.size === recipes.length;

  const columns = [
    {
      header: (
        <input
          type="checkbox"
          checked={allSelected}
          onChange={handleToggleAllRecipes}
          aria-label="เลือกทั้งหมด"
        />
      ),
      accessor: 'select',
      sortable: false,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedRecipeIds.has(row.id)}
          onChange={() => handleToggleRecipe(row.id)}
          aria-label={`เลือกเมนู ${row.menu_name}`}
        />
      )
    },
    { header: 'เมนู', accessor: 'menu_name', wrap: true },
    { header: 'Barcode', accessor: 'menu_barcode' },
    { header: 'หน่วยขาย', accessor: 'menu_unit_name' },
    { header: 'จำนวนวัตถุดิบ', accessor: 'item_count' }
  ];

  return (
    <Layout>
      <div className="max-w-full mx-auto">
        <div className="mb-3">
          <BackToSettings />
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">ตั้งค่าสูตรเมนู</h1>
          <p className="text-sm text-gray-500 mt-1">
            ดึงเมนูจาก ClickHouse แล้วผูกวัตถุดิบที่ใช้ในระบบของเรา
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">นำเข้าสูตรเมนูแบบรวดเร็ว</h2>
              <p className="text-sm text-gray-500">
                ใช้ไฟล์ CSV เดียวสำหรับเพิ่มสูตรเมนูและวัตถุดิบหลายรายการ
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDownloadCombinedTemplate}
                className="px-3 py-1.5 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                ดาวน์โหลดเทมเพลตรวม
              </button>
              <button
                type="button"
                onClick={handleDownloadCombinedData}
                className="px-3 py-1.5 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                disabled={exportingCombined}
              >
                {exportingCombined ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลดข้อมูลสูตร'}
              </button>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm text-gray-500">
              - ไฟล์เดียว: menu_barcode, menu_name, menu_unit_name, product_id, unit_id, quantity
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => combinedFileRef.current?.click()}
                className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                disabled={importingCombined}
              >
                {importingCombined ? 'กำลังนำเข้า...' : 'นำเข้าเทมเพลตรวม'}
              </button>
            </div>
          </div>
          <input
            ref={combinedFileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportCombined}
          />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">เพิ่มวัตถุดิบแบบหลายเมนู</h2>
              <p className="text-sm text-gray-500">
                เลือกเมนูจากตารางด้านล่าง แล้วเพิ่มวัตถุดิบเดียวกันให้พร้อมกัน
              </p>
            </div>
            <div className="text-sm text-gray-500">
              เลือกแล้ว {selectedRecipeIds.size} เมนู
            </div>
          </div>
          <form onSubmit={handleBulkAddItem} className="space-y-3">
            <Input
              label="ค้นหาสินค้า"
              value={bulkProductSearch}
              onChange={(e) => setBulkProductSearch(e.target.value)}
              placeholder="พิมพ์ชื่อหรือรหัสสินค้า"
            />
            {bulkSuggestions.length > 0 && (
              <div className="border rounded-lg bg-white max-h-48 overflow-y-auto">
                {bulkSuggestions.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handleSelectBulkProduct(product)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    <div className="font-medium text-gray-900">{product.name}</div>
                    <div className="text-xs text-gray-500">
                      {product.code || '-'} • {product.unit_abbr || product.unit_name || '-'}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {bulkSelectedProduct && (
              <div className="text-xs text-gray-500">
                เลือกแล้ว: {bulkSelectedProduct.name} {bulkSelectedProduct.code ? `(${bulkSelectedProduct.code})` : ''}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                label="สินค้า"
                value={bulkForm.product_id}
                onChange={(e) => setBulkForm({ ...bulkForm, product_id: e.target.value })}
                options={bulkProductOptions}
                placeholder="เลือกสินค้า"
              />
              <Select
                label="หน่วย"
                value={bulkForm.unit_id}
                onChange={(e) => setBulkForm({ ...bulkForm, unit_id: e.target.value })}
                options={unitOptions}
                placeholder="เลือกหน่วย"
              />
              <Input
                label="ปริมาณต่อ 1 เมนู"
                type="number"
                step="0.01"
                min="0"
                value={bulkForm.quantity}
                onChange={(e) => setBulkForm({ ...bulkForm, quantity: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedRecipeIds(new Set())}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                ล้างที่เลือก
              </button>
              <button
                type="submit"
                disabled={bulkSaving}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-emerald-300"
              >
                {bulkSaving ? 'กำลังเพิ่ม...' : 'เพิ่มให้เมนูที่เลือก'}
              </button>
            </div>
          </form>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <Input
              label="ค้นหาเมนูจาก ClickHouse"
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="พิมพ์ชื่อเมนูหรือ barcode"
            />
            <button
              type="button"
              onClick={() => handleSearchMenus()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {menuLoading ? 'กำลังค้นหา...' : 'ค้นหาเมนู'}
            </button>
          </div>
          {menuResults.length > 0 && (
            <div className="mt-4 border rounded-lg divide-y">
              {menuResults.map((menu) => {
                const isAdded = existingMenuBarcodes.has(menu.barcode);
                const isSaving = addingMenus.has(menu.barcode);
                return (
                  <div key={menu.barcode} className="p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900">{menu.name0}</p>
                      <p className="text-xs text-gray-500">
                        {menu.barcode} • {menu.unitname || '-'} {menu.groupnames ? `• ${menu.groupnames}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectMenu(menu)}
                      disabled={isAdded || isSaving}
                      className={`px-3 py-1.5 border rounded-lg text-sm ${
                        isAdded
                          ? 'text-emerald-600 border-emerald-200 bg-emerald-50 cursor-not-allowed'
                          : isSaving
                            ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                            : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {isAdded ? 'มีสูตรแล้ว' : isSaving ? 'กำลังเพิ่ม...' : 'เพิ่มเป็นสูตร'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {menuResults.length === 0 && menuSearch && !menuLoading && (
            <p className="text-sm text-gray-500 mt-3">ไม่พบเมนูที่ตรงกับคำค้นหา</p>
          )}
          {menuError && (
            <p className="text-sm text-red-500 mt-3">{menuError}</p>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          {listLoading ? (
            <p className="text-sm text-gray-500">กำลังโหลดสูตรเมนู...</p>
          ) : (
            <DataTable
              columns={columns}
              data={recipes}
              renderActions={(row) => (
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => openRecipeDetail(row)}
                    className="text-blue-600 hover:text-blue-900"
                  >
                    จัดการวัตถุดิบ
                  </button>
                  <button
                    onClick={() => handleDeleteRecipe(row)}
                    className="text-red-600 hover:text-red-900"
                  >
                    ลบ
                  </button>
                </div>
              )}
            />
          )}
        </div>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="จัดการวัตถุดิบในสูตร"
        size="large"
      >
        {detailLoading ? (
          <div className="py-6 text-center text-gray-500">กำลังโหลดข้อมูล...</div>
        ) : (
          <>
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              เมนู: <span className="font-medium">{selectedRecipe?.menu_name || '-'}</span>
              <span className="ml-2 text-xs text-gray-500">{selectedRecipe?.menu_barcode}</span>
            </div>

            <form onSubmit={handleAddItem} className="space-y-3">
              <Input
                label="ค้นหาสินค้า"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="พิมพ์ชื่อหรือรหัสสินค้า"
              />
              {suggestionProducts.length > 0 && (
                <div className="border rounded-lg bg-white max-h-48 overflow-y-auto">
                  {suggestionProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => handleSelectProduct(product)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      <div className="font-medium text-gray-900">{product.name}</div>
                      <div className="text-xs text-gray-500">
                        {product.code || '-'} • {product.unit_abbr || product.unit_name || '-'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selectedProduct && (
                <div className="text-xs text-gray-500">
                  เลือกแล้ว: {selectedProduct.name} {selectedProduct.code ? `(${selectedProduct.code})` : ''}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Select
                  label="สินค้า"
                  value={itemForm.product_id}
                  onChange={(e) => setItemForm({ ...itemForm, product_id: e.target.value })}
                  options={productOptions}
                  placeholder="เลือกสินค้า"
                />
                <Select
                  label="หน่วย"
                  value={itemForm.unit_id}
                  onChange={(e) => setItemForm({ ...itemForm, unit_id: e.target.value })}
                  options={unitOptions}
                  placeholder="เลือกหน่วย"
                />
                <Input
                  label="ปริมาณต่อ 1 เมนู"
                  type="number"
                  step="0.01"
                  min="0"
                  value={itemForm.quantity}
                  onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })}
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={itemSaving}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-emerald-300"
                >
                  {itemSaving ? 'กำลังบันทึก...' : 'เพิ่มวัตถุดิบ'}
                </button>
              </div>
            </form>

            <div className="mt-6 border rounded-lg divide-y">
              {(selectedRecipe?.items || []).length === 0 && (
                <div className="px-4 py-6 text-center text-gray-500">ยังไม่มีวัตถุดิบในสูตรนี้</div>
              )}
              {(selectedRecipe?.items || []).map((item) => {
                const edit = itemEdits[item.id] || {};
                return (
                  <div key={item.id} className="p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900">{item.product_name}</p>
                        <p className="text-xs text-gray-500">{item.product_code || '-'}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleUpdateItem(item.id)}
                          className="px-3 py-1.5 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                          disabled={itemSaving}
                        >
                          บันทึก
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(item.id)}
                          className="px-3 py-1.5 border border-red-200 rounded-lg text-sm text-red-600 hover:bg-red-50"
                          disabled={itemSaving}
                        >
                          ลบ
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Select
                        label="หน่วย"
                        value={edit.unit_id ?? ''}
                        onChange={(e) =>
                          setItemEdits((prev) => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], unit_id: e.target.value }
                          }))
                        }
                        options={unitOptions}
                        placeholder="เลือกหน่วย"
                      />
                      <Input
                        label="ปริมาณต่อ 1 เมนู"
                        type="number"
                        step="0.01"
                        min="0"
                        value={edit.quantity ?? ''}
                        onChange={(e) =>
                          setItemEdits((prev) => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], quantity: e.target.value }
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Modal>
    </Layout>
  );
};
