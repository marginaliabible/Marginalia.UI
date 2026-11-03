export function getAppVersion(): string {
  return (import.meta.env['VITE_APP_VERSION'] || '').trim() || 'dev';
}

export function getAppGitSha(): string {
  return (import.meta.env['VITE_APP_GIT_SHA'] || '').trim();
}
