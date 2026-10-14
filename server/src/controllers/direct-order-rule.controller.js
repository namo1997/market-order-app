import * as directOrderRuleModel from '../models/direct-order-rule.model.js';

export const getDirectOrderRules = async (req, res, next) => {
  try {
    const result = await directOrderRuleModel.listDirectOrderRules({
      search: req.query.search,
      enabled: req.query.enabled,
      productGroupId: req.query.product_group_id ?? req.query.productGroupId,
      limit: req.query.limit,
      offset: req.query.offset
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const updateDirectOrderRule = async (req, res, next) => {
  try {
    const updated = await directOrderRuleModel.upsertDirectOrderRule({
      productId: req.params.productId,
      payload: req.body || {},
      userId: req.user?.id || null
    });

    res.json({
      success: true,
      message: 'บันทึกการตั้งค่าสำเร็จ',
      data: updated
    });
  } catch (error) {
    if (error?.statusCode === 400) {
      return res.status(400).json({
        success: false,
        message: error.message || 'ข้อมูลไม่ถูกต้อง'
      });
    }
    if (error?.statusCode === 404) {
      return res.status(404).json({
        success: false,
        message: error.message || 'ไม่พบข้อมูล'
      });
    }
    next(error);
  }
};
