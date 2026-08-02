const GITHUB_CLIENT_ID = "Ov23liiVOv0EIp9hJAAZ";
const STATE_STORAGE_KEY = "marginalia:github-oauth-state";
const TOKEN_STORAGE_KEY = "marginalia:github-auth";
const AUTH_BRIDGE_STORAGE_KEY = "marginalia:github-auth-bridge";
const TOKEN_TTL_MS = 1000 * 60 * 60;

interface StoredGitHubAuthSession {
  token: string;
  expiresAt: number;
  grantedAt: number;
}

function createStateNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function getCallbackUrl(baseUrl: string): string {
  const callback = new URL(baseUrl);
  callback.searchParams.set("origin", window.location.origin);
  return callback.toString();
}

function clearHashFragment(): void {
  if (typeof window === "undefined") {
    return;
  }

  const cleanUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, "", cleanUrl);
}

function storeGitHubAuthSession(token: string): StoredGitHubAuthSession {
  const session: StoredGitHubAuthSession = {
    token,
    grantedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };

  sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(session));
  return session;
}

function adoptSessionFromBridgePayload(payloadRaw: string | null): void {
  if (!payloadRaw) {
    return;
  }

  try {
    const parsed = JSON.parse(payloadRaw) as Partial<StoredGitHubAuthSession>;
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number") {
      return;
    }

    if (Date.now() >= parsed.expiresAt) {
      return;
    }

    const nextSession: StoredGitHubAuthSession = {
      token: parsed.token,
      expiresAt: parsed.expiresAt,
      grantedAt: typeof parsed.grantedAt === "number" ? parsed.grantedAt : Date.now(),
    };

    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(nextSession));
  } catch {
    // Ignore malformed bridge payloads.
  }
}

function processOAuthHashIfPresent(): void {
  if (typeof window === "undefined") {
    return;
  }

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) {
    return;
  }

  const params = new URLSearchParams(hash);
  const hashToken = params.get("gh-token");
  const hashError = params.get("gh-error");
  const returnedState = params.get("state") || "";
  const expectedState = sessionStorage.getItem(STATE_STORAGE_KEY) || localStorage.getItem(STATE_STORAGE_KEY) || "";
  const hasAuthPayload = Boolean(hashToken || hashError);

  if (!hasAuthPayload) {
    return;
  }

  const isValidState = expectedState.length > 0 && returnedState === expectedState;

  sessionStorage.removeItem(STATE_STORAGE_KEY);
  localStorage.removeItem(STATE_STORAGE_KEY);

  if (hashToken && isValidState) {
    const nextSession = storeGitHubAuthSession(hashToken);
    try {
      localStorage.setItem(AUTH_BRIDGE_STORAGE_KEY, JSON.stringify(nextSession));
    } catch {
      // Best effort bridge signal for other tabs.
    }
  }

  clearHashFragment();
}

export function initializeGitHubAuthFlow(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  processOAuthHashIfPresent();

  const onStorage = (event: StorageEvent) => {
    if (event.key !== AUTH_BRIDGE_STORAGE_KEY) {
      return;
    }

    adoptSessionFromBridgePayload(event.newValue);
  };

  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
  };
}

export function beginGitHubAuthorization(callbackBase: string): { ok: boolean; message?: string } {
  const trimmed = callbackBase.trim();
  if (!trimmed) {
    return { ok: false, message: "Set VITE_MARGINALIA_AWS_URL before connecting." };
  }

  try {
    const oauthState = createStateNonce();
    sessionStorage.setItem(STATE_STORAGE_KEY, oauthState);
    localStorage.setItem(STATE_STORAGE_KEY, oauthState);

    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", GITHUB_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", getCallbackUrl(trimmed));
    authorizeUrl.searchParams.set("scope", "repo");
    authorizeUrl.searchParams.set("state", oauthState);

    window.location.assign(authorizeUrl.toString());

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown authentication error");
    return { ok: false, message: `Unable to start GitHub sign-in: ${message}` };
  }
}
