import * as recipeModel from '../models/recipe.model.js';
import * as branchModel from '../models/branch.model.js';
import * as conversionModel from '../models/unit-conversion.model.js';
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

    res.json({
      success: true,
      data: {
        start,
        end,
        branch_id: branchId,
        items: Array.from(usageMap.values()).map((item) => ({
          ...item,
          menu_breakdown: Object.values(item.menu_breakdown || {})
        })),
        missing_recipes: missingRecipes,
        missing_conversions: missingConversions
      }
    });
  } catch (error) {
    next(error);
  }
};
