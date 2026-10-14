import apiClient from './client';

const unwrapData = (response, fallback = []) => {
  if (response?.data?.data !== undefined) return response.data.data;
  if (response?.data !== undefined) return response.data;
  return fallback;
};

export const recipesAPI = {
  searchMenus: async (search, limit = 20) => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (limit) params.append('limit', String(limit));
    const response = await apiClient.get(`/recipes/menus?${params.toString()}`);
    return unwrapData(response);
  },
  getRecipes: async () => {
    const response = await apiClient.get('/recipes');
    return unwrapData(response);
  },
  getRecipeById: async (id) => {
    const response = await apiClient.get(`/recipes/${id}`);
    return response.data;
  },
  createRecipe: async (payload) => {
    const response = await apiClient.post('/recipes', payload);
    return response.data;
  },
  deleteRecipe: async (id) => {
    const response = await apiClient.delete(`/recipes/${id}`);
    return response.data;
  },
  addRecipeItem: async (recipeId, payload) => {
    const response = await apiClient.post(`/recipes/${recipeId}/items`, payload);
    return response.data;
  },
  updateRecipeItem: async (itemId, payload) => {
    const response = await apiClient.put(`/recipes/items/${itemId}`, payload);
    return response.data;
  },
  deleteRecipeItem: async (itemId) => {
    const response = await apiClient.delete(`/recipes/items/${itemId}`);
    return response.data;
  },
  getUsageReport: async ({ start, end, branchId }) => {
    const params = new URLSearchParams();
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    if (branchId) params.append('branch_id', branchId);
    const response = await apiClient.get(`/recipes/usage?${params.toString()}`);
    return response.data;
  },
  syncUsageToInventory: async ({ start, end, branchId, dryRun = false }) => {
    const payload = {
      start,
      end
    };
    if (branchId) payload.branch_id = branchId;
    if (dryRun) payload.dry_run = true;
    const response = await apiClient.post('/recipes/usage/sync', payload);
    return response.data;
  }
};
