const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
const BETA_VERSION_PATTERN = /^(v\d+\.\d+\.\d+)-([0-9a-f]+)$/i;
const RELEASE_TAG_URL_BASE = 'https://github.com/marginaliabible/Marginalia.UI/releases/tag/';

/** Beta builds use `{releaseTag}-{sha7}` (e.g. `v2026.11.00-a1b2c3d`). */
export function isBetaAppVersion(version: string): boolean {
  return BETA_VERSION_PATTERN.test(version.trim());
}

/** Release tag for GitHub links: prod tag as-is, or the tag prefix of a beta version. */
export function getReleaseTagName(version: string): string | null {
  const trimmed = version.trim();
  const betaMatch = trimmed.match(BETA_VERSION_PATTERN);
  if (betaMatch) {
    return betaMatch[1];
  }
  if (RELEASE_TAG_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function getReleaseTagUrl(version: string): string | null {
  const tag = getReleaseTagName(version);
  return tag ? `${RELEASE_TAG_URL_BASE}${tag}` : null;
}
