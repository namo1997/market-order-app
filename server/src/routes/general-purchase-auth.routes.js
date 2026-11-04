import express from 'express';
import jwt from 'jsonwebtoken';
import { findActiveHeadEmployeeRef } from '../models/employee-ref.model.js';

const router = express.Router();

const READONLY_PIN = String(process.env.GENERAL_PURCHASE_READONLY_PIN || (process.env.NODE_ENV === 'production' ? '' : '1997')).trim();

const getMarketSecret = () => {
  const secret = process.env.JWT_SECRET || '';
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw Object.assign(new Error('Production requires JWT_SECRET with at least 32 characters'), { statusCode: 503 });
  }
  return secret || 'market-order-secret';
};
// Missing legacy shared secret must use the authenticated HRMS /auth/me path,
// never the publicly documented development key in production.
const getEmployeeSecret = () => {
  const secret = process.env.EMPLOYEE_JWT_SECRET;
  if (process.env.NODE_ENV === 'production') return secret && secret !== 'solao-leave-secret-2025' ? secret : undefined;
  return secret || 'solao-leave-secret-2025';
};
const getHrmsApiBaseUrl = () =>
  (process.env.HRMS_API_BASE_URL || 'https://hrms-backend-production-8d94.up.railway.app/api').replace(/\/+$/, '');

const ROLES_CAN_CREATE = ['ADMIN', 'APPROVER_L1', 'APPROVER_L2', 'APPROVER_L3'];
const HEAD_ROLES = [...ROLES_CAN_CREATE, 'HR'];
const getReviewerEmployeeCodes = () =>
  (process.env.GENERAL_PURCHASE_REVIEWER_EMPLOYEE_CODES || '1')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);

const signGeneralPurchaseSession = (payload) =>
  jwt.sign(
    {
      scope: 'general_purchase',
      ...payload
    },
    getMarketSecret(),
    { expiresIn: payload.mode === 'readonly' ? '8h' : '12h' }
  );

const isHeadEmployee = (employee) => {
  const role = String(employee?.role || '').toUpperCase();
  const positionName = String(employee?.pos_name || employee?.position_name || '');
  const positionLevel = Number(employee?.pos_level ?? employee?.position_level ?? 0);
  return (
    HEAD_ROLES.includes(role) ||
    positionLevel >= 3 ||
    /หัวหน้า|ผู้จัดการ|manager|lead/i.test(positionName)
  );
};

const getHrmsEmployeeFromToken = async (employeeToken) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${getHrmsApiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const buildUserFromEmployeeRef = (employee) => ({
  mode: 'employee_head',
  employeeId: employee.source_employee_id,
  employeeCode: employee.employee_code,
  fullName: employee.full_name || `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
  role: employee.role,
  branchName: employee.branch_name,
  departmentName: employee.department_name,
  positionName: employee.position_name
});

const buildUserFromHrmsEmployee = (employee) => ({
  mode: 'employee_head',
  employeeId: employee.id,
  employeeCode: employee.employee_code,
  fullName:
    employee.full_name_raw ||
    `${employee.first_name || ''} ${employee.last_name || ''}`.trim() ||
    employee.nickname ||
    employee.employee_code,
  role: employee.role,
  branchName: employee.branch_name,
  departmentName: employee.dept_name || employee.department_name,
  positionName: employee.pos_name || employee.position_name
});

const canApproveGeneralPurchase = (access) =>
  access?.mode === 'employee_head' &&
  getReviewerEmployeeCodes().includes(String(access?.employeeCode || '').trim());

router.post('/employee/exchange', async (req, res, next) => {
  try {
    const employeeToken = String(req.body?.token || '').trim();
    if (!employeeToken) {
      return res.status(400).json({ success: false, message: 'ไม่พบ token จากระบบพนักงาน' });
    }

    let payload = null;
    try {
      payload = jwt.verify(employeeToken, getEmployeeSecret());
    } catch (error) {
      payload = null;
    }

    let hrmsEmployee = payload ? null : await getHrmsEmployeeFromToken(employeeToken);
    if (!payload && !hrmsEmployee) {
      return res.status(401).json({ success: false, message: 'token ระบบพนักงานไม่ถูกต้องหรือหมดอายุ' });
    }

    const employee = await findActiveHeadEmployeeRef({
      sourceEmployeeId: payload?.id,
      employeeCode: payload?.employee_code || hrmsEmployee?.employee_code
    });

    if (!employee && !hrmsEmployee) {
      hrmsEmployee = await getHrmsEmployeeFromToken(employeeToken);
    }

    if (!employee && !isHeadEmployee(hrmsEmployee)) {
      return res.status(403).json({
        success: false,
        message: 'ไม่พบสิทธิ์หัวหน้างานในฐานข้อมูลพนักงานของระบบสั่งของ'
      });
    }

    const user = employee ? buildUserFromEmployeeRef(employee) : buildUserFromHrmsEmployee(hrmsEmployee);

    const role = String(user.role || '').toUpperCase();

    return res.json({
      success: true,
      data: {
        token: signGeneralPurchaseSession(user),
        user,
        canCreate: ROLES_CAN_CREATE.includes(role),
        canApprove: canApproveGeneralPurchase(user),
        readonly: false
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/pin', (req, res) => {
  if (!READONLY_PIN || (process.env.NODE_ENV === 'production' && READONLY_PIN === '1997')) {
    return res.status(503).json({ success: false, message: 'GENERAL_PURCHASE_READONLY_PIN is not configured' });
  }
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
      canApprove: false,
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
  const access = req.generalPurchaseAccess;
  if (access?.mode !== 'employee_head' || !ROLES_CAN_CREATE.includes(String(access?.role || '').toUpperCase())) {
    return res.status(403).json({
      success: false,
      message: 'ไม่มีสิทธิ์สร้าง PR ต้องเข้าจากแอพผู้จัดการสาขาเท่านั้น'
    });
  }
  next();
};

export const requireGeneralPurchaseOperator = (req, res, next) => {
  if (req.generalPurchaseAccess?.mode !== 'employee_head') {
    return res.status(403).json({ success: false, message: 'สิทธิ์ดูข้อมูลไม่สามารถออก PO หรือบันทึกรับสินค้าได้' });
  }
  next();
};

export const requireGeneralPurchaseReviewer = (req, res, next) => {
  const access = req.generalPurchaseAccess;
  if (!canApproveGeneralPurchase(access)) {
    return res.status(403).json({
      success: false,
      message: 'ไม่มีสิทธิ์อนุมัติ/ปฏิเสธ PR ผู้อนุมัติคือ สุรชาติ สิทธิพร เท่านั้น'
    });
  }
  next();
};

export default router;
