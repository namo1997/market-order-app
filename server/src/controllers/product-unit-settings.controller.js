import * as model from '../models/product-unit-settings.model.js';

export const list = async (req, res, next) => {
  try {
    const data = await model.listProductUnitSettings(req.query || {});
    res.json({ success: true, data, count: data.length });
  } catch (error) {
    next(error);
  }
};

export const save = async (req, res, next) => {
  try {
    const data = await model.saveProductUnitSettings(req.params.productId, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};
