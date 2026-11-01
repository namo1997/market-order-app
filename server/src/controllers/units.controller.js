import * as unitModel from '../models/unit.model.js';
import { requireText } from '../utils/master-data-validation.js';

export const getAllUnits = async (req, res, next) => {
    try {
        const units = await unitModel.getAllUnits();
        res.json({ success: true, data: units });
    } catch (error) {
        next(error);
    }
};

export const createUnit = async (req, res, next) => {
    try {
        const { name, abbreviation } = req.body || {};
        requireText(name, 'ชื่อหน่วย', 50);
        requireText(abbreviation, 'ตัวย่อหน่วย', 10);
        const unit = await unitModel.createUnit({ name, abbreviation });
        res.status(201).json({ success: true, data: unit });
    } catch (error) {
        next(error);
    }
};

export const updateUnit = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, abbreviation } = req.body || {};
        const unit = await unitModel.updateUnit(id, { name, abbreviation });
        res.json({ success: true, data: unit });
    } catch (error) {
        next(error);
    }
};

export const deleteUnit = async (req, res, next) => {
    try {
        const { id } = req.params;
        await unitModel.deleteUnit(id);
        res.json({ success: true, message: 'Unit deleted successfully' });
    } catch (error) {
        next(error);
    }
};
