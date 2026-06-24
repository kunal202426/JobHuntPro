import axios from 'axios';

const client = axios.create({
  baseURL: import.meta.env.VITE_COLD_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('jh_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;

// ── Leads ────────────────────────────────────────────────────────────────────
export const checkDuplicate = (email) =>
  client.get('/api/leads/check', { params: { email } }).then((r) => r.data);

export const addLead = (data) =>
  client.post('/api/leads', data).then((r) => r.data);

export const getLeads = (params = {}) =>
  client.get('/api/leads', { params }).then((r) => r.data);

export const getLead = (id) =>
  client.get(`/api/leads/${id}`).then((r) => r.data);

export const updateLeadStatus = (id, status) =>
  client.patch(`/api/leads/${id}/status`, { status }).then((r) => r.data);

export const approveDraft = (id) =>
  client.post(`/api/leads/${id}/approve`).then((r) => r.data);

export const deleteLead = (id) =>
  client.delete(`/api/leads/${id}`).then((r) => r.data);

// ── Quota / Stats ─────────────────────────────────────────────────────────────
export const getQuota = () =>
  client.get('/api/quota/today').then((r) => r.data);

export const getStats = () =>
  client.get('/api/stats').then((r) => r.data);

export const processQueue = () =>
  client.post('/api/queue/process').then((r) => r.data);

// ── CSV bulk upload ───────────────────────────────────────────────────────────
export const csvPreview = (file) => {
  const form = new FormData();
  form.append('file', file);
  return client
    .post('/api/leads/csv-preview', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    })
    .then((r) => r.data);
};

export const bulkSubmit = (leads) =>
  client.post('/api/leads/bulk', { leads }).then((r) => r.data);

export const generatePreview = (data) =>
  client.post('/api/leads/generate-preview', data, { timeout: 60000 }).then((r) => r.data);
