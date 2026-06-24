import axios from "axios";

const client = axios.create({
  baseURL: import.meta.env.VITE_LINKEDIN_API_URL || "http://localhost:3001",
  timeout: 15000,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('jh_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;
