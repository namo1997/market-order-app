import express from 'express';
import jwt from 'jsonwebtoken';
import { findActiveHeadEmployeeRef } from '../models/employee-ref.model.js';

const router = express.Router();

const READONLY_PIN = process.env.GENERAL_PURCHASE_READONLY_PIN || '1997';

const getMarketSecret = () => process.env.JWT_SECRET || 'market-order-secret';
const getEmployeeSecret = () => process.env.EMPLOYEE_JWT_SECRET || 'solao-leave-secret-2025';

const signGeneralPurchaseSession = (payload) =>
  jwt.sign(
    {
      scope: 'general_purchase',
      ...payload
    },
    getMarketSecret(),
    { expiresIn: payload.mode === 'readonly' ? '8h' : '12h' }
  );

router.post('/employee/exchange', async (req, res, next) => {
  try {
    const employeeToken = String(req.body?.token || '').trim();
    if (!employeeToken) {
      return res.status(400).json({ success: false, message: 'ไม่พบ token จากระบบพนักงาน' });
    }

    let payload;
    try {
      payload = jwt.verify(employeeToken, getEmployeeSecret());
    } catch (error) {
      return res.status(401).json({ success: false, message: 'token ระบบพนักงานไม่ถูกต้องหรือหมดอายุ' });
    }

    const employee = await findActiveHeadEmployeeRef({
      sourceEmployeeId: payload?.id,
      employeeCode: payload?.employee_code
    });

    if (!employee) {
      return res.status(403).json({
        success: false,
        message: 'ไม่พบสิทธิ์หัวหน้างานในฐานข้อมูลพนักงานของระบบสั่งของ'
      });
    }

    const user = {
      mode: 'employee_head',
      employeeId: employee.source_employee_id,
      employeeCode: employee.employee_code,
      fullName: employee.full_name || `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
      role: employee.role,
      branchName: employee.branch_name,
      departmentName: employee.department_name,
      positionName: employee.position_name
    };

    return res.json({
      success: true,
      data: {
        token: signGeneralPurchaseSession(user),
        user,
        canCreate: true,
        readonly: false
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/pin', (req, res) => {
  const pin = String(req.body?.pin || '').trim();
  if (pin !== READONLY_PIN) {
    return res.status(401).json({ success: false, message: 'PIN ไม่ถูกต้อง' });
  }

  const user = {
    mode: 'readonly',
    fullName: 'ดูระบบ PR/PO',
    role: 'READONLY_PIN'
  };

  return res.json({
    success: true,
    data: {
      token: signGeneralPurchaseSession(user),
      user,
      canCreate: false,
      readonly: true
    }
  });
});

export const verifyGeneralPurchaseSession = (req, res, next) => {
  const token = String(req.headers['x-general-purchase-token'] || '').trim();
  if (!token) {
    return res.status(401).json({ success: false, message: 'กรุณาเข้าระบบ PR/PO จากแอพหัวหน้า หรือกรอก PIN เพื่อดูข้อมูล' });
  }

  try {
    const payload = jwt.verify(token, getMarketSecret());
    if (payload?.scope !== 'general_purchase') {
      return res.status(401).json({ success: false, message: 'สิทธิ์ PR/PO ไม่ถูกต้อง' });
    }
    req.generalPurchaseAccess = payload;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'สิทธิ์ PR/PO หมดอายุ กรุณาเข้าระบบใหม่' });
  }
};

export const requireGeneralPurchaseHead = (req, res, next) => {
  if (req.generalPurchaseAccess?.mode !== 'employee_head') {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์สั่งซื้อ ต้องเข้าจากแอพหัวหน้างานเท่านั้น' });
  }
  next();
};

export const requireGeneralPurchaseOperator = (req, res, next) => {
  if (req.generalPurchaseAccess?.mode !== 'operator') {
    return res.status(403).json({
      success: false,
      message: 'สิทธิ์หัวหน้างานใช้ได้เฉพาะหน้าหลักและสร้าง PR เท่านั้น'
    });
  }
  next();
};

export default router;
