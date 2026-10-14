import { getGeneralPurchasesForAccountingExport } from '../models/general-purchase.model.js';
import {
  getFreshMarketGroupId,
  getPurchaseWalkForAccountingExport
} from '../models/accounting-export.model.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const parseBoolean = (value, defaultValue = true) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return defaultValue;
};

const parseLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

const validateDate = (value) => {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!DATE_PATTERN.test(normalized)) {
    const error = new Error('Invalid date format. Use YYYY-MM-DD.');
    error.statusCode = 400;
    throw error;
  }

  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    const error = new Error('Invalid date format. Use YYYY-MM-DD.');
    error.statusCode = 400;
    throw error;
  }

  return normalized;
};

export const authenticateAccountingExport = (req, res, next) => {
  const expectedToken = String(process.env.ACCOUNTING_EXPORT_TOKEN || '').trim();
  const providedToken = String(req.get('x-accounting-sync-token') || '').trim();

  if (!expectedToken || providedToken !== expectedToken) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  return next();
};

export const health = (req, res) => {
  res.json({
    success: true,
    source: 'market-order-app',
    service: 'accounting-export',
    ready: true
  });
};

export const listGeneralPurchases = async (req, res, next) => {
  try {
    const status = String(req.query.status || 'received').trim() || 'received';
    const from = validateDate(req.query.from);
    const to = validateDate(req.query.to);

    if (from && to && to < from) {
      const error = new Error('Invalid date range. "to" must be greater than or equal to "from".');
      error.statusCode = 400;
      throw error;
    }

    const limit = parseLimit(req.query.limit);
    const includeItems = parseBoolean(req.query.includeItems, true);
    const data = await getGeneralPurchasesForAccountingExport({
      status,
      from,
      to,
      limit,
      includeItems
    });

    res.json({
      success: true,
      data,
      count: data.length,
      filters: {
        status,
        from,
        to,
        limit,
        includeItems
      }
    });
  } catch (error) {
    next(error);
  }
};


export const listFreshMarketPurchaseWalk = async (req, res, next) => {
  try {
    const date = validateDate(req.query.date);
    const from = validateDate(req.query.from) || date;
    const to = validateDate(req.query.to) || date || from;

    if (!from || !to) {
      const error = new Error('date or from/to is required. Use YYYY-MM-DD.');
      error.statusCode = 400;
      throw error;
    }

    if (to < from) {
      const error = new Error('Invalid date range. "to" must be greater than or equal to "from".');
      error.statusCode = 400;
      throw error;
    }

    const marketGroupId = await getFreshMarketGroupId();
    if (!marketGroupId) {
      const error = new Error('Fresh market product group not found.');
      error.statusCode = 404;
      throw error;
    }

    const branchId = Number(req.query.branch_id);
    const departmentId = Number(req.query.department_id);
    const limit = parseLimit(req.query.limit);
    const includeManual = parseBoolean(req.query.includeManual, true);
    const groupAsDocuments = parseBoolean(req.query.groupAsDocuments, true);

    const result = await getPurchaseWalkForAccountingExport({
      from,
      to,
      productGroupId: marketGroupId,
      branchId: Number.isFinite(branchId) && branchId > 0 ? branchId : null,
      departmentId: Number.isFinite(departmentId) && departmentId > 0 ? departmentId : null,
      includeManual,
      groupAsDocuments,
      limit
    });

    res.json({
      success: true,
      data: result.documents,
      lines: result.lines,
      summary: result.summary,
      filters: {
        from,
        to,
        product_group_id: marketGroupId,
        product_group_name: 'ตลาดสด',
        branch_id: Number.isFinite(branchId) && branchId > 0 ? branchId : null,
        department_id: Number.isFinite(departmentId) && departmentId > 0 ? departmentId : null,
        includeManual,
        groupAsDocuments,
        limit
      }
    });
  } catch (error) {
    next(error);
  }
};
