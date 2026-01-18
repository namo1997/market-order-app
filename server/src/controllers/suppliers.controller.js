import * as supplierModel from '../models/supplier.model.js';

export const getAllSuppliers = async (req, res, next) => {
    try {
        const suppliers = await supplierModel.getAllSuppliers();
        res.json({ success: true, data: suppliers });
    } catch (error) {
        next(error);
    }
};

export const createSupplier = async (req, res, next) => {
    try {
        const supplier = await supplierModel.createSupplier(req.body);
        res.status(201).json({ success: true, data: supplier });
    } catch (error) {
        next(error);
    }
};

export const updateSupplier = async (req, res, next) => {
    try {
        const { id } = req.params;
        const supplier = await supplierModel.updateSupplier(id, req.body);
        res.json({ success: true, data: supplier });
    } catch (error) {
        next(error);
    }
};

export const deleteSupplier = async (req, res, next) => {
    try {
        const { id } = req.params;
        await supplierModel.deleteSupplier(id);
        res.json({ success: true, message: 'Supplier deleted successfully' });
    } catch (error) {
        next(error);
    }
};
