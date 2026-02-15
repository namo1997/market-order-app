import apiClient from './client';

const unwrapData = (response, fallback = []) => {
  if (response?.data?.data !== undefined) return response.data.data;
  return fallback;
};

export const stockCheckAPI = {
  // ============================================
  // User APIs - เช็คสต็อกตามรายการของ Department
  // ============================================

  // User: ดึงสินค้าประจำหมวดของ department ของตัวเอง
  getMyDepartmentTemplate: async () => {
    const response = await apiClient.get('/stock-check/my-template');
    return unwrapData(response);
  },

  // User: ดึงสต็อกที่บันทึกไว้ตามวันที่
  getMyDepartmentCheck: async (date) => {
    const params = date ? `?date=${date}` : '';
    const response = await apiClient.get(`/stock-check/my-check${params}`);
    return unwrapData(response);
  },

  // User: บันทึกสต็อกตามวันที่
  saveMyDepartmentCheck: async (date, items) => {
    const response = await apiClient.post('/stock-check/my-check', {
      date,
      items
    });
    return response.data;
  },

  // User: ดึงรายการแผนกในสาขาพร้อมสถานะเช็คสต็อก
  getMyBranchDepartments: async (date) => {
    const params = date ? `?date=${date}` : '';
    const response = await apiClient.get(`/stock-check/my-branch/departments${params}`);
    return unwrapData(response);
  },

  // User: เช็คสต็อกทั้งสาขาแบบเลือกแผนก
  bulkCheckMyBranch: async (date, departmentIds, onlyDailyRequired = true) => {
    const response = await apiClient.post('/stock-check/my-branch/check-bulk', {
      date,
      department_ids: departmentIds,
      only_daily_required: onlyDailyRequired
    });
    return response.data;
  },

  // ============================================
  // Admin APIs - จัดการสินค้าประจำหมวดให้แต่ละ Department
  // ============================================

  // Admin: เปิด/ปิดฟังก์ชั่นเช็คสต็อก
  getStockCheckStatus: async () => {
    const response = await apiClient.get('/stock-check/admin/status');
    return response.data?.data ?? response.data;
  },
  updateStockCheckStatus: async (isEnabled) => {
    const response = await apiClient.put('/stock-check/admin/status', {
      is_enabled: isEnabled
    });
    return response.data;
  },

  // Admin: ดึงสินค้าประจำหมวดทั้งหมด
  getAllTemplates: async () => {
    const response = await apiClient.get('/stock-check/admin/templates');
    return unwrapData(response);
  },

  // Admin: ดึงสินค้าประจำหมวดของ department
  getTemplateByDepartment: async (departmentId) => {
    const response = await apiClient.get(`/stock-check/admin/templates/${departmentId}`);
    return unwrapData(response);
  },

  // Admin: เพิ่มสินค้าเข้าสินค้าประจำหมวด
  addToTemplate: async (
    departmentId,
    productId,
    requiredQuantity,
    categoryId,
    minQuantity,
    dailyRequired
  ) => {
    const response = await apiClient.post('/stock-check/admin/templates', {
      department_id: departmentId,
      product_id: productId,
      required_quantity: requiredQuantity,
      category_id: categoryId,
      min_quantity: minQuantity,
      daily_required: dailyRequired
    });
    return response.data;
  },

  // Admin: แก้ไขจำนวนต้องการ
  updateTemplate: async (id, requiredQuantity, categoryId, minQuantity, dailyRequired) => {
    const response = await apiClient.put(`/stock-check/admin/templates/${id}`, {
      required_quantity: requiredQuantity,
      category_id: categoryId,
      min_quantity: minQuantity,
      daily_required: dailyRequired
    });
    return response.data;
  },

  // Admin: ลบสินค้าออกจากรายการ
  deleteFromTemplate: async (id) => {
    const response = await apiClient.delete(`/stock-check/admin/templates/${id}`);
    return response.data;
  },
  deleteTemplates: async (ids) => {
    const response = await apiClient.delete('/stock-check/admin/templates/batch', {
      data: { ids }
    });
    return response.data;
  },

  // Admin: ดึงรายการสินค้าที่ยังไม่ได้อยู่ใน template ของ department
  getAvailableProducts: async (departmentId) => {
    const response = await apiClient.get(`/stock-check/admin/available-products/${departmentId}`);
    return unwrapData(response);
  },

  // Admin: หมวดสินค้าในแต่ละ department
  getCategoriesByDepartment: async (departmentId) => {
    const response = await apiClient.get(`/stock-check/admin/categories/${departmentId}`);
    return unwrapData(response);
  },
  createCategory: async (departmentId, name) => {
    const response = await apiClient.post('/stock-check/admin/categories', {
      department_id: departmentId,
      name
    });
    return response.data;
  },
  updateCategory: async (id, name, sortOrder) => {
    const response = await apiClient.put(`/stock-check/admin/categories/${id}`, {
      name,
      sort_order: sortOrder
    });
    return response.data;
  },
  deleteCategory: async (id) => {
    const response = await apiClient.delete(`/stock-check/admin/categories/${id}`);
    return response.data;
  }
};
