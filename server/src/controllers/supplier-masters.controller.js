import * as supplierMasterModel from '../models/supplier-master.model.js';

export const getAllSupplierMasters = async (req, res, next) => {
  try {
    const suppliers = await supplierMasterModel.getAllSupplierMasters();
    res.json({ success: true, data: suppliers });
  } catch (error) {
    next(error);
  }
};

export const createSupplierMaster = async (req, res, next) => {
  try {
    const supplier = await supplierMasterModel.createSupplierMaster(req.body);
    res.status(201).json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
};

export const updateSupplierMaster = async (req, res, next) => {
  try {
    const { id } = req.params;
    const supplier = await supplierMasterModel.updateSupplierMaster(id, req.body);
    res.json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
};

export const deleteSupplierMaster = async (req, res, next) => {
  try {
    const { id } = req.params;
    await supplierMasterModel.deleteSupplierMaster(id);
    res.json({ success: true, message: 'Supplier deleted successfully' });
  } catch (error) {
    next(error);
  }
};
