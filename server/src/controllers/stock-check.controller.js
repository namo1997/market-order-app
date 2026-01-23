import * as stockCheckModel from '../models/stock-check.model.js';
import * as settingsModel from '../models/settings.model.js';

const normalizeBoolean = (value) => {
  if (typeof value === 'string') {
    return value === 'true' || value === '1';
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return Boolean(value);
};

const getStockCheckEnabled = async () => {
  const value = await settingsModel.getSetting('stock_check_enabled', 'true');
  return value === 'true';
};

const requireStockCheckEnabled = async (res) => {
  const enabled = await getStockCheckEnabled();
  if (!enabled) {
    res.status(403).json({
      success: false,
      message: 'ปิดการใช้งานเช็คสต็อกแล้ว'
    });
    return false;
  }
  return true;
};

// ============================================
// User Controllers - เช็คสต็อกตามรายการของ Department
// ============================================

// User: ดึงรายการของประจำของ department ของตัวเอง
export const getMyDepartmentTemplate = async (req, res, next) => {
  try {
    const departmentId = req.user.department_id;
    const template = await stockCheckModel.getTemplateByDepartmentId(departmentId);

    res.json({
      success: true,
      data: template,
      count: template.length
    });
  } catch (error) {
    next(error);
  }
};

// User: ดึงรายการสต็อกที่บันทึกไว้ตามวันที่
export const getMyDepartmentStockCheck = async (req, res, next) => {
  try {
    if (!(await requireStockCheckEnabled(res))) return;
    const departmentId = req.user.department_id;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const checks = await stockCheckModel.getStockChecksByDepartmentId(departmentId, date);

    res.json({
      success: true,
      data: checks,
      count: checks.length,
      date
    });
  } catch (error) {
    next(error);
  }
};

// User: บันทึกสต็อกของแผนกในวันที่เลือก
export const saveMyDepartmentStockCheck = async (req, res, next) => {
  try {
    if (!(await requireStockCheckEnabled(res))) return;
    const departmentId = req.user.department_id;
    const userId = req.user.id;
    const { date, items } = req.body;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date is required'
      });
    }

    if (!Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        message: 'Items must be an array'
      });
    }

    const normalizedItems = items
      .map((item) => ({
        product_id: item.product_id,
        stock_quantity: Number(item.stock_quantity || 0)
      }))
      .filter((item) => item.product_id);

    const result = await stockCheckModel.upsertStockChecks(
      departmentId,
      userId,
      date,
      normalizedItems
    );

    res.json({
      success: true,
      data: result,
      message: 'Stock check saved'
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// Admin Controllers - จัดการรายการของประจำให้แต่ละ Department
// ============================================

// Admin: ดึงหมวดสินค้าในแต่ละแผนก
export const getCategoriesByDepartment = async (req, res, next) => {
  try {
    const { departmentId } = req.params;
    const categories = await stockCheckModel.getCategoriesByDepartmentId(departmentId);

    res.json({
      success: true,
      data: categories,
      count: categories.length
    });
  } catch (error) {
    next(error);
  }
};

// Admin: เพิ่มหมวดสินค้า
export const addCategory = async (req, res, next) => {
  try {
    const { department_id, name } = req.body;
    const trimmedName = String(name || '').trim();

    if (!department_id || !trimmedName) {
      return res.status(400).json({
        success: false,
        message: 'Department ID and category name are required'
      });
    }

    const result = await stockCheckModel.addCategory(department_id, trimmedName);

    res.status(201).json({
      success: true,
      data: result,
      message: 'Category added successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Admin: แก้ไขชื่อหมวดสินค้า
export const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, sort_order } = req.body;
    const hasName = name !== undefined;
    const hasSortOrder = sort_order !== undefined;

    if (!hasName && !hasSortOrder) {
      return res.status(400).json({
        success: false,
        message: 'Category name or sort order is required'
      });
    }

    let trimmedName;
    if (hasName) {
      trimmedName = String(name || '').trim();
      if (!trimmedName) {
        return res.status(400).json({
          success: false,
          message: 'Category name is required'
        });
      }
    }

    let normalizedSortOrder;
    if (hasSortOrder) {
      normalizedSortOrder = Number(sort_order);
      if (Number.isNaN(normalizedSortOrder)) {
        return res.status(400).json({
          success: false,
          message: 'Sort order must be a number'
        });
      }
    }

    const result = await stockCheckModel.updateCategory(id, trimmedName, normalizedSortOrder);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.json({
      success: true,
      data: result,
      message: 'Category updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Admin: ลบหมวดสินค้า
export const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await stockCheckModel.deleteCategory(id);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Admin: ดึงรายการของประจำทั้งหมด
export const getAllTemplates = async (req, res, next) => {
  try {
    const templates = await stockCheckModel.getAllTemplates();

    res.json({
      success: true,
      data: templates,
      count: templates.length
    });
  } catch (error) {
    next(error);
  }
};

// Admin: ดึงรายการของประจำของ department
export const getTemplateByDepartment = async (req, res, next) => {
  try {
    const { departmentId } = req.params;
    const template = await stockCheckModel.getTemplateByDepartmentId(departmentId);

    res.json({
      success: true,
      data: template,
      count: template.length
    });
  } catch (error) {
    next(error);
  }
};

// Admin: เพิ่มสินค้าเข้ารายการของประจำของ department
export const addToTemplate = async (req, res, next) => {
  try {
    const { department_id, product_id, required_quantity, category_id, min_quantity } = req.body;

    if (!department_id || !product_id || required_quantity === undefined || required_quantity === null) {
      return res.status(400).json({
        success: false,
        message: 'Department ID, Product ID and required quantity are required'
      });
    }

    if (required_quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Required quantity must be greater than or equal to 0'
      });
    }

    if (min_quantity !== undefined && min_quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Min quantity must be greater than or equal to 0'
      });
    }

    const result = await stockCheckModel.addToTemplate(
      department_id,
      product_id,
      required_quantity,
      category_id,
      min_quantity
    );

    res.status(201).json({
      success: true,
      data: result,
      message: 'Product added to template successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Admin: แก้ไขจำนวนต้องการในรายการของประจำ
export const updateTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { required_quantity, category_id, min_quantity } = req.body;

    if (required_quantity === undefined && category_id === undefined && min_quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Required quantity, min quantity or category is required'
      });
    }

    if (required_quantity !== undefined && required_quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Required quantity must be greater than or equal to 0'
      });
    }

    if (min_quantity !== undefined && min_quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Min quantity must be greater than or equal to 0'
      });
    }

    const result = await stockCheckModel.updateTemplate(
      id,
      required_quantity,
      category_id,
      min_quantity
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Template item not found'
      });
    }

    res.json({
      success: true,
      data: result,
      message: 'Template updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Admin: ลบสินค้าออกจากรายการของประจำ
export const deleteFromTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await stockCheckModel.deleteFromTemplate(id);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Template item not found'
      });
    }

    res.json({
      success: true,
      message: 'Product removed from template successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Admin: ดึงรายการสินค้าที่ยังไม่ได้อยู่ใน template ของ department
export const getAvailableProducts = async (req, res, next) => {
  try {
    const { departmentId } = req.params;
    const products = await stockCheckModel.getAvailableProducts(departmentId);

    res.json({
      success: true,
      data: products,
      count: products.length
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// Admin Controllers - เปิด/ปิดฟังก์ชั่นเช็คสต็อก
// ============================================

export const getStockCheckStatus = async (req, res, next) => {
  try {
    const isEnabled = await getStockCheckEnabled();
    res.json({
      success: true,
      data: { is_enabled: isEnabled }
    });
  } catch (error) {
    next(error);
  }
};

export const updateStockCheckStatus = async (req, res, next) => {
  try {
    const { is_enabled } = req.body;

    if (is_enabled === undefined) {
      return res.status(400).json({
        success: false,
        message: 'is_enabled is required'
      });
    }

    const normalized = normalizeBoolean(is_enabled);
    await settingsModel.setSetting('stock_check_enabled', normalized ? 'true' : 'false');

    res.json({
      success: true,
      data: { is_enabled: normalized },
      message: 'Stock check status updated'
    });
  } catch (error) {
    next(error);
  }
};
