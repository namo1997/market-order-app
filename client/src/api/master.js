import apiClient from './client';

const unwrapData = (response, fallback = []) => {
    if (response?.data?.data !== undefined) return response.data.data;
    if (response?.data !== undefined) return response.data;
    return fallback;
};

export const masterAPI = {
    // Units
    getUnits: async () => unwrapData(await apiClient.get('/units')),
    createUnit: async (data) => (await apiClient.post('/units', data)).data,
    updateUnit: async (id, data) => (await apiClient.put(`/units/${id}`, data)).data,
    deleteUnit: async (id) => (await apiClient.delete(`/units/${id}`)).data,

    // Product Groups (legacy: suppliers)
    getProductGroups: async () => unwrapData(await apiClient.get('/product-groups')),
    createProductGroup: async (data) => (await apiClient.post('/product-groups', data)).data,
    updateProductGroup: async (id, data) => (await apiClient.put(`/product-groups/${id}`, data)).data,
    deleteProductGroup: async (id) => (await apiClient.delete(`/product-groups/${id}`)).data,

    // Backward-compatible aliases
    getSuppliers: async () => masterAPI.getProductGroups(),
    createSupplier: async (data) => masterAPI.createProductGroup(data),
    updateSupplier: async (id, data) => masterAPI.updateProductGroup(id, data),
    deleteSupplier: async (id) => masterAPI.deleteProductGroup(id),

    // Supplier Masters (ผู้ขายจริง)
    getSupplierMasters: async () => unwrapData(await apiClient.get('/supplier-masters')),
    createSupplierMaster: async (data) => (await apiClient.post('/supplier-masters', data)).data,
    updateSupplierMaster: async (id, data) => (await apiClient.put(`/supplier-masters/${id}`, data)).data,
    deleteSupplierMaster: async (id) => (await apiClient.delete(`/supplier-masters/${id}`)).data,

    // Branches
    getBranches: async () => unwrapData(await apiClient.get('/branches')),
    createBranch: async (data) => (await apiClient.post('/branches', data)).data,
    updateBranch: async (id, data) => (await apiClient.put(`/branches/${id}`, data)).data,
    deleteBranch: async (id) => (await apiClient.delete(`/branches/${id}`)).data,
    syncBranchClickhouseIds: async () => (await apiClient.post('/branches/sync-clickhouse')).data,

    // Departments
    getDepartments: async () => unwrapData(await apiClient.get('/departments')),
    getDepartmentsAll: async () =>
        unwrapData(await apiClient.get('/departments?includeInactive=true')),
    getDepartmentsByBranch: async (branchId) => unwrapData(await apiClient.get(`/auth/departments/${branchId}`)),
    createDepartment: async (data) => (await apiClient.post('/departments', data)).data,
    updateDepartment: async (id, data) => (await apiClient.put(`/departments/${id}`, data)).data,
    updateDepartmentStatus: async (id, isActive) =>
        (await apiClient.put(`/departments/${id}/status`, { is_active: isActive })).data,
    deleteDepartment: async (id) => (await apiClient.delete(`/departments/${id}`)).data,

    // Users (Admin)
    getUsers: async () => unwrapData(await apiClient.get('/users')),
    createUser: async (data) => (await apiClient.post('/users', data)).data,
    updateUser: async (id, data) => (await apiClient.put(`/users/${id}`, data)).data,
    deleteUser: async (id) => (await apiClient.delete(`/users/${id}`)).data,
};
