function normalizeUrl(value: string): string {
  return value.replace(/\/$/, '');
}

function getDefaultApiUrl(): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${host}:3001/api`;
}

function deriveWsUrl(apiUrl: string): string {
  return apiUrl.replace(/^http/, 'ws').replace(/\/api$/, '');
}

const apiUrl = import.meta.env.VITE_API_URL?.trim() || getDefaultApiUrl();
const wsUrl = import.meta.env.VITE_WS_URL?.trim() || deriveWsUrl(apiUrl);

export const API_URL = normalizeUrl(apiUrl);
export const WS_URL = normalizeUrl(wsUrl);