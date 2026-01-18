import * as unitModel from '../models/unit.model.js';

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
        const { name, abbreviation } = req.body;
        if (!name || !abbreviation) {
            return res.status(400).json({ success: false, message: 'Name and abbreviation are required' });
        }
        const unit = await unitModel.createUnit({ name, abbreviation });
        res.status(201).json({ success: true, data: unit });
    } catch (error) {
        next(error);
    }
};

export const updateUnit = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, abbreviation } = req.body;
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
