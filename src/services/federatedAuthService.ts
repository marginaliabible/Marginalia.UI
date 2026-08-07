import type { FederatedProvider } from '../models/bible';

const SESSIONS_STORAGE_KEY = 'marginalia:federated-auth:sessions';
const PENDING_STORAGE_KEY = 'marginalia:federated-auth:pending';

interface PendingAuthRequest {
  provider: FederatedProvider;
  state: string;
  codeVerifier: string;
  createdAt: number;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string;
}

interface MicrosoftTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string;
}

interface GoogleProfileResponse {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

interface MicrosoftProfileResponse {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
}

interface OAuthErrorPayload {
  error?: string;
  error_description?: string;
}

class FederatedTokenRefreshError extends Error {
  provider: FederatedProvider;
  status: number;
  responseBody: string;
  oauthError?: string;
  oauthErrorDescription?: string;

  constructor(provider: FederatedProvider, status: number, responseBody: string, payload?: OAuthErrorPayload) {
    super(`${provider === 'google' ? 'Google' : 'Microsoft'} token refresh failed via broker (${status}): ${responseBody}`);
    this.name = 'FederatedTokenRefreshError';
    this.provider = provider;
    this.status = status;
    this.responseBody = responseBody;
    this.oauthError = payload?.error;
    this.oauthErrorDescription = payload?.error_description;
  }
}

export interface FederatedAccountProfile {
  providerAccountId: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

export interface FederatedSession {
  provider: FederatedProvider;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  grantedAt: number;
  scope?: string;
  profile: FederatedAccountProfile;
}

interface StoredFederatedSessions {
  google?: FederatedSession;
  microsoft?: FederatedSession;
}

export interface OAuthCallbackResult {
  handled: boolean;
  provider?: FederatedProvider;
  session?: FederatedSession;
  error?: string;
}

function readClientId(provider: FederatedProvider): string {
  if (provider === 'google') {
    return (import.meta.env['VITE_GOOGLE_CLIENT_ID'] || '').trim();
  }

  return (import.meta.env['VITE_MICROSOFT_CLIENT_ID'] || '').trim();
}

function readAwsLambdaBaseUrl(): string {
  return (import.meta.env['VITE_AUTH_SERVICE_URL'] || '').trim();
}

function getRedirectUri(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return `${window.location.origin}${window.location.pathname}`;
}

function readJsonStorage<T>(storageKey: string): T | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonStorage<T>(storageKey: string, payload: T): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(payload));
}

function readPendingRequestMap(): Record<string, PendingAuthRequest> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, PendingAuthRequest>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePendingRequestMap(map: Record<string, PendingAuthRequest>): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(map));
}

function removePendingRequest(state: string): PendingAuthRequest | null {
  const map = readPendingRequestMap();
  const found = map[state] ?? null;
  if (!found) {
    return null;
  }

  delete map[state];
  writePendingRequestMap(map);
  return found;
}

function createRandomHex(length = 32): string {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('').slice(0, length);
}

function base64UrlEncode(bytes: Uint8Array): string {
  const asString = String.fromCharCode(...bytes);
  const base64 = window.btoa(asString);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function clearOAuthQueryParams(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  const paramsToStrip = ['code', 'state', 'error', 'error_description', 'session_state'];
  let changed = false;

  for (const name of paramsToStrip) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  const query = url.searchParams.toString();
  const nextUrl = `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
  window.history.replaceState(null, '', nextUrl);
}

function buildTokenExchangeEndpoint(baseUrl: string): string {
  const endpoint = new URL(baseUrl);
  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  endpoint.pathname = `${normalizedPath}/oauth/token-exchange`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

function buildTokenRefreshEndpoint(baseUrl: string): string {
  const endpoint = new URL(baseUrl);
  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  endpoint.pathname = `${normalizedPath}/oauth/token-refresh`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

function tryParseOAuthErrorPayload(value: string): OAuthErrorPayload | null {
  try {
    const parsed = JSON.parse(value) as OAuthErrorPayload;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function shouldRemoveSessionAfterRefreshFailure(error: unknown): boolean {
  if (!(error instanceof FederatedTokenRefreshError)) {
    return false;
  }

  const oauthError = (error.oauthError || '').toLowerCase();
  const oauthDescription = (error.oauthErrorDescription || '').toLowerCase();

  if (oauthError === 'invalid_grant' || oauthError === 'invalid_request') {
    return true;
  }

  if (oauthDescription.includes('must sign in again') || oauthDescription.includes('grant is expired')) {
    return true;
  }

  return error.status === 400 && oauthDescription.includes('interaction_required');
}

function isSessionShape(value: unknown): value is FederatedSession {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const session = value as Partial<FederatedSession>;
  return (
    (session.provider === 'google' || session.provider === 'microsoft')
    && typeof session.accessToken === 'string'
    && typeof session.expiresAt === 'number'
    && typeof session.grantedAt === 'number'
    && Boolean(session.profile)
    && typeof session.profile?.providerAccountId === 'string'
  );
}

function isSessionExpiringSoon(session: FederatedSession, skewMs = 2 * 60 * 1000): boolean {
  return Date.now() + skewMs >= session.expiresAt;
}

function readStoredSessions(): StoredFederatedSessions {
  const parsed = readJsonStorage<StoredFederatedSessions>(SESSIONS_STORAGE_KEY);
  if (!parsed) {
    return {};
  }

  const filtered: StoredFederatedSessions = {};

  for (const provider of ['google', 'microsoft'] as const) {
    const session = parsed[provider];
    if (!isSessionShape(session)) {
      continue;
    }

    if (typeof session.refreshToken === 'string' && session.refreshToken.trim().length === 0) {
      delete session.refreshToken;
    }

    if (Date.now() >= session.expiresAt && !session.refreshToken) {
      continue;
    }

    filtered[provider] = session;
  }

  return filtered;
}

function writeStoredSessions(sessions: StoredFederatedSessions): void {
  writeJsonStorage(SESSIONS_STORAGE_KEY, sessions);
}

async function fetchGoogleProfile(accessToken: string): Promise<FederatedAccountProfile> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google profile request failed (${response.status}).`);
  }

  const payload = (await response.json()) as GoogleProfileResponse;
  if (!payload.sub) {
    throw new Error('Google profile payload was missing a subject identifier.');
  }

  return {
    providerAccountId: payload.sub,
    displayName: payload.name,
    email: payload.email,
    avatarUrl: payload.picture,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to read avatar image.'));
      }
    };
    reader.onerror = () => reject(new Error('Unable to read avatar image.'));
    reader.readAsDataURL(blob);
  });
}

async function fetchMicrosoftProfile(accessToken: string): Promise<FederatedAccountProfile> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Microsoft profile request failed (${response.status}).`);
  }

  const payload = (await response.json()) as MicrosoftProfileResponse;
  if (!payload.id) {
    throw new Error('Microsoft profile payload was missing an account identifier.');
  }

  let avatarUrl: string | undefined;
  try {
    const avatarResponse = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (avatarResponse.ok) {
      avatarUrl = await blobToDataUrl(await avatarResponse.blob());
    }
  } catch {
    // Avatar is optional; leave undefined.
  }

  return {
    providerAccountId: payload.id,
    displayName: payload.displayName,
    email: payload.mail || payload.userPrincipalName,
    avatarUrl,
  };
}

function buildGoogleAuthorizeUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email https://www.googleapis.com/auth/drive.appdata');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'select_account consent');
  return url.toString();
}

function buildMicrosoftAuthorizeUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email offline_access Files.ReadWrite.AppFolder User.Read');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const lambdaBaseUrl = readAwsLambdaBaseUrl();
  if (!lambdaBaseUrl) {
    throw new Error('Set VITE_AUTH_SERVICE_URL for brokered token exchange before signing in.');
  }

  const endpoint = buildTokenExchangeEndpoint(lambdaBaseUrl);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'google',
      code,
      codeVerifier,
      redirectUri,
      clientId,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed via broker (${response.status}): ${text}`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

async function exchangeMicrosoftCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string
): Promise<MicrosoftTokenResponse> {
  const lambdaBaseUrl = readAwsLambdaBaseUrl();
  if (!lambdaBaseUrl) {
    throw new Error('Set VITE_AUTH_SERVICE_URL for brokered token exchange before signing in.');
  }

  const endpoint = buildTokenExchangeEndpoint(lambdaBaseUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'microsoft',
      code,
      codeVerifier,
      redirectUri,
      origin: typeof window !== 'undefined' ? window.location.origin : undefined,
      clientId,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft token exchange failed via broker (${response.status}): ${text}`);
  }

  return (await response.json()) as MicrosoftTokenResponse;
}

async function refreshProviderToken(
  provider: FederatedProvider,
  refreshToken: string,
  clientId: string
): Promise<GoogleTokenResponse | MicrosoftTokenResponse> {
  const lambdaBaseUrl = readAwsLambdaBaseUrl();
  if (!lambdaBaseUrl) {
    throw new Error('Set VITE_AUTH_SERVICE_URL for brokered token refresh before continuing.');
  }

  const endpoint = buildTokenRefreshEndpoint(lambdaBaseUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider,
      refreshToken,
      origin: provider === 'microsoft' && typeof window !== 'undefined' ? window.location.origin : undefined,
      clientId,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const payload = tryParseOAuthErrorPayload(text);
    throw new FederatedTokenRefreshError(provider, response.status, text, payload || undefined);
  }

  return (await response.json()) as GoogleTokenResponse | MicrosoftTokenResponse;
}

export function getStoredFederatedSessions(): StoredFederatedSessions {
  const sessions = readStoredSessions();
  writeStoredSessions(sessions);
  return sessions;
}

export async function getFreshFederatedSessions(): Promise<StoredFederatedSessions> {
  const sessions = readStoredSessions();
  let changed = false;

  for (const provider of ['google', 'microsoft'] as const) {
    const existing = sessions[provider];
    if (!existing) {
      continue;
    }

    if (!isSessionExpiringSoon(existing)) {
      continue;
    }

    if (!existing.refreshToken) {
      delete sessions[provider];
      changed = true;
      continue;
    }

    try {
      const refreshed = await refreshProviderToken(provider, existing.refreshToken, readClientId(provider));
      const now = Date.now();

      sessions[provider] = {
        ...existing,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || existing.refreshToken,
        grantedAt: now,
        expiresAt: now + Math.max(300, refreshed.expires_in) * 1000,
        scope: refreshed.scope || existing.scope,
      };
      changed = true;
    } catch (error) {
      if (shouldRemoveSessionAfterRefreshFailure(error)) {
        delete sessions[provider];
        changed = true;
      }

      // If refresh fails transiently, keep existing token until caller attempts API usage.
    }
  }

  if (changed) {
    writeStoredSessions(sessions);
  }

  return sessions;
}

export function getMostRecentlyGrantedSession(sessions: StoredFederatedSessions): FederatedSession | null {
  const values = [sessions.google, sessions.microsoft].filter((entry): entry is FederatedSession => Boolean(entry));
  if (values.length === 0) {
    return null;
  }

  values.sort((left, right) => right.grantedAt - left.grantedAt);
  return values[0];
}

export function removeStoredFederatedSession(provider: FederatedProvider): StoredFederatedSessions {
  const sessions = readStoredSessions();
  delete sessions[provider];
  writeStoredSessions(sessions);
  return sessions;
}

export async function beginFederatedAuthorization(provider: FederatedProvider): Promise<void> {
  const clientId = readClientId(provider);
  if (!clientId) {
    const envVar = provider === 'google' ? 'VITE_GOOGLE_CLIENT_ID' : 'VITE_MICROSOFT_CLIENT_ID';
    throw new Error(`Missing ${envVar} in your frontend environment.`);
  }

  if (!readAwsLambdaBaseUrl()) {
    throw new Error('Missing VITE_AUTH_SERVICE_URL. Federated sign-in requires Lambda token exchange.');
  }

  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('This browser does not support secure PKCE authentication.');
  }

  const state = createRandomHex(40);
  const codeVerifier = createRandomHex(64);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const redirectUri = getRedirectUri();

  const pendingRequest: PendingAuthRequest = {
    provider,
    state,
    codeVerifier,
    createdAt: Date.now(),
  };

  const map = readPendingRequestMap();
  map[state] = pendingRequest;
  writePendingRequestMap(map);

  const authorizeUrl = provider === 'google'
    ? buildGoogleAuthorizeUrl(clientId, redirectUri, state, codeChallenge)
    : buildMicrosoftAuthorizeUrl(clientId, redirectUri, state, codeChallenge);

  window.location.assign(authorizeUrl);
}

export async function completeFederatedAuthorizationFromUrl(): Promise<OAuthCallbackResult> {
  if (typeof window === 'undefined') {
    return { handled: false };
  }

  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (!code && !error) {
    return { handled: false };
  }

  if (!state) {
    clearOAuthQueryParams();
    return { handled: true, error: 'OAuth callback was missing state.' };
  }

  const pending = removePendingRequest(state);
  if (!pending) {
    clearOAuthQueryParams();
    return { handled: true, error: 'OAuth callback state validation failed.' };
  }

  if (error) {
    clearOAuthQueryParams();
    return {
      handled: true,
      provider: pending.provider,
      error: errorDescription || error,
    };
  }

  if (!code) {
    clearOAuthQueryParams();
    return {
      handled: true,
      provider: pending.provider,
      error: 'OAuth callback did not include an authorization code.',
    };
  }

  try {
    const redirectUri = getRedirectUri();
    const clientId = readClientId(pending.provider);

    if (!clientId) {
      throw new Error('Client ID is not configured for this provider.');
    }

    const tokenPayload = pending.provider === 'google'
      ? await exchangeGoogleCode(code, pending.codeVerifier, clientId, redirectUri)
      : await exchangeMicrosoftCode(code, pending.codeVerifier, clientId, redirectUri);

    const profile = pending.provider === 'google'
      ? await fetchGoogleProfile(tokenPayload.access_token)
      : await fetchMicrosoftProfile(tokenPayload.access_token);

    const now = Date.now();
    const session: FederatedSession = {
      provider: pending.provider,
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      grantedAt: now,
      expiresAt: now + Math.max(300, tokenPayload.expires_in) * 1000,
      scope: tokenPayload.scope,
      profile,
    };

    const sessions = readStoredSessions();
    sessions[pending.provider] = session;
    writeStoredSessions(sessions);

    clearOAuthQueryParams();

    return {
      handled: true,
      provider: pending.provider,
      session,
    };
  } catch (callbackError) {
    clearOAuthQueryParams();
    const message = callbackError instanceof Error ? callbackError.message : String(callbackError);
    return {
      handled: true,
      provider: pending.provider,
      error: message,
    };
  }
}
