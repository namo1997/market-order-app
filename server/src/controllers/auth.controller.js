import * as userModel from '../models/user.model.js';
import * as productGroupModel from '../models/supplier.model.js';
import pool from '../config/database.js';
import { generateToken } from '../utils/jwt.js';
import { syncDatabaseFromRailway } from '../services/db-sync.service.js';
import { withProductGroupAliases } from '../utils/product-group.js';

let syncInProgress = false;

const buildUserAccess = async (user) => {
  if (!user) {
    return {
      internalProductGroups: [],
      transformProductGroups: [],
      allowedProductGroupIds: [],
      allowedTransformProductGroupIds: [],
      canViewProductGroupOrders: false,
      internalSuppliers: [],
      allowedSupplierIds: [],
      canViewSupplierOrders: false
    };
  }

  await productGroupModel.ensureInternalOrderScopeTable();
  await productGroupModel.ensureTransformScopeTable();
  const [internalProductGroups] = await pool.query(
    `SELECT s.id, s.code, s.name
     FROM product_groups s
     JOIN product_group_internal_scopes pgis ON pgis.product_group_id = s.id
     WHERE s.is_active = true
       AND s.is_internal = true
       AND pgis.branch_id = ?
       AND pgis.department_id = ?
     ORDER BY s.name`,
    [user.branch_id, user.department_id]
  );
  const allowedProductGroupIds = new Set(
    (internalProductGroups || [])
      .map((group) => Number(group.id))
      .filter((id) => Number.isFinite(id))
  );
  const [transformProductGroups] = await pool.query(
    `SELECT s.id, s.code, s.name
     FROM product_groups s
     JOIN product_group_transform_scopes pgts ON pgts.product_group_id = s.id
     WHERE s.is_active = true
       AND pgts.branch_id = ?
       AND pgts.department_id = ?
     ORDER BY s.name`,
    [user.branch_id, user.department_id]
  );
  const allowedTransformProductGroupIds = new Set(
    (transformProductGroups || [])
      .map((group) => Number(group.id))
      .filter((id) => Number.isFinite(id))
  );
  const resolvedAllowedTransformProductGroupIds =
    allowedTransformProductGroupIds.size > 0
      ? Array.from(allowedTransformProductGroupIds)
      : Array.from(allowedProductGroupIds);

  return {
    internalProductGroups,
    transformProductGroups,
    allowedProductGroupIds: Array.from(allowedProductGroupIds),
    allowedTransformProductGroupIds: resolvedAllowedTransformProductGroupIds,
    canViewProductGroupOrders: allowedProductGroupIds.size > 0,
    // Legacy aliases
    internalSuppliers: internalProductGroups,
    allowedSupplierIds: Array.from(allowedProductGroupIds),
    canViewSupplierOrders: allowedProductGroupIds.size > 0
  };
};

const buildUserPayload = async (user) => {
  const access = await buildUserAccess(user);
  const isProductionDepartment = Boolean(user?.is_production);
  const canUseStockCheck =
    user?.stock_check_required === undefined || user?.stock_check_required === null
      ? true
      : Boolean(Number(user.stock_check_required));
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    department_id: user.department_id,
    branch_id: user.branch_id,
    department: user.department_name,
    branch: user.branch_name,
    internal_suppliers: withProductGroupAliases(access.internalSuppliers),
    internal_product_groups: withProductGroupAliases(access.internalProductGroups),
    transform_product_groups: withProductGroupAliases(access.transformProductGroups),
    allowed_supplier_ids: access.allowedSupplierIds,
    allowed_product_group_ids: access.allowedProductGroupIds,
    allowed_transform_product_group_ids: access.allowedTransformProductGroupIds,
    can_view_supplier_orders: access.canViewSupplierOrders,
    can_view_product_group_orders: access.canViewProductGroupOrders,
    is_production_department: isProductionDepartment,
    can_use_stock_check: canUseStockCheck,
    can_view_stock_balance: Boolean(Number(user.can_view_stock_balance || 0))
  };
};

// ดึงรายการสาขา
export const getBranches = async (req, res, next) => {
  try {
    const branches = await userModel.getAllBranches();
    res.json({
      success: true,
      data: branches
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายการแผนกตามสาขา
export const getDepartments = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const departments = await userModel.getDepartmentsByBranch(branchId);
    res.json({
      success: true,
      data: departments
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายการผู้ใช้ตามแผนก
export const getUsers = async (req, res, next) => {
  try {
    const { departmentId } = req.params;
    const users = await userModel.getUsersByDepartment(departmentId);
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    next(error);
  }
};

// Login
export const login = async (req, res, next) => {
  try {
    const { departmentId, userId } = req.body;

    if (!departmentId && !userId) {
      return res.status(400).json({
        success: false,
        message: 'Department ID is required'
      });
    }

    if (!departmentId && userId) {
      const user = await userModel.getUserById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const userPayload = await buildUserPayload(user);
      const token = generateToken({
        id: userPayload.id,
        username: userPayload.username,
        name: userPayload.name,
        role: userPayload.role,
        department_id: userPayload.department_id,
        branch_id: userPayload.branch_id,
        can_view_supplier_orders: userPayload.can_view_supplier_orders,
        can_view_product_group_orders: userPayload.can_view_product_group_orders,
        allowed_supplier_ids: userPayload.allowed_supplier_ids,
        allowed_product_group_ids: userPayload.allowed_product_group_ids,
        allowed_transform_product_group_ids: userPayload.allowed_transform_product_group_ids,
        is_production_department: userPayload.is_production_department,
        can_use_stock_check: userPayload.can_use_stock_check
      });

      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user: userPayload
        }
      });
    }

    const department = await userModel.getDepartmentById(departmentId);

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    const departmentUsername = `dept_${departmentId}`;
    let user = await userModel.getUserByUsername(departmentUsername);
    const shouldBeAdmin = department.code === 'ADMIN';

    if (!user) {
      const created = await userModel.createUser({
        username: departmentUsername,
        name: department.name,
        role: shouldBeAdmin ? 'admin' : 'user',
        department_id: departmentId
      });
      user = await userModel.getUserById(created.id);
    } else if (shouldBeAdmin && user.role !== 'admin') {
      await userModel.updateUser(user.id, {
        name: user.name,
        role: 'admin',
        department_id: user.department_id
      });
      user = await userModel.getUserById(user.id);
    } else if (!shouldBeAdmin && user.role !== 'user') {
      await userModel.updateUser(user.id, {
        name: user.name,
        role: 'user',
        department_id: user.department_id
      });
      user = await userModel.getUserById(user.id);
    }

    const userPayload = await buildUserPayload(user);
    const token = generateToken({
      id: userPayload.id,
      username: userPayload.username,
      name: userPayload.name,
      role: userPayload.role,
      department_id: userPayload.department_id,
      branch_id: userPayload.branch_id,
      can_view_supplier_orders: userPayload.can_view_supplier_orders,
      can_view_product_group_orders: userPayload.can_view_product_group_orders,
      allowed_supplier_ids: userPayload.allowed_supplier_ids,
      allowed_product_group_ids: userPayload.allowed_product_group_ids,
      allowed_transform_product_group_ids: userPayload.allowed_transform_product_group_ids,
      is_production_department: userPayload.is_production_department,
      can_use_stock_check: userPayload.can_use_stock_check
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: userPayload
      }
    });
  } catch (error) {
    next(error);
  }
};

// Super Admin Login (PIN)
export const loginSuperAdmin = async (req, res, next) => {
  try {
    const { pin } = req.body;
    const expectedPin = process.env.SUPER_ADMIN_PIN || '1997';

    if (!pin || String(pin) !== String(expectedPin)) {
      return res.status(401).json({
        success: false,
        message: 'PIN ไม่ถูกต้อง'
      });
    }

    const username = 'supper_admin';
    const name = 'supper admin';
    const role = 'super_admin';

    let user = await userModel.getUserByUsername(username);

    if (!user) {
      const defaultDept = await userModel.getDefaultAdminDepartment();

      if (!defaultDept) {
        return res.status(400).json({
          success: false,
          message: 'ไม่พบแผนกสำหรับ Super Admin'
        });
      }

      let created;
      try {
        created = await userModel.createUser({
          username,
          name,
          role,
          department_id: defaultDept.id
        });
      } catch (err) {
        if (
          err?.code === 'ER_WRONG_VALUE_FOR_TYPE' ||
          err?.code === 'ER_TRUNCATED_WRONG_VALUE' ||
          String(err?.message || '').includes('Data truncated for column')
        ) {
          created = await userModel.createUser({
            username,
            name,
            role: 'admin',
            department_id: defaultDept.id
          });
        } else {
          throw err;
        }
      }
      user = await userModel.getUserById(created.id);
    }

    const userPayload = {
      id: user.id,
      username: user.username,
      name: user.name,
      role,
      department_id: user.department_id,
      branch_id: user.branch_id,
      department: user.department_name,
      branch: user.branch_name,
      internal_suppliers: [],
      internal_product_groups: [],
      transform_product_groups: [],
      allowed_supplier_ids: [],
      allowed_product_group_ids: [],
      allowed_transform_product_group_ids: [],
      can_view_supplier_orders: false,
      can_view_product_group_orders: false,
      is_production_department: false,
      can_use_stock_check: false
    };
    const token = generateToken({
      id: user.id,
      username: user.username,
      name: user.name,
      role,
      department_id: user.department_id,
      branch_id: user.branch_id,
      can_view_supplier_orders: false,
      can_view_product_group_orders: false,
      allowed_supplier_ids: [],
      allowed_product_group_ids: [],
      allowed_transform_product_group_ids: [],
      is_production_department: false,
      can_use_stock_check: false
    });

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: userPayload
      }
    });
  } catch (error) {
    next(error);
  }
};

// ซิงค์ฐานข้อมูลจาก Railway (ใช้เฉพาะเครื่อง local)
export const syncRailwayDatabase = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'ไม่อนุญาตให้ซิงค์ฐานข้อมูลใน production'
      });
    }

    const { confirm } = req.body || {};

    if (!confirm) {
      return res.status(400).json({
        success: false,
        message: 'กรุณายืนยันการซิงค์ข้อมูล'
      });
    }

    if (syncInProgress) {
      return res.status(409).json({
        success: false,
        message: 'กำลังซิงค์ข้อมูลอยู่ กรุณารอสักครู่'
      });
    }

    const sourceUrl =
      process.env.RAILWAY_DB_URL ||
      process.env.RAILWAY_MYSQL_URL ||
      process.env.MYSQL_PUBLIC_URL ||
      process.env.RAILWAY_DATABASE_URL ||
      '';
    if (!sourceUrl) {
      return res.status(400).json({
        success: false,
        message: 'ยังไม่ได้ตั้งค่า RAILWAY_DB_URL'
      });
    }

    const targetConfig = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME || 'market_order_db'
    };

    syncInProgress = true;
    await syncDatabaseFromRailway({ sourceUrl, targetConfig });

    return res.json({
      success: true,
      message: 'ซิงค์ข้อมูลเรียบร้อยแล้ว (แนะนำให้รีสตาร์ท backend)'
    });
  } catch (error) {
    if (error?.code === 'RAILWAY_TEMP_UNAVAILABLE') {
      return res.status(503).json({
        success: false,
        message: 'โหลดข้อมูลจาก Railway ไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งใน 5-10 นาที'
      });
    }
    next(error);
  } finally {
    syncInProgress = false;
  }
};

// ดึงข้อมูล user ปัจจุบัน (จาก token)
export const getCurrentUser = async (req, res, next) => {
  try {
    const user = await userModel.getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const payload = await buildUserPayload(user);
    res.json({
      success: true,
      data: payload
    });
  } catch (error) {
    next(error);
  }
};
