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

    const result = await conversionModel.createConversion(
      Number(from_unit_id),
      Number(to_unit_id),
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
