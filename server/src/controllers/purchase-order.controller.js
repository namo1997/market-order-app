import * as model from '../models/purchase-order.model.js';

export const getPurchaseOrders = async (req, res, next) => {
  try {
    const { status, supplier_master_id, start_date, end_date, branch_id, department_id, limit } = req.query;
    const filters = {};
    if (status) filters.status = status;
    if (supplier_master_id) filters.supplierMasterId = supplier_master_id;
    if (start_date) filters.startDate = start_date;
    if (end_date) filters.endDate = end_date;
    if (branch_id) filters.branchId = branch_id;
    if (department_id) filters.departmentId = department_id;
    if (limit) filters.limit = limit;

    const rows = await model.getPurchaseOrders(filters);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
};

export const getPurchaseOrderById = async (req, res, next) => {
  try {
    const po = await model.getPurchaseOrderById(Number(req.params.id));
    res.json({ success: true, data: po });
  } catch (err) {
    next(err);
  }
};

export const createPurchaseOrder = async (req, res, next) => {
  try {
    const {
      supplier_master_id,
      po_date,
      expected_date,
      notes,
      items
    } = req.body || {};

    const po = await model.createPurchaseOrder({
      supplierMasterId: supplier_master_id,
      departmentId: req.user?.department_id || null,
      branchId: req.user?.branch_id || null,
      createdBy: req.user?.id,
      poDate: po_date,
      expectedDate: expected_date || null,
      notes: notes || null,
      items: Array.isArray(items) ? items : []
    });

    res.status(201).json({ success: true, data: po, message: `สร้างใบสั่งซื้อ ${po.po_number} เรียบร้อย` });
  } catch (err) {
    next(err);
  }
};

export const receivePurchaseOrder = async (req, res, next) => {
  try {
    const poId = Number(req.params.id);
    const { items } = req.body || {};

    const po = await model.receivePurchaseOrder({
      poId,
      items: Array.isArray(items) ? items : [],
      receivedBy: req.user?.id
    });

    res.json({ success: true, data: po, message: 'บันทึกการรับสินค้าเรียบร้อย' });
  } catch (err) {
    next(err);
  }
};

export const cancelPurchaseOrder = async (req, res, next) => {
  try {
    const po = await model.cancelPurchaseOrder(Number(req.params.id));
    res.json({ success: true, data: po, message: 'ยกเลิกใบสั่งซื้อเรียบร้อย' });
  } catch (err) {
    next(err);
  }
};
