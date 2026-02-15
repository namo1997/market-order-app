import * as supplierModel from '../models/supplier.model.js';
import { withProductGroupAliases, withSupplierFallback } from '../utils/product-group.js';

export const getAllSuppliers = async (req, res, next) => {
    try {
        const suppliers = await supplierModel.getAllSuppliers();
        res.json({ success: true, data: withProductGroupAliases(suppliers) });
    } catch (error) {
        next(error);
    }
};

export const createSupplier = async (req, res, next) => {
    try {
        const supplier = await supplierModel.createSupplier(withSupplierFallback(req.body));
        res.status(201).json({ success: true, data: withProductGroupAliases(supplier) });
    } catch (error) {
        next(error);
    }
};

export const updateSupplier = async (req, res, next) => {
    try {
        const { id } = req.params;
        const supplier = await supplierModel.updateSupplier(id, withSupplierFallback(req.body));
        res.json({ success: true, data: withProductGroupAliases(supplier) });
    } catch (error) {
        next(error);
    }
};

export const deleteSupplier = async (req, res, next) => {
    try {
        const { id } = req.params;
        await supplierModel.deleteSupplier(id);
        res.json({ success: true, message: 'Product group deleted successfully' });
    } catch (error) {
        next(error);
    }
};

export const getAllProductGroups = getAllSuppliers;
export const createProductGroup = createSupplier;
export const updateProductGroup = updateSupplier;
export const deleteProductGroup = deleteSupplier;
