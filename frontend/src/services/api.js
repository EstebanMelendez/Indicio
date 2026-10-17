import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

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
};

export const documentAPI = {
  getAll: (params) => api.get('/documents', { params }),
  upload: (data) => api.post('/documents/upload', data, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
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

export const ragAPI = {
  query: (queryStr, docIds = []) => api.post('/rag/query', { query: queryStr, document_ids: docIds }),
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
