const PDF_PROXY_PATH = "/pdf-proxy";

function normalizeProxyBase(raw: string): URL | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

function buildProxyEndpoint(base: URL): URL {
  const endpoint = new URL(base.toString());
  const normalizedPath = endpoint.pathname.replace(/\/+$/, "");
  endpoint.pathname = `${normalizedPath}${PDF_PROXY_PATH}`;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

export function buildPdfProxyUrl(resourceUrl: string): string | null {
  const source = resourceUrl.trim();
  if (!source) {
    return null;
  }

  const proxyBase = normalizeProxyBase(import.meta.env.VITE_GITBIBLE_AWS_URL || "");

  if (!proxyBase) {
    return null;
  }

  const endpoint = buildProxyEndpoint(proxyBase);
  const upstreamUrl = new URL(source, typeof window !== "undefined" ? window.location.href : undefined);
  upstreamUrl.hash = "";
  endpoint.searchParams.set("url", upstreamUrl.toString());

  return endpoint.toString();
}
