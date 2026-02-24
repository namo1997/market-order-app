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
    }
    if (filters.lowStock) params.append('low_stock', 'true');
    if (filters.highValueOnly) params.append('high_value_only', 'true');
    if (filters.recipeLinkedOnly) params.append('recipe_linked_only', 'true');
    if (filters.search) params.append('search', filters.search);
    if (filters.page) params.append('page', filters.page);
    if (filters.limit) params.append('limit', filters.limit);

    const response = await apiClient.get(`/inventory/balance?${params.toString()}`);
    // ส่งคืน { data, pagination } เพื่อให้ component จัดการ pagination ได้
    return {
      data: unwrapData(response),
      pagination: response?.data?.pagination || null
    };
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
    if (filters.search) params.append('search', filters.search);
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

  /**
   * ลบ transaction ประเภท sale ในช่วงวันที่ + ย้อน balance (admin only)
   */
  deleteSaleMovements: async ({ startDate, endDate, departmentId } = {}) => {
    const payload = { start_date: startDate, end_date: endDate };
    if (departmentId) payload.department_id = departmentId;
    const response = await apiClient.delete('/inventory/movements/sale', { data: payload });
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
  applyAdjustment: async (date, departmentId, productIds = []) => {
    const payload = {
      date,
      department_id: departmentId
    };
    if (Array.isArray(productIds) && productIds.length > 0) {
      payload.product_ids = productIds;
    }
    const response = await apiClient.post('/inventory/apply-adjustment', payload);
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
  },

  /**
   * ยอดคงเหลือ + ประมาณการหักยอดขายวันนี้จาก ClickHouse
   * คืน { data, meta: { clickhouse_available, already_synced, as_of_date } }
   */
  getRealtimeBalance: async (departmentId) => {
    const params = new URLSearchParams({ department_id: departmentId });
    const response = await apiClient.get(`/inventory/realtime-balance?${params.toString()}`);
    return {
      data: unwrapData(response),
      meta: response?.data?.meta || {}
    };
  },

  /**
   * ดึงประวัติการแปรรูปสินค้า
   */
  getProductionTransformHistory: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.departmentId) params.append('department_id', filters.departmentId);
    if (filters.date) params.append('date', filters.date);
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    if (filters.limit) params.append('limit', filters.limit);

    const response = await apiClient.get(`/inventory/production/transform/history?${params.toString()}`);
    return unwrapData(response);
  }
};
