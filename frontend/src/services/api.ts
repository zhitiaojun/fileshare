import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// Turnstile token management
let turnstileToken = '';
export function setTurnstileToken(token: string) { turnstileToken = token; }
export function getTurnstileToken(): string { return turnstileToken; }
export function clearTurnstileToken() { turnstileToken = ''; }

// Request interceptor: attach Turnstile token
api.interceptors.request.use((config) => {
  if (turnstileToken) {
    config.headers['X-Turnstile-Token'] = turnstileToken;
  }
  return config;
});

// Response interceptor
api.interceptors.response.use(
  (response) => {
    const data = response.data;
    if (data.code !== 200) {
      throw new Error(data.message || data.msg || 'Unknown error');
    }
    return data.detail;
  },
  (error) => {
    if (error.response?.data?.message) {
      throw new Error(error.response.data.message);
    }
    throw error;
  }
);

// Admin token handling
let adminToken = localStorage.getItem('admin_token') || '';

export function setAdminToken(token: string) {
  adminToken = token;
  localStorage.setItem('admin_token', token);
}

export function getAdminToken(): string {
  return adminToken;
}

export function clearAdminToken() {
  adminToken = '';
  localStorage.removeItem('admin_token');
}

// API methods
export const shareAPI = {
  /** Upload text */
  uploadText(data: FormData) {
    return api.post('/share/text', data);
  },
  /** Upload file */
  uploadFile(formData: FormData) {
    return api.post('/share/file', formData);
  },
  /** Upload file with progress callback */
  uploadFileWithProgress(formData: FormData, onProgress: (pct: number, loaded: number, total: number) => void) {
    return api.post('/share/file', formData, {
      onUploadProgress: (e) => {
        if (e.total) onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
      },
      timeout: 600000, // 10 min for large files
    });
  },
  /** Get file metadata */
  getMetadata(code: string) {
    return api.get('/share/metadata', { params: { code } });
  },
  /** Download/decode file */
  select(code: string) {
    return api.get('/share/select', { params: { code } });
  },
  /** Download as ZIP */
  downloadAll(code: string) {
    return api.get('/share/download-all', {
      params: { code },
      responseType: 'blob',
    });
  },
};

export const adminAPI = {
  login(password: string) {
    return api.post('/admin/login', { password }).then((data: any) => {
      setAdminToken(data.token);
      return data;
    });
  },
  verify() {
    return api.get('/admin/verify', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },
  dashboard() {
    return api.get('/admin/dashboard', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },
  listFiles(params: Record<string, string | number>) {
    return api.get('/admin/files', {
      params,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },
  deleteFile(id: number) {
    return api.delete(`/admin/files/${id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },
  batchDelete(ids: number[]) {
    return api.post('/admin/files/batch-delete', { ids }, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },
  policyAction(id: number, action: string, downloadLimit?: number) {
    return api.patch('/admin/file/policy-action', { id, action, downloadLimit }, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },
  getConfig() {
    return api.get('/admin/config', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },
  updateConfig(data: Record<string, string>) {
    return api.patch('/admin/config', data, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  },
};

export const publicAPI = {
  getConfig() {
    return api.get('/v1/config');
  },
  getStats() {
    return api.get('/stats');
  },
};

export default api;
