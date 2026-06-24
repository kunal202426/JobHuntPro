import axios from 'axios';

const linkedinClient = axios.create({
  baseURL: import.meta.env.VITE_LINKEDIN_API_URL || 'http://localhost:3001',
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

linkedinClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('jh_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const getLinkedInLeads = (params = {}) =>
  linkedinClient.get('/api/leads', { params }).then((r) => r.data);
