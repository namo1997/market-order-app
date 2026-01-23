import apiClient from './client';

export const aiAPI = {
  chatSalesReport: async ({ question, report }) => {
    const response = await apiClient.post('/ai/sales-report', {
      question,
      report
    });
    return response.data?.data ?? response.data;
  }
};
