import { API_BASE_URL } from './src_config';

let authToken = null;
let onUnauthorized = null;

export function setAuthToken(token) {
  authToken = token;
}

// Called when the API answers 401 on an authenticated request (expired session).
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export function authHeaders(extra = {}) {
  return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : extra;
}

async function request(path, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: authHeaders(options.headers),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && authToken && onUnauthorized) {
      onUnauthorized();
    }
    if (!response.ok) {
      throw new Error(data.detail || `Request failed (${response.status}).`);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('The server took too long to respond.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function jsonPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function checkHealth() {
  return request('/health', {}, 5000);
}

export const login = (username, password) => jsonPost('/api/auth/login', { username, password });
export const register = (username, password) => jsonPost('/api/auth/register', { username, password });

function fileForm(file, language) {
  const form = new FormData();
  form.append('language', language);
  form.append('file', {
    uri: file.uri,
    type: file.mimeType || 'application/octet-stream',
    name: file.fileName || file.name || `upload-${Date.now()}`,
  });
  return form;
}

// asset: an expo-image-picker asset. Returns { scan_id, text, image_url }.
export function scanDocument(asset, language = 'eng') {
  // Do not set Content-Type manually; fetch adds the multipart boundary.
  return request(
    '/api/scan',
    { method: 'POST', body: fileForm({ ...asset, mimeType: asset.mimeType || 'image/jpeg' }, language) },
    120000
  );
}

// file: an expo-document-picker asset. Returns { filename, type, text, chars }.
export function parseFile(file, language = 'eng') {
  return request('/api/parse', { method: 'POST', body: fileForm(file, language) }, 120000);
}

export const deleteScan = (id) => request(`/api/scans/${id}`, { method: 'DELETE' });
export const exportWordDoc = (title, pages) => jsonPost('/api/export-word', { title, pages });
