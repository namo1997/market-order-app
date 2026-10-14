import * as model from '../models/employee-ref.model.js';

export const listEmployeeRefs = async (req, res, next) => {
  try {
    const rows = await model.getEmployeeRefs({
      isActive: req.query.is_active,
      isHead: req.query.is_head,
      role: req.query.role,
      branchName: req.query.branch_name,
      departmentName: req.query.department_name,
      search: req.query.search,
      limit: req.query.limit
    });
    res.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    next(error);
  }
};

export const getEmployeeRefStats = async (req, res, next) => {
  try {
    const stats = await model.getEmployeeRefStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

export const syncEmployeeRefs = async (req, res, next) => {
  try {
    const stats = await model.syncEmployeeRefsFromLocalProject();
    res.json({ success: true, data: stats, message: 'ซิงค์รายชื่อพนักงานเข้าระบบสั่งของเรียบร้อย' });
  } catch (error) {
    next(error);
  }
};
