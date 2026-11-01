import * as conversionModel from '../models/unit-conversion.model.js';

export const getConversions = async (req, res, next) => {
  try {
    const conversions = await conversionModel.getConversions();
    res.json({ success: true, data: conversions });
  } catch (error) {
    next(error);
  }
};

export const createConversion = async (req, res, next) => {
  try {
    const { from_unit_id, to_unit_id, multiplier } = req.body;

    if (!from_unit_id || !to_unit_id || multiplier === undefined) {
      return res.status(400).json({
        success: false,
        message: 'from_unit_id, to_unit_id and multiplier are required'
      });
    }

    const normalizedMultiplier = Number(multiplier);
    if (!Number.isFinite(normalizedMultiplier) || normalizedMultiplier <= 0) {
      return res.status(400).json({
        success: false,
        message: 'multiplier must be greater than 0'
      });
    }

    const fromUnitId = Number(from_unit_id);
    const toUnitId = Number(to_unit_id);
    if (!Number.isInteger(fromUnitId) || fromUnitId <= 0 || !Number.isInteger(toUnitId) || toUnitId <= 0) {
      return res.status(400).json({ success: false, message: 'หน่วยไม่ถูกต้อง' });
    }
    if (fromUnitId === toUnitId) {
      return res.status(400).json({ success: false, message: 'หน่วยต้นทางและหน่วยปลายทางต้องไม่ใช่หน่วยเดียวกัน' });
    }
    if (normalizedMultiplier > 9999999999) {
      return res.status(400).json({ success: false, message: 'ตัวคูณมากเกินไป' });
    }
    if ((await conversionModel.countActiveUnits([fromUnitId, toUnitId])) !== 2) {
      return res.status(400).json({ success: false, message: 'ไม่พบหน่วยที่เลือก' });
    }
    // POST is create-only; changing an existing pair goes through PUT /unit-conversions/:id.
    const existing = await conversionModel.findConversionByPair(fromUnitId, toUnitId);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'มีการแปลงหน่วยคู่นี้อยู่แล้ว กรุณาแก้ไขรายการเดิม',
        data: { existing_id: existing.id }
      });
    }

    const result = await conversionModel.createConversion(
      fromUnitId,
      toUnitId,
      normalizedMultiplier
    );

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const updateConversion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { multiplier } = req.body;

    if (multiplier === undefined) {
      return res.status(400).json({
        success: false,
        message: 'multiplier is required'
      });
    }

    const normalizedMultiplier = Number(multiplier);
    if (!Number.isFinite(normalizedMultiplier) || normalizedMultiplier <= 0) {
      return res.status(400).json({
        success: false,
        message: 'multiplier must be greater than 0'
      });
    }
    if (normalizedMultiplier > 9999999999) {
      return res.status(400).json({ success: false, message: 'ตัวคูณมากเกินไป' });
    }

    const result = await conversionModel.updateConversion(
      Number(id),
      normalizedMultiplier
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Conversion not found'
      });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const deleteConversion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await conversionModel.deleteConversion(Number(id));

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Conversion not found'
      });
    }

    res.json({ success: true, message: 'Conversion deleted' });
  } catch (error) {
    next(error);
  }
};
