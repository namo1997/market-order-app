import apiClient from './client';

const unwrap = (response) => response?.data;

export const generalPurchaseAuthAPI = {
  exchangeEmployeeToken: async (token) => {
    const response = await apiClient.post(
      '/general-purchase-auth/employee/exchange',
      { token },
      { skipAuthRedirect: true }
    );
    return unwrap(response);
  },

  loginReadonlyPin: async (pin) => {
    const response = await apiClient.post('/general-purchase-auth/pin', { pin });
    return unwrap(response);
  }
};
