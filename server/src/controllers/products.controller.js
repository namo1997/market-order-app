import * as productModel from '../models/product.model.js';
import {
  resolveSupplierId,
  withProductGroupAliases,
  withSupplierFallback
} from '../utils/product-group.js';

// ดึงรายการสินค้าทั้งหมด
export const getProducts = async (req, res, next) => {
  try {
    const { supplierId, productGroupId, search } = req.query;
    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);

    const filters = {};
    const normalizedSupplierId = resolveSupplierId({ supplierId, productGroupId });
    if (normalizedSupplierId) filters.supplierId = normalizedSupplierId;
    if (search) filters.search = search;
    if (!isAdmin) {
      filters.branchId = req.user?.branch_id;
      filters.departmentId = req.user?.department_id;
    }

    const products = await productModel.getAllProducts(filters);

    res.json({
      success: true,
      data: withProductGroupAliases(products),
      count: products.length
    });
  } catch (error) {
    next(error);
  }
};

// ดึงข้อมูลสินค้าตาม ID
export const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await productModel.getProductById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: withProductGroupAliases(product)
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายการ suppliers
export const getSuppliers = async (req, res, next) => {
  try {
    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
    const suppliers = isAdmin
      ? await productModel.getAllSuppliers()
      : await productModel.getAllSuppliersByScope({
        branchId: req.user?.branch_id,
        departmentId: req.user?.department_id
      });
    res.json({
      success: true,
      data: withProductGroupAliases(suppliers)
    });
  } catch (error) {
    next(error);
  }
};

export const getProductGroups = getSuppliers;

export const getSupplierMasters = async (req, res, next) => {
  try {
    const suppliers = await productModel.getAllSupplierMasters();
    res.json({
      success: true,
      data: suppliers
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายการ units
export const getUnits = async (req, res, next) => {
  try {
    const units = await productModel.getAllUnits();
    res.json({
      success: true,
      data: units
    });
  } catch (error) {
    next(error);
  }
};
// สร้างสินค้าใหม่
export const createProduct = async (req, res, next) => {
  try {
    const product = await productModel.createProduct(withSupplierFallback(req.body));
    res.status(201).json({ success: true, data: withProductGroupAliases(product) });
  } catch (error) {
    next(error);
  }
};

// อัพเดทสินค้า
export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await productModel.updateProduct(id, withSupplierFallback(req.body));
    res.json({ success: true, data: withProductGroupAliases(product) });
  } catch (error) {
    if (error.message === 'Product not found') {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    next(error);
  }
};

// ลบสินค้า
export const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    await productModel.deleteProduct(id);
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    next(error);
  }
};
