import apiClient from './client';

const unwrap = (response) => response?.data;

export const purchaseOrderAPI = {
  /**
   * ดึงรายการ PO ทั้งหมด
   */
  getAll: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.supplierMasterId) params.append('supplier_master_id', filters.supplierMasterId);
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    if (filters.branchId) params.append('branch_id', filters.branchId);
    if (filters.departmentId) params.append('department_id', filters.departmentId);
    if (filters.limit) params.append('limit', filters.limit);
    const response = await apiClient.get(`/purchase-orders?${params.toString()}`);
    return unwrap(response);
  },

  /**
   * ดึง PO ตาม ID (พร้อม items + receipts)
   */
  getById: async (id) => {
    const response = await apiClient.get(`/purchase-orders/${id}`);
    return unwrap(response);
  },

  /**
   * สร้าง PO ใหม่
   */
  create: async ({ supplierMasterId, poDate, expectedDate, notes, items }) => {
    const response = await apiClient.post('/purchase-orders', {
      supplier_master_id: supplierMasterId,
      po_date: poDate,
      expected_date: expectedDate || null,
      notes: notes || null,
      items
    });
    return unwrap(response);
  },

  /**
   * บันทึกการรับสินค้า
   * items: [{ po_item_id, quantity_received, notes? }]
   */
  receive: async (id, items) => {
    const response = await apiClient.post(`/purchase-orders/${id}/receive`, { items });
    return unwrap(response);
  },

  /**
   * ยกเลิก PO
   */
  cancel: async (id) => {
    const response = await apiClient.put(`/purchase-orders/${id}/cancel`);
    return unwrap(response);
  }
};
