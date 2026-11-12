import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      sessionStorage.removeItem('token');
      // Dispatch a custom event to notify the app to logout
      window.dispatchEvent(new Event('auth-error'));
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
};

export const superadminAPI = {
  getTenants: () => api.get('/superadmin/tenants'),
  createTenant: (data) => api.post('/superadmin/tenants', data),
  addUserToTenant: (tenantId, data) => api.post(`/superadmin/tenants/${tenantId}/users`, data),
  deleteTenant: (tenantId) => api.delete(`/superadmin/tenants/${tenantId}`),
};

export const adminUsersAPI = {
  getUsers: () => api.get('/admin/users'),
  createUser: (data) => api.post('/admin/users', data),
  updateRole: (userId, role) => api.patch(`/admin/users/${userId}/role`, { role }),
  updatePassword: (userId, password) => api.patch(`/admin/users/${userId}/password`, { password }),
  deleteUser: (userId) => api.delete(`/admin/users/${userId}`),
  getEmailConfig: () => api.get('/admin/email-config'),
  updateEmailConfig: (data) => api.put('/admin/email-config', data),
  getTelegramConfig: () => api.get('/admin/telegram-config'),
  updateTelegramConfig: (data) => api.put('/admin/telegram-config', data),
};

export const documentAPI = {
  getAll: (params) => api.get('/documents', { params }),
  getById: (id) => api.get(`/documents/${id}`),
  upload: (data) => api.post('/documents/upload', data, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  update: (id, data) => api.patch(`/documents/${id}`, data),
  confirmVision: (id, data) => api.post(`/documents/${id}/confirm-vision`, data),
  delete: (id) => api.delete(`/documents/${id}`),
  download: (id) => api.get(`/documents/${id}/download`, { responseType: 'blob' }),
};

export const folderAPI = {
  getAll: () => api.get('/folders'),
  create: (name) => api.post('/folders', { name }),
  delete: (id) => api.delete(`/folders/${id}`),
};

export const dashboardAPI = {
  getStats: () => api.get('/dashboard/stats'),
};

export const auditAPI = {
  getLogs: (params) => api.get('/audit/logs', { params }),
};

export const emailAPI = {
  syncInbox: () => api.post('/email/sync-inbox'),
};

export const ragAPI = {
  query: (queryStr, docIds = [], sessionId = 'web-default') =>
    api.post('/rag/query', { query: queryStr, document_ids: docIds, session_id: sessionId }),
};

export const vacancyAPI = {
  getAll: (params) => api.get('/vacancies', { params }),
  getById: (id) => api.get(`/vacancies/${id}`),
  create: (data) => api.post('/vacancies', data),
  update: (id, data) => api.put(`/vacancies/${id}`, data),
  delete: (id) => api.delete(`/vacancies/${id}`),
  matchDocument: (vacancyId, documentId) => api.post(`/vacancies/${vacancyId}/match/${documentId}`),
};

export default api;
