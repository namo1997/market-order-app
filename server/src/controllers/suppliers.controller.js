import * as supplierModel from '../models/supplier.model.js';
import { withProductGroupAliases, withProductGroupFallback } from '../utils/product-group.js';

export const getAllProductGroups = async (req, res, next) => {
    try {
        const productGroups = await supplierModel.getAllProductGroups();
        res.json({ success: true, data: withProductGroupAliases(productGroups) });
    } catch (error) {
        next(error);
    }
};

export const createProductGroup = async (req, res, next) => {
    try {
        const productGroup = await supplierModel.createProductGroup(
            withProductGroupFallback(req.body)
        );
        res.status(201).json({ success: true, data: withProductGroupAliases(productGroup) });
    } catch (error) {
        next(error);
    }
};

export const updateProductGroup = async (req, res, next) => {
    try {
        const { id } = req.params;
        const productGroup = await supplierModel.updateProductGroup(
            id,
            withProductGroupFallback(req.body)
        );
        res.json({ success: true, data: withProductGroupAliases(productGroup) });
    } catch (error) {
        next(error);
    }
};

export const deleteProductGroup = async (req, res, next) => {
    try {
        const { id } = req.params;
        await supplierModel.deleteProductGroup(id);
        res.json({ success: true, message: 'Product group deleted successfully' });
    } catch (error) {
        next(error);
    }
};

// Legacy aliases
export const getAllSuppliers = getAllProductGroups;
export const createSupplier = createProductGroup;
export const updateSupplier = updateProductGroup;
export const deleteSupplier = deleteProductGroup;
