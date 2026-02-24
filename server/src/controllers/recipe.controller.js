import * as recipeModel from '../models/recipe.model.js';
import * as branchModel from '../models/branch.model.js';
import * as conversionModel from '../models/unit-conversion.model.js';
import { ensureInternalOrderScopeTable } from '../models/supplier.model.js';
import { ensureInventoryTables } from '../models/inventory.model.js';
import pool from '../config/database.js';
import { queryClickHouse } from '../services/clickhouse.service.js';

const SHOP_ID =
  process.env.CLICKHOUSE_SHOP_ID || '2OJMVIo1Qi81NqYos3oDPoASziy';
const TH_TIME_OFFSET = Number(process.env.CLICKHOUSE_TZ_OFFSET || 7);

const escapeValue = (value) => String(value || '').replace(/'/g, "''");

export const searchMenus = async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Number(req.query.limit || 20), 100);

    if (!search) {
      return res.json({ success: true, data: [] });
    }

    const term = escapeValue(search);
    const sql = `
      SELECT barcode, name0, unitname, groupnames
      FROM productbarcode
      WHERE shopid = '${SHOP_ID}'
        AND name0 NOT LIKE '%ยกเลิก%'
        AND (
          positionCaseInsensitive(name0, '${term}') > 0
          OR positionCaseInsensitive(barcode, '${term}') > 0
        )
      ORDER BY name0
      LIMIT ${limit}
    `;

    const data = await queryClickHouse(sql);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getRecipes = async (req, res, next) => {
  try {
    const data = await recipeModel.getRecipes();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getRecipeById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const recipe = await recipeModel.getRecipeById(Number(id));
    if (!recipe) {
      return res.status(404).json({ success: false, message: 'Recipe not found' });
    }
    res.json({ success: true, data: recipe });
  } catch (error) {
    next(error);
  }
};

export const createRecipe = async (req, res, next) => {
  try {
    const { menu_barcode, menu_name, menu_unit_name } = req.body;

    if (!menu_barcode || !menu_name) {
      return res.status(400).json({
        success: false,
        message: 'menu_barcode and menu_name are required'
      });
    }

    const recipe = await recipeModel.createRecipe({
      menu_barcode: String(menu_barcode),
      menu_name: String(menu_name),
      menu_unit_name: menu_unit_name ? String(menu_unit_name) : null
    });

    res.status(201).json({ success: true, data: recipe });
  } catch (error) {
    next(error);
  }
};

export const deleteRecipe = async (req, res, next) => {
  try {
    const { id } = req.params;
    await recipeModel.deleteRecipe(Number(id));
    res.json({ success: true, message: 'Recipe deleted' });
  } catch (error) {
    next(error);
  }
};

export const addRecipeItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { product_id, unit_id, quantity } = req.body;

    if (!product_id || !unit_id || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'product_id, unit_id, quantity are required'
      });
    }

    const normalizedQuantity = Number(quantity);
    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'quantity must be greater than or equal to 0'
      });
    }

    const result = await recipeModel.addRecipeItem(
      Number(id),
      Number(product_id),
      normalizedQuantity,
      Number(unit_id)
    );

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const updateRecipeItem = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const { unit_id, quantity } = req.body;

    if (unit_id === undefined && quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'unit_id or quantity is required'
      });
    }

    let normalizedQuantity;
    if (quantity !== undefined) {
      normalizedQuantity = Number(quantity);
      if (!Number.isFinite(normalizedQuantity) || normalizedQuantity < 0) {
        return res.status(400).json({
          success: false,
          message: 'quantity must be greater than or equal to 0'
        });
      }
    }

    const result = await recipeModel.updateRecipeItem(
      Number(itemId),
      normalizedQuantity,
      unit_id !== undefined ? Number(unit_id) : undefined
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'Recipe item not found' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const deleteRecipeItem = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const result = await recipeModel.deleteRecipeItem(Number(itemId));
    if (!result) {
      return res.status(404).json({ success: false, message: 'Recipe item not found' });
    }
    res.json({ success: true, message: 'Recipe item deleted' });
  } catch (error) {
    next(error);
  }
};

const convertQuantity = (qty, fromUnitId, toUnitId, conversions) => {
  if (!fromUnitId || !toUnitId) return null;
  if (fromUnitId === toUnitId) return qty;

  const key = `${fromUnitId}-${toUnitId}`;
  if (conversions[key]) {
    return qty * conversions[key];
  }

  const reverseKey = `${toUnitId}-${fromUnitId}`;
  if (conversions[reverseKey]) {
    return qty / conversions[reverseKey];
  }

  return null;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeDateInput = (value) => String(value || '').trim().slice(0, 10);
const toBoolean = (value) => {
  if (typeof value === 'string') {
    return value === 'true' || value === '1';
  }
  return Boolean(value);
};

export const getUsageReport = async (req, res, next) => {
  try {
    const start = req.query.start || new Date().toISOString().split('T')[0];
    const end = req.query.end || start;
    const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;

    let clickhouseBranchId = null;
    if (branchId) {
      const branch = await branchModel.getBranchById(branchId);
      if (!branch?.clickhouse_branch_id) {
        return res.status(400).json({
          success: false,
          message: 'Branch is missing ClickHouse branch id'
        });
      }
      clickhouseBranchId = branch.clickhouse_branch_id;
    }

    const branchFilter = clickhouseBranchId
      ? `AND d.branchid = '${escapeValue(clickhouseBranchId)}'`
      : '';

    const dateExpr = `toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))`;
    const sql = `
      SELECT dd.barcode,
             any(dd.itemname) as menu_name,
             sum(dd.qty) as total_qty
      FROM doc d
      JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
      WHERE d.shopid = '${SHOP_ID}'
        AND d.transflag = 44
        AND dd.transflag = 44
        AND ${dateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
        ${branchFilter}
      GROUP BY dd.barcode
    `;

    const menuSales = await queryClickHouse(sql);
    const barcodes = menuSales.map((row) => row.barcode);

    if (barcodes.length === 0) {
      return res.json({
        success: true,
        data: {
          start,
          end,
          branch_id: branchId,
          items: [],
          summary: {
            expected_total_used: 0,
            actual_total_used: 0,
            variance_total: 0
          },
          inventory_logic: {
            description:
              'actual_used คำนวณจาก movement คลังที่เป็นการใช้จริง (sale และ adjustment จาก production_transform)',
            transaction_types: ['sale', 'adjustment:production_transform']
          },
          missing_recipes: [],
          missing_conversions: []
        }
      });
    }

    const recipes = await recipeModel.getRecipesByBarcodes(barcodes);
    const conversions = await conversionModel.getConversionsRaw();
    const conversionMap = conversions.reduce((acc, row) => {
      acc[`${row.from_unit_id}-${row.to_unit_id}`] = Number(row.multiplier);
      return acc;
    }, {});

    const recipeMap = new Map();
    recipes.forEach((row) => {
      if (!recipeMap.has(row.menu_barcode)) {
        recipeMap.set(row.menu_barcode, []);
      }
      if (row.item_id) {
        recipeMap.get(row.menu_barcode).push(row);
      }
    });

    const usageMap = new Map();
    const missingRecipes = [];
    const missingConversions = [];

    menuSales.forEach((sale) => {
      const recipeItems = recipeMap.get(sale.barcode);
      const qty = Number(sale.total_qty || 0);

      if (!recipeItems || recipeItems.length === 0) {
        missingRecipes.push({
          barcode: sale.barcode,
          name: sale.menu_name,
          quantity: qty
        });
        return;
      }

      recipeItems.forEach((item) => {
        const usedQty = qty * Number(item.quantity || 0);
        const converted = convertQuantity(
          usedQty,
          item.unit_id,
          item.product_unit_id,
          conversionMap
        );

        if (converted === null) {
          missingConversions.push({
            product_id: item.product_id,
            product_name: item.product_name,
            from_unit_id: item.unit_id,
            to_unit_id: item.product_unit_id,
            quantity: usedQty,
            unit_abbr: item.unit_abbr,
            menu_barcode: sale.barcode
          });
          return;
        }

        const existing = usageMap.get(item.product_id);
        if (existing) {
          existing.total_used += converted;
          const breakdown = existing.menu_breakdown || {};
          const menuKey = sale.barcode;
          if (!breakdown[menuKey]) {
            breakdown[menuKey] = {
              menu_barcode: sale.barcode,
              menu_name: sale.menu_name,
              total_used: 0
            };
          }
          breakdown[menuKey].total_used += converted;
          existing.menu_breakdown = breakdown;
        } else {
          usageMap.set(item.product_id, {
            product_id: item.product_id,
            product_name: item.product_name,
            unit_abbr: item.product_unit_abbr || item.unit_abbr || '',
            total_used: converted,
            menu_breakdown: {
              [sale.barcode]: {
                menu_barcode: sale.barcode,
                menu_name: sale.menu_name,
                total_used: converted
              }
            }
          });
        }
      });
    });

    const inventoryBranchFilter = branchId ? 'AND d.branch_id = ?' : '';
    const inventoryParams = [start, end, ...(branchId ? [branchId] : [])];
    const rawInventoryRows = await recipeModel.queryRaw(
      `SELECT
         it.product_id,
         SUM(
           CASE
             WHEN it.quantity < 0
               AND (
                 it.transaction_type = 'sale'
                 OR (
                   it.transaction_type = 'adjustment'
                   AND it.reference_type = 'production_transform'
                   AND it.notes LIKE 'แปรรูปสินค้า: ตัดวัตถุดิบ%'
                 )
               )
             THEN ABS(it.quantity)
             ELSE 0
           END
         ) AS actual_used,
         MAX(it.created_at) AS last_movement_at
       FROM inventory_transactions it
       JOIN departments d ON d.id = it.department_id
       WHERE DATE(it.created_at) BETWEEN ? AND ?
         ${inventoryBranchFilter}
       GROUP BY it.product_id`,
      inventoryParams
    );
    const inventoryRows = Array.isArray(rawInventoryRows)
      ? rawInventoryRows
      : Array.isArray(rawInventoryRows?.[0])
        ? rawInventoryRows[0]
        : [];

    const inventoryUsageMap = new Map(
      (inventoryRows || []).map((row) => [
        Number(row.product_id),
        {
          actual_used: toNumber(row.actual_used, 0),
          last_movement_at: row.last_movement_at || null
        }
      ])
    );

    let expectedTotalUsed = 0;
    let actualTotalUsed = 0;
    const enrichedItems = Array.from(usageMap.values()).map((item) => {
      const expectedUsed = toNumber(item.total_used, 0);
      const actualEntry = inventoryUsageMap.get(Number(item.product_id));
      const actualUsed = toNumber(actualEntry?.actual_used, 0);
      const variance = actualUsed - expectedUsed;

      expectedTotalUsed += expectedUsed;
      actualTotalUsed += actualUsed;

      return {
        ...item,
        total_used: expectedUsed,
        actual_used: actualUsed,
        usage_variance: variance,
        inventory_last_movement_at: actualEntry?.last_movement_at || null,
        menu_breakdown: Object.values(item.menu_breakdown || {})
      };
    });

    res.json({
      success: true,
      data: {
        start,
        end,
        branch_id: branchId,
        items: enrichedItems,
        summary: {
          expected_total_used: expectedTotalUsed,
          actual_total_used: actualTotalUsed,
          variance_total: actualTotalUsed - expectedTotalUsed
        },
        inventory_logic: {
          description:
            'actual_used คำนวณจาก movement คลังที่เป็นการใช้จริง (sale และ adjustment จาก production_transform)',
          transaction_types: ['sale', 'adjustment:production_transform']
        },
        missing_recipes: missingRecipes,
        missing_conversions: missingConversions
      }
    });
  } catch (error) {
    next(error);
  }
};

const chunkArray = (items, size = 500) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const resolveUsageBranchContext = async (branchId) => {
  if (Number.isFinite(branchId)) {
    const branch = await branchModel.getBranchById(branchId);
    if (!branch?.clickhouse_branch_id) {
      const error = new Error('Branch is missing ClickHouse branch id');
      error.statusCode = 400;
      throw error;
    }
    return {
      branchFilter: `AND d.branchid = '${escapeValue(branch.clickhouse_branch_id)}'`,
      clickhouseToLocalBranchId: new Map([[String(branch.clickhouse_branch_id), Number(branch.id)]])
    };
  }

  const branches = await branchModel.getAllBranches();
  const clickhouseToLocalBranchId = new Map(
    branches
      .filter((branch) => String(branch.clickhouse_branch_id || '').trim())
      .map((branch) => [String(branch.clickhouse_branch_id), Number(branch.id)])
  );

  return {
    branchFilter: '',
    clickhouseToLocalBranchId
  };
};

export const syncUsageToInventory = async (req, res, next) => {
  try {
    const start = normalizeDateInput(req.body?.start || req.body?.date || req.query.start);
    const end = normalizeDateInput(req.body?.end || req.query.end || start);
    const branchIdRaw = req.body?.branch_id ?? req.query.branch_id ?? null;
    const branchId = branchIdRaw !== null && branchIdRaw !== '' ? Number(branchIdRaw) : null;
    const dryRun = toBoolean(req.body?.dry_run ?? req.query.dry_run);

    if (!start) {
      return res.status(400).json({
        success: false,
        message: 'start is required'
      });
    }

    const startDateObj = new Date(start);
    const endDateObj = new Date(end);
    if (!Number.isFinite(startDateObj.getTime()) || !Number.isFinite(endDateObj.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid start or end date'
      });
    }
    if (startDateObj > endDateObj) {
      return res.status(400).json({
        success: false,
        message: 'start must be before or equal to end'
      });
    }

    const { branchFilter, clickhouseToLocalBranchId } = await resolveUsageBranchContext(branchId);
    if (clickhouseToLocalBranchId.size === 0) {
      return res.status(400).json({
        success: false,
        message: 'No branches configured with ClickHouse branch id'
      });
    }

    const dateExpr = `toDate(addHours(d.docdatetime, ${TH_TIME_OFFSET}))`;
    const dateTimeLocalExpr = `formatDateTime(addHours(d.docdatetime, ${TH_TIME_OFFSET}), '%F %T')`;
    const dateTimeUtcExpr = `formatDateTime(d.docdatetime, '%F %T')`;
    const salesSql = `
      SELECT ${dateExpr} as sale_date,
             ${dateTimeLocalExpr} as sale_datetime_local,
             ${dateTimeUtcExpr} as sale_datetime_utc,
             d.docno as sale_doc_no,
             d.branchid as clickhouse_branch_id,
             dd.barcode,
             any(dd.itemname) as menu_name,
             sum(dd.qty) as total_qty
      FROM doc d
      JOIN docdetail dd ON d.shopid = dd.shopid AND d.docno = dd.docno
      WHERE d.shopid = '${SHOP_ID}'
        AND d.transflag = 44
        AND dd.transflag = 44
        AND d.iscancel = 0
        AND ${dateExpr} BETWEEN toDate('${escapeValue(start)}') AND toDate('${escapeValue(end)}')
        ${branchFilter}
      GROUP BY sale_date, sale_datetime_local, sale_datetime_utc, sale_doc_no, clickhouse_branch_id, dd.barcode
    `;

    const menuSales = await queryClickHouse(salesSql);
    if (!Array.isArray(menuSales) || menuSales.length === 0) {
      return res.json({
        success: true,
        data: {
          start,
          end,
          branch_id: branchId,
          dry_run: dryRun,
          planned_deductions: 0,
          applied_deductions: 0,
          skipped_existing: 0,
          unresolved_items: [],
          missing_recipes: [],
          missing_conversions: [],
          missing_branch_mapping: []
        }
      });
    }

    const barcodes = Array.from(
      new Set(menuSales.map((row) => String(row.barcode || '').trim()).filter(Boolean))
    );
    const recipes = await recipeModel.getRecipesByBarcodes(barcodes);
    const conversions = await conversionModel.getConversionsRaw();

    const conversionMap = conversions.reduce((acc, row) => {
      acc[`${row.from_unit_id}-${row.to_unit_id}`] = Number(row.multiplier);
      return acc;
    }, {});

    const recipeMap = new Map();
    recipes.forEach((row) => {
      if (!recipeMap.has(row.menu_barcode)) {
        recipeMap.set(row.menu_barcode, []);
      }
      if (row.item_id) {
        recipeMap.get(row.menu_barcode).push(row);
      }
    });

    const missingRecipes = [];
    const missingConversions = [];
    const missingBranchMapping = [];
    const usageByBillBranchProduct = new Map();

    for (const sale of menuSales) {
      const saleDate = normalizeDateInput(sale.sale_date);
      const saleDateTimeLocal = String(sale.sale_datetime_local || '').trim().slice(0, 19);
      const saleDateTimeUtc = String(sale.sale_datetime_utc || '').trim().slice(0, 19);
      const saleDocNo = String(sale.sale_doc_no || '').trim();
      const clickhouseBranch = String(sale.clickhouse_branch_id || '').trim();
      const localBranchId = clickhouseToLocalBranchId.get(clickhouseBranch);

      if (!Number.isFinite(localBranchId)) {
        missingBranchMapping.push({
          sale_date: saleDate,
          sale_datetime_local: saleDateTimeLocal || null,
          sale_doc_no: saleDocNo || null,
          clickhouse_branch_id: clickhouseBranch,
          barcode: sale.barcode,
          menu_name: sale.menu_name,
          quantity: toNumber(sale.total_qty, 0)
        });
        continue;
      }

      const recipeItems = recipeMap.get(String(sale.barcode || '').trim());
      const soldQty = toNumber(sale.total_qty, 0);

      if (!recipeItems || recipeItems.length === 0) {
        missingRecipes.push({
          sale_date: saleDate,
          sale_datetime_local: saleDateTimeLocal || null,
          sale_doc_no: saleDocNo || null,
          branch_id: localBranchId,
          barcode: sale.barcode,
          name: sale.menu_name,
          quantity: soldQty
        });
        continue;
      }

      for (const item of recipeItems) {
        const usedQty = soldQty * toNumber(item.quantity, 0);
        const converted = convertQuantity(
          usedQty,
          item.unit_id,
          item.product_unit_id,
          conversionMap
        );

        if (converted === null) {
          missingConversions.push({
            sale_date: saleDate,
            sale_datetime_local: saleDateTimeLocal || null,
            sale_doc_no: saleDocNo || null,
            branch_id: localBranchId,
            product_id: item.product_id,
            product_name: item.product_name,
            from_unit_id: item.unit_id,
            to_unit_id: item.product_unit_id,
            quantity: usedQty,
            unit_abbr: item.unit_abbr,
            menu_barcode: sale.barcode
          });
          continue;
        }

        const productId = Number(item.product_id);
        if (!Number.isFinite(productId)) continue;
        const key = `${saleDate}|${saleDateTimeUtc || saleDateTimeLocal}|${saleDocNo}|${localBranchId}|${productId}`;
        const existing = usageByBillBranchProduct.get(key);
        if (existing) {
          existing.quantity += converted;
        } else {
          usageByBillBranchProduct.set(key, {
            sale_date: saleDate,
            sale_datetime_local: saleDateTimeLocal || null,
            sale_datetime_utc: saleDateTimeUtc || null,
            sale_doc_no: saleDocNo || null,
            branch_id: localBranchId,
            product_id: productId,
            product_name: item.product_name,
            unit_abbr: item.product_unit_abbr || item.unit_abbr || '',
            quantity: converted
          });
        }
      }
    }

    const usageRows = Array.from(usageByBillBranchProduct.values());
    if (usageRows.length === 0) {
      return res.json({
        success: true,
        data: {
          start,
          end,
          branch_id: branchId,
          dry_run: dryRun,
          planned_deductions: 0,
          applied_deductions: 0,
          skipped_existing: 0,
          unresolved_items: [],
          missing_recipes: missingRecipes,
          missing_conversions: missingConversions,
          missing_branch_mapping: missingBranchMapping
        }
      });
    }

    const productIds = Array.from(new Set(usageRows.map((item) => Number(item.product_id))));
    const branchIds = Array.from(new Set(usageRows.map((item) => Number(item.branch_id))));

    const [productRows] = await pool.query(
      `SELECT id, name, product_group_id
       FROM products
       WHERE id IN (${productIds.map(() => '?').join(', ')})`,
      productIds
    );

    const productMap = new Map(
      productRows.map((row) => [
        Number(row.id),
        {
          name: row.name || '',
          product_group_id: Number(row.product_group_id)
        }
      ])
    );

    // ดึงคู่ (product_id, department_id) ที่เคยมีการเช็คสต็อก (reference_type='stock_check')
    // ในสาขาที่ผูก ClickHouse เท่านั้น — นี่คือเงื่อนไขว่าสินค้านั้น "ผูกแล้ว" และตัดได้
    const [stockCheckRows] = await pool.query(
      `SELECT DISTINCT it.product_id, it.department_id, d.branch_id
       FROM inventory_transactions it
       JOIN departments d ON d.id = it.department_id
       JOIN branches b ON d.branch_id = b.id
       WHERE it.reference_type = 'stock_check'
         AND d.is_active = true
         AND b.clickhouse_branch_id IS NOT NULL
         AND b.clickhouse_branch_id != ''
         AND it.product_id IN (${productIds.map(() => '?').join(', ')})
         AND d.branch_id IN (${branchIds.map(() => '?').join(', ')})`,
      [...productIds, ...branchIds]
    );

    // Map: "product_id|branch_id" → department_id ที่เช็คสต็อกล่าสุด
    // ถ้าสินค้าเดียวกันเช็คหลายแผนกในสาขาเดียว → ใช้แผนกแรกที่พบ (unique per product+branch)
    // กรณีเช็คหลายแผนก: จะบันทึกแยกแต่ละแผนก (ตามข้อมูลจริงใน stock_check)
    const stockCheckMap = new Map(); // key: "product_id|branch_id" → [department_id, ...]
    for (const row of stockCheckRows) {
      const key = `${Number(row.product_id)}|${Number(row.branch_id)}`;
      if (!stockCheckMap.has(key)) stockCheckMap.set(key, []);
      stockCheckMap.get(key).push(Number(row.department_id));
    }

    const unresolvedItems = [];
    const resolvedRows = [];

    for (const usage of usageRows) {
      const productMeta = productMap.get(Number(usage.product_id));
      if (!productMeta) {
        unresolvedItems.push({ ...usage, reason: 'product_not_found' });
        continue;
      }

      const key = `${Number(usage.product_id)}|${Number(usage.branch_id)}`;
      const deptCandidates = stockCheckMap.get(key) || [];

      if (deptCandidates.length === 0) {
        // ไม่มีการเช็คสต็อกสินค้านี้ในสาขานั้น → ยังไม่ผูก → ไม่ตัด
        unresolvedItems.push({ ...usage, reason: 'no_stock_check_found' });
        continue;
      }

      if (deptCandidates.length === 1) {
        // มีแผนกเดียวที่เช็คสต็อกสินค้านี้ในสาขานั้น → ตัดที่นั่น
        resolvedRows.push({
          ...usage,
          product_name: productMeta.name || usage.product_name,
          department_id: deptCandidates[0],
          rule: 'stock_check_single_dept'
        });
      } else {
        // มีหลายแผนกในสาขาเดียวที่เช็คสินค้านี้ → บันทึกแยกแต่ละแผนก
        // หาร qty เฉลี่ยตามจำนวนแผนก หรือตัดทีละแผนก
        // เลือก: ตัดจากแผนกแรกที่เช็คก่อน (department_id น้อยสุด = เก่าสุด)
        const sortedDepts = [...deptCandidates].sort((a, b) => a - b);
        resolvedRows.push({
          ...usage,
          product_name: productMeta.name || usage.product_name,
          department_id: sortedDepts[0],
          rule: 'stock_check_multi_dept_first'
        });
      }
    }

    const plannedQuantity = resolvedRows.reduce(
      (sum, row) => sum + Math.abs(toNumber(row.quantity, 0)),
      0
    );

    if (dryRun || resolvedRows.length === 0) {
      return res.json({
        success: true,
        data: {
          start,
          end,
          branch_id: branchId,
          dry_run: dryRun,
          planned_deductions: resolvedRows.length,
          planned_quantity: plannedQuantity,
          applied_deductions: 0,
          skipped_existing: 0,
          unresolved_items: unresolvedItems,
          missing_recipes: missingRecipes,
          missing_conversions: missingConversions,
          missing_branch_mapping: missingBranchMapping
        }
      });
    }

    await ensureInventoryTables();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // เรียงตามเวลาบิลจริง ASC เพื่อให้ balance_before/after ต่อเนื่องตามลำดับเวลา
      const referenceRows = resolvedRows
        .map((row) => ({
          ...row,
          reference_id: `recipe-sale-bill:${row.sale_date}:${String(row.sale_datetime_local || row.sale_datetime_utc || '').replace(/\D/g, '').slice(0, 14)}:branch${row.branch_id}:dept${row.department_id}:product${row.product_id}:doc${String(row.sale_doc_no || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'na'}`,
          legacy_reference_id: `recipe-sale:${row.sale_date}:branch${row.branch_id}:dept${row.department_id}:product${row.product_id}`
        }))
        .sort((a, b) => {
          const ta = a.sale_datetime_local || a.sale_datetime_utc || `${a.sale_date} 12:00:00`;
          const tb = b.sale_datetime_local || b.sale_datetime_utc || `${b.sale_date} 12:00:00`;
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
      const existingReferences = new Set();
      const existingLegacyReferences = new Set();

      for (const chunk of chunkArray(referenceRows, 300)) {
        const ids = chunk
          .flatMap((row) => [row.reference_id, row.legacy_reference_id])
          .filter(Boolean);
        const [rows] = await connection.query(
          `SELECT reference_id
           FROM inventory_transactions
           WHERE reference_type = 'recipe_sale'
             AND reference_id IN (${ids.map(() => '?').join(', ')})`,
          ids
        );
        rows.forEach((row) => {
          const refId = String(row.reference_id);
          if (refId.startsWith('recipe-sale-bill:')) {
            existingReferences.add(refId);
          } else {
            existingLegacyReferences.add(refId);
          }
        });
      }

      let appliedDeductions = 0;
      let appliedQuantity = 0;
      let skippedExisting = 0;
      let skippedLegacyDaily = 0;

      // กรอง rows ที่จะ insert จริง (ยังไม่มีใน DB)
      const rowsToInsert = [];
      for (const row of referenceRows) {
        if (existingReferences.has(row.reference_id)) {
          skippedExisting += 1;
          continue;
        }
        if (existingLegacyReferences.has(row.legacy_reference_id)) {
          skippedLegacyDaily += 1;
          continue;
        }
        const quantity = Math.abs(toNumber(row.quantity, 0));
        if (quantity === 0) continue;
        rowsToInsert.push({ ...row, quantity });
      }

      // Lock inventory_balance ของทุก product+dept ก่อน (ป้องกัน race condition กับ stock_check apply)
      const balanceMapKeys = [...new Set(rowsToInsert.map((r) => `${r.product_id}|${r.department_id}`))];
      if (balanceMapKeys.length > 0) {
        for (const key of balanceMapKeys) {
          const [pid, did] = key.split('|').map(Number);
          await connection.query(
            `SELECT quantity FROM inventory_balance WHERE product_id = ? AND department_id = ? FOR UPDATE`,
            [pid, did]
          );
        }
      }

      // running balance ใน memory: key → balance ณ เวลาบิลล่าสุดที่ insert ไปแล้ว
      // เริ่มต้นยังไม่มีค่า (null) → ต้อง query จาก DB สำหรับบิลแรกของแต่ละ product+dept
      const runningBalance = new Map(); // key: "product_id|dept_id" → balance (number | null)

      // insert เรียงตามเวลาบิล (rowsToInsert ถูก sort แล้วข้างบน)
      for (const row of rowsToInsert) {
        const key = `${row.product_id}|${row.department_id}`;
        const saleTs = row.sale_datetime_local || row.sale_datetime_utc || `${row.sale_date} 12:00:00`;

        let balanceBefore;
        if (!runningBalance.has(key)) {
          // บิลแรกของ product+dept นี้ใน batch นี้
          // หา balance_after ล่าสุดใน inventory_transactions ที่เกิดก่อนเวลาบิลนี้
          // เพื่อให้ balance_before สะท้อนความเป็นจริง ณ เวลาบิล ไม่ใช่ current balance
          const [pid, did] = key.split('|').map(Number);
          const [prevTx] = await connection.query(
            `SELECT balance_after
             FROM inventory_transactions
             WHERE product_id = ? AND department_id = ?
               AND created_at < ?
             ORDER BY created_at DESC, id DESC
             LIMIT 1`,
            [pid, did, saleTs]
          );
          if (prevTx.length > 0) {
            balanceBefore = toNumber(prevTx[0].balance_after, 0);
          } else {
            // ไม่มี transaction ก่อนหน้าเลย → เริ่มจาก 0
            balanceBefore = 0;
          }
        } else {
          // บิลถัดไปใน batch เดียวกัน → ต่อจาก running balance ใน memory
          balanceBefore = runningBalance.get(key);
        }

        const balanceAfter = balanceBefore - row.quantity;

        const [txResult] = await connection.query(
          `INSERT INTO inventory_transactions
           (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
            reference_type, reference_id, notes, created_by, created_at)
           VALUES (?, ?, 'sale', ?, ?, ?, 'recipe_sale', ?, ?, ?, ?)`,
          [
            row.product_id,
            row.department_id,
            -row.quantity,
            balanceBefore,
            balanceAfter,
            row.reference_id,
            `ตัดตามสูตรจากยอดขาย POS บิล ${row.sale_doc_no || '-'} วันที่ ${row.sale_date} เวลา ${row.sale_datetime_local || '-'}`,
            req.user?.id || null,
            row.sale_datetime_local || row.sale_datetime_utc || `${row.sale_date} 12:00:00`
          ]
        );

        // อัพเดท running balance ใน memory
        runningBalance.set(key, balanceAfter);

        // อัพเดท inventory_balance แบบ relative (quantity - deduction)
        // เพื่อไม่ override transaction อื่นที่เกิดหลังเวลาบิลนี้แต่ก่อนเวลา sync
        await connection.query(
          `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             quantity = quantity - ?,
             last_transaction_id = VALUES(last_transaction_id),
             last_updated = CURRENT_TIMESTAMP`,
          [row.product_id, row.department_id, balanceAfter, txResult.insertId, row.quantity]
        );

        appliedDeductions += 1;
        appliedQuantity += row.quantity;
      }

      await connection.commit();

      return res.json({
        success: true,
        data: {
          start,
          end,
          branch_id: branchId,
          dry_run: false,
          planned_deductions: resolvedRows.length,
          planned_quantity: plannedQuantity,
          applied_deductions: appliedDeductions,
          applied_quantity: appliedQuantity,
          skipped_existing: skippedExisting,
          skipped_legacy_daily: skippedLegacyDaily,
          unresolved_items: unresolvedItems,
          missing_recipes: missingRecipes,
          missing_conversions: missingConversions,
          missing_branch_mapping: missingBranchMapping
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
};
