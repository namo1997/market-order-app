import * as productModel from '../models/product.model.js';
import * as productGroupModel from '../models/supplier.model.js';
import {
  resolveProductGroupId,
  withProductGroupAliases,
  withProductGroupFallback
} from '../utils/product-group.js';

// ดึงรายการสินค้าทั้งหมด
export const getProducts = async (req, res, next) => {
  try {
    const {
      supplierId,
      productGroupId,
      supplier_master_id,
      search,
      internal_output,
      transform_output,
      bypass_scope
    } = req.query;
    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role);
    const useInternalOutput = String(internal_output || '').toLowerCase() === 'true';
    const useTransformOutput = String(transform_output || '').toLowerCase() === 'true';
    const useBypassScope = String(bypass_scope || '').toLowerCase() === 'true';

    const filters = {};
    const normalizedProductGroupId = resolveProductGroupId({ supplierId, productGroupId });
    if (normalizedProductGroupId) filters.supplierId = normalizedProductGroupId;
    const supplierMasterId = Number(supplier_master_id);
    if (Number.isFinite(supplierMasterId)) {
      filters.supplierMasterId = supplierMasterId;
    }
    if (search) filters.search = search;
    if (useTransformOutput && !isAdmin) {
      const fallbackIds = req.user?.allowed_product_group_ids ?? req.user?.allowed_supplier_ids;
      const transformGroups = await productGroupModel.getTransformProductGroupsByScope({
        branchId: req.user?.branch_id,
        departmentId: req.user?.department_id
      });
      let allowedTransformIds = Array.isArray(transformGroups)
        ? transformGroups
          .map((group) => Number(group.id))
          .filter((id) => Number.isFinite(id))
        : [];
      if (allowedTransformIds.length === 0) {
        const internalGroups = await productGroupModel.getInternalProductGroupsByScope({
          branchId: req.user?.branch_id,
          departmentId: req.user?.department_id
        });
        allowedTransformIds = Array.isArray(internalGroups)
          ? internalGroups
              .map((group) => Number(group.id))
              .filter((id) => Number.isFinite(id))
          : [];
      }
      if (allowedTransformIds.length === 0 && Array.isArray(fallbackIds)) {
        allowedTransformIds = fallbackIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id));
      }
      filters.allowedSupplierIds = allowedTransformIds;
      filters.bypassScope = true;
    } else if (useInternalOutput && !isAdmin) {
      const allowedIds = Array.isArray(
        req.user?.allowed_product_group_ids ?? req.user?.allowed_supplier_ids
      )
        ? (req.user?.allowed_product_group_ids ?? req.user?.allowed_supplier_ids)
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id))
        : [];
      filters.allowedSupplierIds = allowedIds;
      filters.bypassScope = true;
    } else if (!isAdmin) {
      if (useBypassScope) {
        filters.bypassScope = true;
      } else {
        filters.branchId = req.user?.branch_id;
        filters.departmentId = req.user?.department_id;
      }
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
    const productGroups = isAdmin
      ? await productModel.getAllProductGroups()
      : await productModel.getAllProductGroupsByScope({
        branchId: req.user?.branch_id,
        departmentId: req.user?.department_id
      });
    res.json({
      success: true,
      data: withProductGroupAliases(productGroups)
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
    const product = await productModel.createProduct(withProductGroupFallback(req.body));
    res.status(201).json({ success: true, data: withProductGroupAliases(product) });
  } catch (error) {
    next(error);
  }
};

// อัพเดทสินค้า
export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await productModel.updateProduct(id, withProductGroupFallback(req.body));
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
