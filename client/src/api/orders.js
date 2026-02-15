import apiClient from './client';

export const ordersAPI = {
  // เช็คสถานะเปิด/ปิดรับออเดอร์
  getOrderStatus: async (date) => {
    const params = date ? `?date=${date}` : '';
    const response = await apiClient.get(`/orders/status${params}`);
    return response.data;
  },

  // ดึงคำสั่งซื้อของตัวเอง
  getMyOrders: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.date) params.append('date', filters.date);

    const response = await apiClient.get(`/orders/my-orders?${params.toString()}`);
    return response.data;
  },

  // ดึงรายละเอียดคำสั่งซื้อ
  getOrderById: async (id) => {
    const response = await apiClient.get(`/orders/${id}`);
    return response.data;
  },

  // ดึงรายการรับของของแผนกตัวเอง
  getReceivingItems: async (date, scope = 'mine') => {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (scope) params.append('scope', scope);
    const response = await apiClient.get(`/orders/receiving?${params.toString()}`);
    return response.data;
  },

  // ดึงประวัติการรับสินค้า
  getReceivingHistory: async ({ date, scope = 'mine', fromDate, toDate, limit } = {}) => {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (scope) params.append('scope', scope);
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (limit) params.append('limit', String(limit));
    const response = await apiClient.get(`/orders/receiving/history?${params.toString()}`);
    return response.data;
  },

  // บันทึกรับของของแผนกตัวเอง
  updateReceivingItems: async (items, scope = 'mine') => {
    const params = new URLSearchParams();
    if (scope) params.append('scope', scope);
    const response = await apiClient.put(`/orders/receiving?${params.toString()}`, { items });
    return response.data;
  },

  // เพิ่มรายการรับสินค้านอกใบสั่ง
  createManualReceivingItem: async ({ date, product_id, received_quantity, receive_notes }) => {
    const response = await apiClient.post('/orders/receiving/manual-item', {
      date,
      product_id,
      received_quantity,
      receive_notes
    });
    return response.data;
  },

  // Production print (SUP003)
  getProductionPrintItems: async (date, branchId, departmentId) => {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (branchId) params.append('branch_id', branchId);
    if (departmentId) params.append('department_id', departmentId);
    const response = await apiClient.get(`/orders/production/print-items?${params.toString()}`);
    return response.data;
  },
  logProductionPrint: async ({ date, branchId, departmentId }) => {
    const response = await apiClient.post('/orders/production/print-log', {
      date,
      branch_id: branchId,
      department_id: departmentId
    });
    return response.data;
  },

  // สร้างคำสั่งซื้อใหม่
  createOrder: async (items, orderDate) => {
    const response = await apiClient.post('/orders', {
      items,
      order_date: orderDate
    });
    return response.data;
  },

  // แก้ไขคำสั่งซื้อ
  updateOrder: async (id, items) => {
    const response = await apiClient.put(`/orders/${id}`, { items });
    return response.data;
  },

  // ส่งคำสั่งซื้อ
  submitOrder: async (id) => {
    const response = await apiClient.post(`/orders/${id}/submit`);
    return response.data;
  },

  // ลบคำสั่งซื้อ
  deleteOrder: async (id) => {
    const response = await apiClient.delete(`/orders/${id}`);
    return response.data;
  }
};
