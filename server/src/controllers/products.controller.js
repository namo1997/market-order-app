import * as productModel from '../models/product.model.js';

// ดึงรายการสินค้าทั้งหมด
export const getProducts = async (req, res, next) => {
  try {
    const { supplierId, search } = req.query;

    const filters = {};
    if (supplierId) filters.supplierId = supplierId;
    if (search) filters.search = search;

    const products = await productModel.getAllProducts(filters);

    res.json({
      success: true,
      data: products,
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
      data: product
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายการ suppliers
export const getSuppliers = async (req, res, next) => {
  try {
    const suppliers = await productModel.getAllSuppliers();
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
    const product = await productModel.createProduct(req.body);
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

// อัพเดทสินค้า
export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await productModel.updateProduct(id, req.body);
    res.json({ success: true, data: product });
  } catch (error) {
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
