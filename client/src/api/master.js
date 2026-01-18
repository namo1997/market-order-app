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

    // Suppliers
    getSuppliers: async () => unwrapData(await apiClient.get('/suppliers')),
    createSupplier: async (data) => (await apiClient.post('/suppliers', data)).data,
    updateSupplier: async (id, data) => (await apiClient.put(`/suppliers/${id}`, data)).data,
    deleteSupplier: async (id) => (await apiClient.delete(`/suppliers/${id}`)).data,

    // Branches
    getBranches: async () => unwrapData(await apiClient.get('/branches')),
    createBranch: async (data) => (await apiClient.post('/branches', data)).data,
    updateBranch: async (id, data) => (await apiClient.put(`/branches/${id}`, data)).data,
    deleteBranch: async (id) => (await apiClient.delete(`/branches/${id}`)).data,

    // Departments
    getDepartments: async () => unwrapData(await apiClient.get('/departments')),
    getDepartmentsAll: async () =>
        unwrapData(await apiClient.get('/departments?includeInactive=true')),
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
