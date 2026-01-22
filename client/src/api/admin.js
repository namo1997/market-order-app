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

  // ดึงคำสั่งซื้อแยกตาม supplier
  getOrdersBySupplier: async (date) => {
    const params = date ? `?date=${date}` : '';
    const response = await apiClient.get(`/admin/orders/by-supplier${params}`);
    return response.data;
  },

  // ดึงรายการ order items ตามวัน
  getOrderItems: async (date, statuses = []) => {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (statuses.length > 0) params.append('status', statuses.join(','));
    const response = await apiClient.get(`/admin/orders/items?${params.toString()}`);
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

  completePurchasesBySupplier: async (date, supplierId) => {
    const response = await apiClient.post('/admin/purchases/complete-by-supplier', {
      date,
      supplier_id: supplierId
    });
    return response.data;
  },

  // ตั้งค่าการเดินซื้อของ
  getPurchaseWalkProducts: async (supplierId) => {
    const params = new URLSearchParams();
    if (supplierId) params.append('supplier_id', supplierId);
    const response = await apiClient.get(`/admin/purchase-walk/products?${params.toString()}`);
    return response.data;
  },
  updatePurchaseWalkOrder: async (supplierId, productIds) => {
    const response = await apiClient.put('/admin/purchase-walk/order', {
      supplier_id: supplierId,
      product_ids: productIds
    });
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
  }
};
