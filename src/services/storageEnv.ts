export function getAuthServiceUrl(): string {
  return (import.meta.env['VITE_AUTH_SERVICE_URL'] || '').trim().replace(/\/$/, '');
}

export function getConfiguredStorageBaseUrl(): string {
  return (import.meta.env['VITE_STORAGE_PUBLIC_BASE_URL'] || '').trim().replace(/\/$/, '');
}

export function getDocumentRenderEpochOverride(): string {
  return (import.meta.env['VITE_DOCUMENT_RENDER_EPOCH'] || '').trim();
}
