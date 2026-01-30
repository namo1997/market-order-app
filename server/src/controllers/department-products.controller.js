import * as departmentProductsModel from '../models/department-products.model.js';

export const getMyDepartmentProducts = async (req, res, next) => {
  try {
    const departmentId = req.user.department_id;
    const rows = await departmentProductsModel.getProductIdsByDepartmentId(departmentId);

    res.json({
      success: true,
      data: rows.map((row) => row.product_id),
      count: rows.length
    });
  } catch (error) {
    next(error);
  }
};

export const getDepartmentProductsByDepartment = async (req, res, next) => {
  try {
    const { departmentId } = req.params;
    if (!departmentId) {
      return res.status(400).json({
        success: false,
        message: 'Department ID is required'
      });
    }

    const products = await departmentProductsModel.getDepartmentProducts(departmentId);

    res.json({
      success: true,
      data: products,
      count: products.length
    });
  } catch (error) {
    next(error);
  }
};

export const getAvailableProductsByDepartment = async (req, res, next) => {
  try {
    const { departmentId } = req.params;
    if (!departmentId) {
      return res.status(400).json({
        success: false,
        message: 'Department ID is required'
      });
    }

    const products = await departmentProductsModel.getAvailableProducts(departmentId);

    res.json({
      success: true,
      data: products,
      count: products.length
    });
  } catch (error) {
    next(error);
  }
};

export const addDepartmentProduct = async (req, res, next) => {
  try {
    const { department_id, product_id } = req.body;

    if (!department_id || !product_id) {
      return res.status(400).json({
        success: false,
        message: 'Department ID and Product ID are required'
      });
    }

    const result = await departmentProductsModel.addDepartmentProduct(
      department_id,
      product_id
    );

    res.status(201).json({
      success: true,
      data: result,
      message: 'Product added to department successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const deleteDepartmentProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await departmentProductsModel.removeDepartmentProduct(id);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Department product not found'
      });
    }

    res.json({
      success: true,
      message: 'Product removed from department successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const copyFromStockTemplate = async (req, res, next) => {
  try {
    const { department_id } = req.body;

    if (!department_id) {
      return res.status(400).json({
        success: false,
        message: 'Department ID is required'
      });
    }

    const result = await departmentProductsModel.copyFromStockTemplate(department_id);

    res.json({
      success: true,
      data: result,
      message: 'Copy completed'
    });
  } catch (error) {
    next(error);
  }
};
