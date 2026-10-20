import { canUseProductionTransform } from './inventory.controller.js';
import {
  listDepartmentUsageUnits,
  findDepartmentIngredient,
  saveProductUsageUnit
} from '../models/product-usage-unit.model.js';
import { normalizeUsageUnitConfig } from '../utils/usage-unit-rules.js';
import pool from '../config/database.js';

// แอดมินเลือกแผนกได้; ผู้ใช้แผนกแปรรูปใช้ได้เฉพาะแผนกตัวเอง
const resolveDepartmentId = (req, requested) => {
  if (!canUseProductionTransform(req.user)) return { status: 403, message: 'ไม่มีสิทธิ์ใช้งานหน้าแปรรูป' };
  const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
  const own = Number(req.user?.department_id);
  const target = Number(requested) || own;
  if (!Number.isInteger(target) || target <= 0) return { status: 400, message: 'กรุณาระบุแผนก' };
  if (!isAdmin && target !== own) return { status: 403, message: 'ตั้งค่าได้เฉพาะแผนกของตัวเอง' };
  return { departmentId: target };
};

export const list = async (req, res, next) => {
  try {
    const scope = resolveDepartmentId(req, req.query?.department_id);
    if (scope.status) return res.status(scope.status).json({ success: false, message: scope.message });
    const data = await listDepartmentUsageUnits(scope.departmentId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const save = async (req, res, next) => {
  try {
    const scope = resolveDepartmentId(req, req.body?.department_id);
    if (scope.status) return res.status(scope.status).json({ success: false, message: scope.message });
    const productId = Number(req.params.productId);
    const ingredient = await findDepartmentIngredient(scope.departmentId, productId);
    if (!ingredient) {
      return res.status(404).json({ success: false, message: 'สินค้านี้ไม่ได้เป็นวัตถุดิบในสูตรแปรรูปของแผนกนี้' });
    }
    const usage = normalizeUsageUnitConfig({
      usageUnitId: req.body?.usage_unit_id,
      usagePerBase: req.body?.usage_per_base,
      baseUnitId: ingredient.base_unit_id
    });
    if (usage.error) return res.status(400).json({ success: false, message: usage.error });
    await saveProductUsageUnit(pool, productId, usage.value, req.user?.id || null);
    const updated = await findDepartmentIngredient(scope.departmentId, productId);
    res.json({ success: true, data: updated, message: usage.value ? 'บันทึกหน่วยใช้แล้ว' : 'ยกเลิกหน่วยใช้แล้ว' });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    next(error);
  }
};
