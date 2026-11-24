import * as packingModel from '../models/production-packing.model.js';

// ขอบเขตกลุ่มสินค้าเหมือนหน้าคำสั่งซื้อ (getScopedProductGroupIds ใน admin.controller.js)
// ผู้ดูแล = กลุ่มครัวกลางตั้งต้น; ผู้ใช้ที่ไม่ได้ผูกกลุ่มไว้ = ไม่เห็นอะไร (ไม่ปล่อยให้เห็นทุกกลุ่มโดยปริยาย)
export const scopedGroupIds = (user) => {
  if (['admin', 'super_admin'].includes(user?.role)) return packingModel.DEFAULT_PRODUCTION_GROUP_IDS;
  const allowed = user?.allowed_product_group_ids ?? user?.allowed_supplier_ids;
  return Array.isArray(allowed)
    ? allowed.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
};

const readDate = (req, res) => {
  const date = String(req.query.date || req.body?.date || '').trim();
  if (!packingModel.isValidPackDate(date)) {
    res.status(400).json({ success: false, message: 'วันที่ไม่ถูกต้อง' });
    return null;
  }
  return date;
};

const readBranchId = (req, res) => {
  const branchId = Number(req.params.branchId);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    res.status(400).json({ success: false, message: 'สาขาไม่ถูกต้อง' });
    return null;
  }
  return branchId;
};

export const getOverview = async (req, res, next) => {
  try {
    const date = readDate(req, res);
    if (!date) return;
    const branches = await packingModel.getPackingOverview({ date, groupIds: scopedGroupIds(req.user) });
    res.json({ success: true, data: branches, date });
  } catch (error) {
    next(error);
  }
};

export const getBranch = async (req, res, next) => {
  try {
    const date = readDate(req, res);
    const branchId = date && readBranchId(req, res);
    if (!date || !branchId) return;
    const branch = await packingModel.getBranchPacking({ date, branchId, groupIds: scopedGroupIds(req.user) });
    if (!branch) return res.status(404).json({ success: false, message: 'ไม่พบใบสั่งของสาขานี้' });
    res.json({ success: true, data: branch });
  } catch (error) {
    next(error);
  }
};

export const scan = async (req, res, next) => {
  try {
    const date = readDate(req, res);
    const branchId = date && readBranchId(req, res);
    if (!date || !branchId) return;
    const result = await packingModel.scanStickerForBranch({
      date,
      branchId,
      code: req.body?.code,
      userId: req.user?.id,
      groupIds: scopedGroupIds(req.user)
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const adjust = async (req, res, next) => {
  try {
    const date = readDate(req, res);
    const branchId = date && readBranchId(req, res);
    if (!date || !branchId) return;
    const result = await packingModel.adjustPackedManually({
      date,
      branchId,
      productId: req.body?.product_id,
      delta: req.body?.delta,
      userId: req.user?.id,
      groupIds: scopedGroupIds(req.user)
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const removeEntry = async (req, res, next) => {
  try {
    const date = readDate(req, res);
    const branchId = date && readBranchId(req, res);
    if (!date || !branchId) return;
    const removed = await packingModel.removePackingEntry({ id: req.params.entryId, date, branchId });
    if (!removed) return res.status(404).json({ success: false, message: 'ไม่พบรายการ' });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const setPacked = async (req, res, next) => {
  try {
    const date = readDate(req, res);
    const branchId = date && readBranchId(req, res);
    if (!date || !branchId) return;
    await packingModel.setBranchPacked({ date, branchId, packed: req.body?.packed !== false, userId: req.user?.id });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
