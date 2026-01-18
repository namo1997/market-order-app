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
