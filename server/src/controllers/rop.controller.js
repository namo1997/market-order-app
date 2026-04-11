import * as ropModel from '../models/rop.model.js';

const toErrorMessage = (error) => {
  switch (error?.message) {
    case 'DEPARTMENT_NOT_PRODUCTION':
      return 'แผนกนี้ไม่ใช่แผนกฝ่ายผลิต';
    case 'PRODUCT_NOT_IN_DEPARTMENT':
      return 'สินค้านี้ไม่ได้ผูกกับแผนกฝ่ายผลิตที่เลือก';
    case 'INVALID_SETTING':
      return 'ค่าตั้งต้นไม่ถูกต้อง';
    case 'INVALID_MIN_MAX':
      return 'Min ต้องไม่มากกว่า Max';
    case 'INVALID_INPUT':
      return 'ข้อมูลไม่ครบถ้วน';
    default:
      return null;
  }
};

export const getOverview = async (req, res, next) => {
  try {
    const { department_id, window_days } = req.query;
    const overview = await ropModel.getRopOverview({
      departmentId: department_id ? Number(department_id) : null,
      windowDays: window_days ? Number(window_days) : 7
    });

    res.json({
      success: true,
      data: overview
    });
  } catch (error) {
    const message = toErrorMessage(error);
    if (message) {
      return res.status(400).json({
        success: false,
        message
      });
    }
    next(error);
  }
};

export const saveSetting = async (req, res, next) => {
  try {
    const {
      department_id,
      product_id,
      lead_time_days,
      safety_stock_days,
      min_quantity,
      max_quantity
    } = req.body || {};

    if (!department_id || !product_id) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาระบุแผนกและสินค้า'
      });
    }

    const result = await ropModel.upsertRopSetting({
      departmentId: Number(department_id),
      productId: Number(product_id),
      leadTimeDays: lead_time_days,
      safetyStockDays: safety_stock_days,
      minQuantity: min_quantity,
      maxQuantity: max_quantity,
      userId: req.user?.id || null
    });

    res.json({
      success: true,
      message: 'บันทึกค่า ROP เรียบร้อย',
      data: result
    });
  } catch (error) {
    const message = toErrorMessage(error);
    if (message) {
      return res.status(400).json({
        success: false,
        message
      });
    }
    next(error);
  }
};

