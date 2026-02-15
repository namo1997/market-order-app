import axios from 'axios';

const resolveApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  const fallback = 'http://localhost:8000/api';

  if (typeof window === 'undefined') {
    return envUrl || fallback;
  }

  if (!envUrl) {
    return `${window.location.protocol}//${window.location.hostname}:8000/api`;
  }

  try {
    const parsed = new URL(envUrl);
    const isLoopbackTarget =
      parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    const isLoopbackPage =
      window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';

    // ถ้าเปิดหน้าเว็บจากเครื่องอื่นใน LAN แต่ env บังคับ loopback ให้สลับไป host เดียวกับหน้าเว็บ
    if (isLoopbackTarget && !isLoopbackPage) {
      return `${window.location.protocol}//${window.location.hostname}:8000/api`;
    }
  } catch (error) {
    // ignore invalid env url and use as-is
  }

  return envUrl;
};

const API_BASE_URL = resolveApiBaseUrl();

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const MAX_GET_RETRIES = 2;
const RETRY_DELAY_MS = 600;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// เพิ่ม token ใน header ทุก request (ถ้ามี)
apiClient.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// จัดการ error response
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    const method = String(config.method || '').toLowerCase();
    const status = error.response?.status;
    const retryCount = Number(config.__retryCount || 0);
    const isNetworkError = !error.response;
    const canRetryGet =
      method === 'get' &&
      retryCount < MAX_GET_RETRIES &&
      (isNetworkError || RETRYABLE_STATUS_CODES.has(status));

    if (canRetryGet) {
      config.__retryCount = retryCount + 1;
      await sleep(RETRY_DELAY_MS * config.__retryCount);
      return apiClient.request(config);
    }

    if (error.response?.status === 401) {
      // Token expired or invalid
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;
