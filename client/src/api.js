import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('opsdesk_token') || localStorage.getItem('caseflow_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !window.location.pathname.startsWith('/auth')) {
      localStorage.removeItem('opsdesk_token');
      localStorage.removeItem('opsdesk_user');
      localStorage.removeItem('caseflow_token');
      localStorage.removeItem('caseflow_user');
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);

export default api;
