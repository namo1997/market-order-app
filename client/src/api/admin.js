import apiClient from './client';

export const adminAPI = {
  // ดึงคำสั่งซื้อทั้งหมด
  getAllOrders: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.date) params.append('date', filters.date);
    if (filters.branchId) params.append('branchId', filters.branchId);
    if (filters.departmentId) params.append('departmentId', filters.departmentId);

    const response = await apiClient.get(`/admin/orders?${params.toString()}`);
    return response.data;
  },

  // ดึงคำสั่งซื้อแยกตามสาขา/แผนก
  getOrdersByBranch: async (date) => {
    const params = date ? `?date=${date}` : '';
    const response = await apiClient.get(`/admin/orders/by-branch${params}`);
    return response.data;
  },

  // ดึงคำสั่งซื้อแยกตามกลุ่มสินค้า
  getOrdersByProductGroup: async (date) => {
    const params = date ? `?date=${date}` : '';
    const response = await apiClient.get(`/admin/orders/by-product-group${params}`);
    return response.data;
  },

  // Backward-compatible alias
  getOrdersBySupplier: async (date) => {
    return adminAPI.getOrdersByProductGroup(date);
  },

  // ดึงรายการ order items ตามวัน
  getOrderItems: async (date, statuses = []) => {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (statuses.length > 0) params.append('status', statuses.join(','));
    const response = await apiClient.get(`/admin/orders/items?${params.toString()}`);
    return response.data;
  },

  // ดึงรายการรับของตามแผนก (admin)
  getReceivingItems: async (date, departmentIds = []) => {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (departmentIds.length > 0) {
      params.append('departmentIds', departmentIds.join(','));
    }
    const response = await apiClient.get(`/admin/orders/receiving?${params.toString()}`);
    return response.data;
  },

  // บันทึกรับของ (admin)
  updateReceivingItems: async (items) => {
    const response = await apiClient.put('/admin/orders/receiving', { items });
    return response.data;
  },

  // รับครบตามที่สั่ง (admin)
  bulkReceiveDepartments: async (date, departmentIds = []) => {
    const response = await apiClient.post('/admin/orders/receiving/bulk', {
      date,
      department_ids: departmentIds
    });
    return response.data;
  },
  transferOrder: async (orderId, payload) => {
    const response = await apiClient.put(`/admin/orders/${orderId}/transfer`, payload);
    return response.data;
  },
  getLineNotificationSettings: async () => {
    const response = await apiClient.get('/admin/line-notifications');
    return response.data;
  },
  updateLineNotificationSettings: async (payload) => {
    const response = await apiClient.put('/admin/line-notifications', payload);
    return response.data;
  },

  getDirectOrderRules: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.enabled !== undefined && filters.enabled !== null && filters.enabled !== '') {
      params.append('enabled', String(filters.enabled));
    }
    if (filters.productGroupId) {
      params.append('product_group_id', String(filters.productGroupId));
    }
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.offset) params.append('offset', String(filters.offset));
    const response = await apiClient.get(`/admin/direct-order-rules?${params.toString()}`);
    return response.data;
  },

  updateDirectOrderRule: async (productId, payload) => {
    const response = await apiClient.put(`/admin/direct-order-rules/${productId}`, payload);
    return response.data;
  },

  // รายงานการซื้อของ
  getPurchaseReport: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.start) params.append('start', filters.start);
    if (filters.end) params.append('end', filters.end);
    if (filters.groupBy) params.append('groupBy', filters.groupBy);
    if (filters.productGroupId) params.append('product_group_id', String(filters.productGroupId));
    if (filters.statuses && filters.statuses.length > 0) {
      params.append('status', filters.statuses.join(','));
    }
    const response = await apiClient.get(`/admin/reports/purchases?${params.toString()}`);
    return response.data;
  },

  getPurchaseWalkValueReport: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.start) params.append('start', filters.start);
    if (filters.end) params.append('end', filters.end);
    if (filters.view) params.append('view', filters.view);
    if (filters.priceMode) params.append('price_mode', filters.priceMode);
    if (filters.useReceived) params.append('use_received', '1');
    if (filters.branchId) params.append('branch_id', String(filters.branchId));
    if (filters.departmentId) params.append('department_id', String(filters.departmentId));
    if (filters.productGroupId) params.append('product_group_id', String(filters.productGroupId));
    if (filters.statuses && filters.statuses.length > 0) {
      params.append('status', filters.statuses.join(','));
    }
    const response = await apiClient.get(
      `/admin/reports/purchase-walk-values?${params.toString()}`
    );
    return response.data;
  },

  getPurchaseWalkValueDetailReport: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.start) params.append('start', filters.start);
    if (filters.end) params.append('end', filters.end);
    if (filters.priceMode) params.append('price_mode', filters.priceMode);
    if (filters.useReceived) params.append('use_received', '1');
    if (filters.branchId) params.append('branch_id', String(filters.branchId));
    if (filters.departmentId) params.append('department_id', String(filters.departmentId));
    if (filters.productGroupId) params.append('product_group_id', String(filters.productGroupId));
    if (filters.statuses && filters.statuses.length > 0) {
      params.append('status', filters.statuses.join(','));
    }
    const response = await apiClient.get(
      `/admin/reports/purchase-walk-values/detail?${params.toString()}`
    );
    return response.data;
  },

  getPurchaseWalkValueProductDetailByDateReport: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.start) params.append('start', filters.start);
    if (filters.end) params.append('end', filters.end);
    if (filters.productId) params.append('product_id', String(filters.productId));
    if (filters.priceMode) params.append('price_mode', filters.priceMode);
    if (filters.useReceived) params.append('use_received', '1');
    if (filters.branchId) params.append('branch_id', String(filters.branchId));
    if (filters.departmentId) params.append('department_id', String(filters.departmentId));
    if (filters.productGroupId) params.append('product_group_id', String(filters.productGroupId));
    if (filters.statuses && filters.statuses.length > 0) {
      params.append('status', filters.statuses.join(','));
    }
    const response = await apiClient.get(
      `/admin/reports/purchase-walk-values/product-detail-by-date?${params.toString()}`
    );
    return response.data;
  },

  getPurchaseReceiveReconcileReport: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.start) params.append('start', filters.start);
    if (filters.end) params.append('end', filters.end);
    if (filters.productGroupId) params.append('product_group_id', String(filters.productGroupId));
    if (filters.statuses && filters.statuses.length > 0) {
      params.append('status', filters.statuses.join(','));
    }
    const response = await apiClient.get(
      `/admin/reports/purchase-receive-reconcile?${params.toString()}`
    );
    return response.data;
  },

  getPurchaseOrderStatusLedger: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.date) params.append('date', filters.date);
    if (filters.productGroupId) params.append('product_group_id', String(filters.productGroupId));
    if (filters.branchId) params.append('branch_id', String(filters.branchId));
    if (filters.departmentId) params.append('department_id', String(filters.departmentId));
    if (filters.centralStatus) params.append('central_status', filters.centralStatus);
    if (filters.statuses && filters.statuses.length > 0) {
      params.append('status', filters.statuses.join(','));
    }
    const response = await apiClient.get(
      `/admin/reports/purchase-order-status-ledger?${params.toString()}`
    );
    return response.data;
  },

  getPurchaseReceivingSummaryReport: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.start) params.append('start', filters.start);
    if (filters.end) params.append('end', filters.end);
    if (filters.view) params.append('view', filters.view);
    if (filters.productGroupId) params.append('product_group_id', String(filters.productGroupId));
    if (filters.statuses && filters.statuses.length > 0) {
      params.append('status', filters.statuses.join(','));
    }
    const response = await apiClient.get(
      `/admin/reports/purchase-receiving-summary?${params.toString()}`
    );
    return response.data;
  },

  getPurchaseReceiveReconcileDetail: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.date) params.append('date', filters.date);
    if (filters.productId) params.append('product_id', String(filters.productId));
    if (filters.productGroupId) params.append('product_group_id', String(filters.productGroupId));
    if (filters.statuses && filters.statuses.length > 0) {
      params.append('status', filters.statuses.join(','));
    }
    const response = await apiClient.get(
      `/admin/reports/purchase-receive-reconcile/detail?${params.toString()}`
    );
    return response.data;
  },

  getPurchaseReceivingSummaryDetail: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.start) params.append('start', filters.start);
    if (filters.end) params.append('end', filters.end);
    if (filters.productGroupId) params.append('product_group_id', String(filters.productGroupId));
    if (filters.branchId) params.append('branch_id', String(filters.branchId));
    if (filters.departmentId) params.append('department_id', String(filters.departmentId));
    if (filters.statuses && filters.statuses.length > 0) {
      params.append('status', filters.statuses.join(','));
    }
    const response = await apiClient.get(
      `/admin/reports/purchase-receiving-summary/detail?${params.toString()}`
    );
    return response.data;
  },

  getPriceReport: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.start) params.append('start', filters.start);
    if (filters.end) params.append('end', filters.end);
    if (filters.date) params.append('date', filters.date);
    const response = await apiClient.get(`/admin/reports/prices?${params.toString()}`);
    return response.data;
  },

  getDepartmentActivitySummary: async (type) => {
    const params = new URLSearchParams();
    params.append('type', type);
    const response = await apiClient.get(`/admin/reports/department-activity?${params.toString()}`);
    return response.data;
  },

  getDepartmentActivityDetail: async (type, departmentId, limit = 120) => {
    const params = new URLSearchParams();
    params.append('type', type);
    params.append('limit', String(limit));
    const response = await apiClient.get(
      `/admin/reports/department-activity/${departmentId}?${params.toString()}`
    );
    return response.data;
  },

  // ปิดรับคำสั่งซื้อ
  closeOrders: async (date) => {
    const response = await apiClient.post('/admin/orders/close', { date });
    return response.data;
  },

  // เปิดรับคำสั่งซื้อ
  openOrders: async (date) => {
    const response = await apiClient.post('/admin/orders/open', { date });
    return response.data;
  },

  // บันทึกการซื้อจริง
  recordPurchase: async (itemId, actualPrice, isPurchased) => {
    const response = await apiClient.put(`/admin/order-items/${itemId}/purchase`, {
      actual_price: actualPrice,
      is_purchased: isPurchased
    });
    return response.data;
  },

  // บันทึกการซื้อจริงแบบรวมตามสินค้า
  recordPurchaseByProduct: async (payload) => {
    const response = await apiClient.put('/admin/purchases/by-product', payload);
    return response.data;
  },

  // ยืนยันซื้อของเสร็จแล้ว (อัปเดตคำสั่งซื้อที่ซื้อครบ)
  completePurchasesByDate: async (date) => {
    const response = await apiClient.post('/admin/purchases/complete', { date });
    return response.data;
  },

  completePurchasesByProductGroup: async (date, productGroupId) => {
    const response = await apiClient.post('/admin/purchases/complete-by-product-group', {
      date,
      product_group_id: productGroupId
    });
    return response.data;
  },

  completePurchasesBySupplier: async (date, supplierId) => {
    return adminAPI.completePurchasesByProductGroup(date, supplierId);
  },

  // ตั้งค่าการเดินซื้อของ
  getPurchaseWalkProducts: async (productGroupId) => {
    const params = new URLSearchParams();
    if (productGroupId) {
      params.append('product_group_id', productGroupId);
    }
    const response = await apiClient.get(`/admin/purchase-walk/products?${params.toString()}`);
    return response.data;
  },
  updatePurchaseWalkOrder: async (productGroupId, productIds) => {
    const response = await apiClient.put('/admin/purchase-walk/order', {
      product_group_id: productGroupId,
      product_ids: productIds
    });
    return response.data;
  },
  getPurchaseWalkManualItems: async (date) => {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    const response = await apiClient.get(
      `/admin/purchase-walk/manual-items?${params.toString()}`
    );
    return response.data;
  },
  createPurchaseWalkManualItem: async (payload) => {
    const response = await apiClient.post('/admin/purchase-walk/manual-items', payload);
    return response.data;
  },
  updatePurchaseWalkManualItem: async (id, payload) => {
    const response = await apiClient.put(`/admin/purchase-walk/manual-items/${id}`, payload);
    return response.data;
  },
  deletePurchaseWalkManualItem: async (id) => {
    const response = await apiClient.delete(`/admin/purchase-walk/manual-items/${id}`);
    return response.data;
  },

  // รีเซ็ตวันสั่งซื้อ (สำหรับทดสอบ)
  resetOrderDay: async (date) => {
    const response = await apiClient.post('/admin/orders/reset', { date });
    return response.data;
  },

  // รีเซ็ตคำสั่งซื้อรายบุคคล
  resetOrder: async (orderId) => {
    const response = await apiClient.post(`/admin/orders/${orderId}/reset`);
    return response.data;
  },

  // รีเซ็ตคำสั่งซื้อทั้งหมด
  resetAllOrders: async () => {
    const response = await apiClient.post('/admin/orders/reset-all');
    return response.data;
  },

  // เปลี่ยนสถานะคำสั่งซื้อ
  updateOrderStatus: async (orderId, status) => {
    const response = await apiClient.put(`/admin/orders/${orderId}/status`, { status });
    return response.data;
  },

};
