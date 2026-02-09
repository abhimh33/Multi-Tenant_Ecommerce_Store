import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // Only redirect if not already on auth pages
      if (!window.location.pathname.startsWith('/login') &&
          !window.location.pathname.startsWith('/register')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ─── Auth API ────────────────────────────────────────────────────────────────

export const authApi = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
};

// ─── Stores API ──────────────────────────────────────────────────────────────

export const storesApi = {
  list: (params) => api.get('/stores', { params }),
  get: (id) => api.get(`/stores/${id}`),
  create: (data) => api.post('/stores', data),
  delete: (id) => api.delete(`/stores/${id}`),
  retry: (id) => api.post(`/stores/${id}/retry`),
  getLogs: (id, params) => api.get(`/stores/${id}/logs`, { params }),
};

// ─── Audit API ───────────────────────────────────────────────────────────────

export const auditApi = {
  list: (params) => api.get('/audit', { params }),
};

// ─── Health API ──────────────────────────────────────────────────────────────

export const healthApi = {
  check: () => api.get('/health'),
};

export default api;
