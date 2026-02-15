import apiClient from './client';

const unwrapData = (response, fallback = []) => {
  if (response?.data?.data !== undefined) return response.data.data;
  return fallback;
};

export const inventoryAPI = {
  // ====================================
  // Dashboard
  // ====================================

  /**
   * ดึงสรุปภาพรวมคลังสินค้า
   */
  getDashboard: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.departmentId) params.append('department_id', filters.departmentId);
    if (filters.branchId) params.append('branch_id', filters.branchId);
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);

    const response = await apiClient.get(`/inventory/dashboard?${params.toString()}`);
    return unwrapData(response, {});
  },

  // ====================================
  // Inventory Balance (ยอดคงเหลือ)
  // ====================================

  /**
   * ดึงยอดคงเหลือทั้งหมด
   */
  getBalances: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.departmentId) params.append('department_id', filters.departmentId);
    if (filters.branchId) params.append('branch_id', filters.branchId);
    if (filters.productId) params.append('product_id', filters.productId);
    const productGroupId = filters.productGroupId ?? filters.supplierId;
    if (productGroupId) {
      params.append('product_group_id', productGroupId);
      params.append('supplier_id', productGroupId);
    }
    if (filters.lowStock) params.append('low_stock', 'true');
    if (filters.search) params.append('search', filters.search);

    const response = await apiClient.get(`/inventory/balance?${params.toString()}`);
    return unwrapData(response);
  },

  /**
   * ดึงยอดคงเหลือของสินค้าในแผนก
   */
  getBalance: async (productId, departmentId) => {
    const response = await apiClient.get(`/inventory/balance/${productId}/${departmentId}`);
    return unwrapData(response, null);
  },

  // ====================================
  // Stock Movements (การเคลื่อนไหว)
  // ====================================

  /**
   * ดึงประวัติการเคลื่อนไหว
   */
  getMovements: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.productId) params.append('product_id', filters.productId);
    if (filters.departmentId) params.append('department_id', filters.departmentId);
    if (filters.branchId) params.append('branch_id', filters.branchId);
    if (filters.transactionType) params.append('transaction_type', filters.transactionType);
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    if (filters.limit) params.append('limit', filters.limit);
    if (filters.offset) params.append('offset', filters.offset);

    const response = await apiClient.get(`/inventory/movements?${params.toString()}`);
    return unwrapData(response);
  },

  /**
   * บันทึกการเคลื่อนไหวสต็อก (Manual)
   */
  createMovement: async (data) => {
    const response = await apiClient.post('/inventory/movements', data);
    return response.data;
  },

  // ====================================
  // Stock Card (บัตรคุมสต็อก)
  // ====================================

  /**
   * ดูประวัติรายสินค้า (บัตรคุมสต็อก)
   */
  getStockCard: async (productId, departmentId, filters = {}) => {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);

    const response = await apiClient.get(
      `/inventory/stock-card/${productId}/${departmentId}?${params.toString()}`
    );
    return unwrapData(response, {});
  },

  // ====================================
  // Stock Variance Report
  // ====================================

  /**
   * รายงานเปรียบเทียบยอดระบบ vs ยอดนับจริง
   */
  getVarianceReport: async (date, filters = {}) => {
    const params = new URLSearchParams({ date });
    if (filters.departmentId) params.append('department_id', filters.departmentId);
    if (filters.branchId) params.append('branch_id', filters.branchId);
    if (filters.varianceOnly) params.append('variance_only', 'true');

    const response = await apiClient.get(`/inventory/variance-report?${params.toString()}`);
    return unwrapData(response, {});
  },

  /**
   * ปรับปรุงยอดคงเหลือตามการนับจริง
   */
  applyAdjustment: async (date, departmentId) => {
    const response = await apiClient.post('/inventory/apply-adjustment', {
      date,
      department_id: departmentId
    });
    return response.data;
  },

  // ====================================
  // Utilities
  // ====================================

  /**
   * ตั้งยอดเริ่มต้น
   */
  initializeBalance: async (productId, departmentId, quantity) => {
    const response = await apiClient.post('/inventory/init-balance', {
      product_id: productId,
      department_id: departmentId,
      quantity
    });
    return response.data;
  },

  /**
   * แปรรูปวัตถุดิบเป็นสินค้าสำเร็จ
   */
  createProductionTransform: async (payload) => {
    const response = await apiClient.post('/inventory/production/transform', payload);
    return response.data;
  }
};
