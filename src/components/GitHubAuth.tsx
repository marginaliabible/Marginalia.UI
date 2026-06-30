import { useCallback, useEffect, useMemo, useState } from "react";

const GITHUB_CLIENT_ID = "Ov23liiVOv0EIp9hJAAZ";
const TOKEN_STORAGE_KEY = "gitbible:github-token";
const STATE_STORAGE_KEY = "gitbible:github-oauth-state";
const TARGET_REPO_OWNER = "grinn";
const TARGET_REPO_NAME = "GitBible";

interface RepoProbe {
  status: number;
  visibility?: string;
  fullName?: string;
  message?: string;
}

function createStateNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function clearHashFragment(): void {
  if (typeof window === "undefined") {
    return;
  }
  const cleanUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, "", cleanUrl);
}

function getCallbackUrl(baseUrl: string): string {
  const callback = new URL(baseUrl);
  callback.searchParams.set("origin", window.location.origin);
  return callback.toString();
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err || "Unknown authentication error");
}

export default function GitHubAuth() {
  const callbackBase = (import.meta.env.VITE_GITHUB_OAUTH_CALLBACK_URL || "").trim();

  const [token, setToken] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<RepoProbe | null>(null);

  const isConfigured = callbackBase.length > 0;

  const repoApiUrl = useMemo(
    () => `https://api.github.com/repos/${TARGET_REPO_OWNER}/${TARGET_REPO_NAME}`,
    []
  );

  useEffect(() => {
    const storedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (storedToken) {
      setToken(storedToken);
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
    const expectedState = sessionStorage.getItem(STATE_STORAGE_KEY) || "";

    if (hashError) {
      setStatusMessage(`GitHub sign-in failed: ${hashError}`);
      clearHashFragment();
      return;
    }

    if (!hashToken) {
      return;
    }

    if (!expectedState || returnedState !== expectedState) {
      setStatusMessage("GitHub sign-in failed: state validation mismatch.");
      clearHashFragment();
      return;
    }

    sessionStorage.setItem(TOKEN_STORAGE_KEY, hashToken);
    sessionStorage.removeItem(STATE_STORAGE_KEY);
    setToken(hashToken);
    setStatusMessage("Connected to GitHub.");
    clearHashFragment();
  }, []);

  const handleConnect = useCallback(() => {
    if (!isConfigured) {
      setStatusMessage("Set VITE_GITHUB_OAUTH_CALLBACK_URL before connecting.");
      return;
    }

    setIsConnecting(true);
    setStatusMessage("");

    try {
      const oauthState = createStateNonce();
      sessionStorage.setItem(STATE_STORAGE_KEY, oauthState);

      const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
      authorizeUrl.searchParams.set("client_id", GITHUB_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", getCallbackUrl(callbackBase));
      authorizeUrl.searchParams.set("scope", "repo");
      authorizeUrl.searchParams.set("state", oauthState);

      window.location.assign(authorizeUrl.toString());
    } catch (error) {
      setIsConnecting(false);
      setStatusMessage(`Unable to start GitHub sign-in: ${normalizeError(error)}`);
    }
  }, [callbackBase, isConfigured]);

  const handleDisconnect = useCallback(() => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(STATE_STORAGE_KEY);
    setToken(null);
    setProbeResult(null);
    setStatusMessage("Disconnected from GitHub.");
  }, []);

  const handleProbePrivateRepo = useCallback(async () => {
    if (!token) {
      setStatusMessage("Connect GitHub first.");
      return;
    }

    setIsProbing(true);
    setStatusMessage("");

    try {
      const response = await fetch(repoApiUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `token ${token}`,
        },
      });

      const payload = (await response.json()) as {
        visibility?: string;
        full_name?: string;
        message?: string;
      };

      setProbeResult({
        status: response.status,
        visibility: payload.visibility,
        fullName: payload.full_name,
        message: payload.message,
      });

      if (response.ok) {
        setStatusMessage("Private repo probe succeeded.");
      } else {
        setStatusMessage(`Private repo probe failed with status ${response.status}.`);
      }
    } catch (error) {
      setProbeResult(null);
      setStatusMessage(`Probe failed: ${normalizeError(error)}`);
    } finally {
      setIsProbing(false);
    }
  }, [repoApiUrl, token]);

  return (
    <section className="card border-0 shadow-sm mb-3" aria-label="GitHub authentication">
      <div className="card-body d-flex flex-column gap-3">
        <div>
          <h2 className="h5 mb-1">GitHub Connection</h2>
          <p className="text-body-secondary mb-0">
            Sign in with GitHub to access private repositories from this browser session.
          </p>
        </div>

        {!isConfigured && (
          <div className="alert alert-warning mb-0" role="alert">
            Missing VITE_GITHUB_OAUTH_CALLBACK_URL in the frontend environment.
          </div>
        )}

        <div className="d-flex flex-wrap gap-2 align-items-center">
          {!token && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConnect}
              disabled={isConnecting || !isConfigured}
            >
              Connect GitHub
            </button>
          )}

          {token && (
            <>
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={handleProbePrivateRepo}
                disabled={isProbing}
              >
                {isProbing ? "Probing..." : "Probe Private Repo"}
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={handleDisconnect}
              >
                Disconnect
              </button>
            </>
          )}

          <span className={`badge ${token ? "text-bg-success" : "text-bg-secondary"}`}>
            {token ? "Connected" : "Not Connected"}
          </span>
        </div>

        {statusMessage && (
          <div className="small text-body-secondary">{statusMessage}</div>
        )}

        {probeResult && (
          <div className="small border rounded p-2 bg-body-tertiary">
            <div>Status: {probeResult.status}</div>
            {probeResult.fullName && <div>Repository: {probeResult.fullName}</div>}
            {probeResult.visibility && <div>Visibility: {probeResult.visibility}</div>}
            {probeResult.message && <div>Message: {probeResult.message}</div>}
          </div>
        )}
      </div>
    </section>
  );
}
