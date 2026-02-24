import * as withdrawModel from '../models/withdraw.model.js';
import * as withdrawSourceMappingModel from '../models/withdraw-source-mapping.model.js';
import { withProductGroupAliases } from '../utils/product-group.js';

const isAdminUser = (user) => ['admin', 'super_admin'].includes(user?.role);

const canUseWithdrawFeature = (user) => {
  if (isAdminUser(user)) return true;
  if (Boolean(user?.is_production_department)) return true;
  return Boolean(user?.can_view_product_group_orders ?? user?.can_view_supplier_orders);
};

const normalizeAllowedGroupIds = (user) => {
  const source = user?.allowed_product_group_ids ?? user?.allowed_supplier_ids;
  if (!Array.isArray(source)) return [];
  return source
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
};

export const getWithdrawTargets = async (req, res, next) => {
  try {
    if (!canUseWithdrawFeature(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'ไม่มีสิทธิ์ใช้งานการเบิกสินค้า'
      });
    }

    const rows = await withdrawModel.getWithdrawTargets({
      sourceDepartmentId: req.user.department_id,
      isAdmin: isAdminUser(req.user)
    });

    res.json({
      success: true,
      data: rows,
      count: rows.length
    });
  } catch (error) {
    next(error);
  }
};

export const getWithdrawProducts = async (req, res, next) => {
  try {
    if (!canUseWithdrawFeature(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'ไม่มีสิทธิ์ใช้งานการเบิกสินค้า'
      });
    }

    const search = String(req.query.search || '').trim();
    const limit = req.query.limit ? Number(req.query.limit) : 200;

    const rows = await withdrawModel.getWithdrawProducts({
      allowedProductGroupIds: isAdminUser(req.user) ? [] : normalizeAllowedGroupIds(req.user),
      search,
      limit
    });

    res.json({
      success: true,
      data: withProductGroupAliases(rows),
      count: rows.length
    });
  } catch (error) {
    next(error);
  }
};

export const getWithdrawById = async (req, res, next) => {
  try {
    if (!canUseWithdrawFeature(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'ไม่มีสิทธิ์ใช้งานการเบิกสินค้า'
      });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'id ไม่ถูกต้อง' });
    }

    const result = await withdrawModel.getWithdrawById({
      id,
      sourceDepartmentId: req.user.department_id,
      isAdmin: isAdminUser(req.user)
    });

    res.json({ success: true, data: result });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const updateWithdrawal = async (req, res, next) => {
  try {
    if (!canUseWithdrawFeature(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'ไม่มีสิทธิ์ใช้งานการเบิกสินค้า'
      });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'id ไม่ถูกต้อง' });
    }

    const { notes, items } = req.body || {};

    const result = await withdrawModel.updateWithdrawal({
      id,
      sourceDepartmentId: req.user.department_id,
      updatedBy: req.user.id,
      notes,
      items: Array.isArray(items) ? items : [],
      isAdmin: isAdminUser(req.user)
    });

    res.json({ success: true, message: 'แก้ไขใบเบิกเรียบร้อย', data: result });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const getWithdrawHistory = async (req, res, next) => {
  try {
    if (!canUseWithdrawFeature(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'ไม่มีสิทธิ์ใช้งานการเบิกสินค้า'
      });
    }

    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const rows = await withdrawModel.getWithdrawHistory({
      sourceDepartmentId: req.user.department_id,
      limit
    });

    res.json({
      success: true,
      data: rows,
      count: rows.length
    });
  } catch (error) {
    next(error);
  }
};

export const createWithdrawal = async (req, res, next) => {
  try {
    if (!canUseWithdrawFeature(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'ไม่มีสิทธิ์ใช้งานการเบิกสินค้า'
      });
    }

    const {
      target_department_id: targetDepartmentId,
      notes,
      items
    } = req.body || {};

    if (!targetDepartmentId) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาเลือกแผนกปลายทาง'
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ'
      });
    }

    const result = await withdrawModel.createWithdrawal({
      sourceDepartmentId: req.user.department_id,
      targetDepartmentId,
      createdBy: req.user.id,
      notes,
      items,
      allowedProductGroupIds: isAdminUser(req.user) ? [] : normalizeAllowedGroupIds(req.user),
      isAdmin: isAdminUser(req.user)
    });

    res.status(201).json({
      success: true,
      message: 'บันทึกใบเบิกเรียบร้อยแล้ว',
      data: withProductGroupAliases(result)
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

export const getWithdrawSourceMappings = async (req, res, next) => {
  try {
    const [mappings, branches, sourceDepartments] = await Promise.all([
      withdrawSourceMappingModel.getWithdrawSourceMappings(),
      withdrawSourceMappingModel.getAvailableTargetBranches(),
      withdrawSourceMappingModel.getAvailableSourceDepartments()
    ]);

    res.json({
      success: true,
      data: {
        mappings,
        branches,
        source_departments: sourceDepartments
      }
    });
  } catch (error) {
    next(error);
  }
};

export const saveWithdrawSourceMappings = async (req, res, next) => {
  try {
    const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    const saved = await withdrawSourceMappingModel.replaceWithdrawSourceMappings(mappings);
    res.json({
      success: true,
      message: 'บันทึกผังสาขา -> พื้นที่เก็บต้นทางเรียบร้อย',
      data: saved
    });
  } catch (error) {
    next(error);
  }
};
