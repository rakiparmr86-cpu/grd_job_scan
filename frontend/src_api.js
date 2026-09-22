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
  const method = options.method || 'GET';
  const startedAt = Date.now();
  // These logs print in the Metro terminal (the "Frontend: Start Expo" task
  // in VS Code), not on the phone screen, so you can watch requests live.
  console.log(`[api] -> ${method} ${path}`);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: authHeaders(options.headers),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    const ms = Date.now() - startedAt;
    console.log(`[api] <- ${method} ${path} ${response.status} (${ms}ms)`);
    if (response.status === 401 && authToken && onUnauthorized) {
      onUnauthorized();
    }
    if (!response.ok) {
      console.log(`[api] error detail: ${data.detail || '(no detail)'}`);
      throw new Error(data.detail || `Request failed (${response.status}).`);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`[api] xx ${method} ${path} timed out after ${timeoutMs}ms`);
      throw new Error('The server took too long to respond.');
    }
    console.log(`[api] xx ${method} ${path} failed: ${error.message}`);
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

async function fileForm(file, language) {
  const form = new FormData();
  form.append('language', language);

  // On web, expo-image-picker / expo-document-picker give a real browser File
  // in `file.file`; fetch's FormData needs that Blob/File directly, not the
  // {uri, type, name} descriptor React Native's native FormData accepts.
  if (file.file) {
    form.append('file', file.file, file.fileName || file.name || file.file.name);
  } else if (typeof file.uri === 'string' && /^(blob|data):/.test(file.uri)) {
    // Web only: expo-image-manipulator (crop) output has no `.file`, just a
    // blob:/data: URI. Fetching it in-page gives back the real Blob to upload.
    const blob = await fetch(file.uri).then((r) => r.blob());
    form.append('file', blob, file.fileName || file.name || `upload-${Date.now()}.jpg`);
  } else {
    form.append('file', {
      uri: file.uri,
      type: file.mimeType || 'application/octet-stream',
      name: file.fileName || file.name || `upload-${Date.now()}`,
    });
  }
  return form;
}

// asset: an expo-image-picker asset. Returns { scan_id, text, image_url }.
export async function scanDocument(asset, language = 'eng') {
  // Do not set Content-Type manually; fetch adds the multipart boundary.
  const body = await fileForm({ ...asset, mimeType: asset.mimeType || 'image/jpeg' }, language);
  return request('/api/scan', { method: 'POST', body }, 120000);
}

// file: an expo-document-picker asset. Returns { filename, type, text, chars }.
export async function parseFile(file, language = 'eng') {
  const body = await fileForm(file, language);
  return request('/api/parse', { method: 'POST', body }, 120000);
}

export const deleteScan = (id) => request(`/api/scans/${id}`, { method: 'DELETE' });

// format: 'word' | 'pdf'. Returns { export_id, filename, format, download_url }.
export const exportDocument = (title, pages, format = 'word') =>
  jsonPost('/api/export', { title, pages, format });
