import type {
  HelpManifest,
  HelpSearchIndex,
  HelpTourDefinition,
} from '../models/help';
import { buildFetchUrlCandidates } from '../utils/resourceLibraryConfig';
import {
  parseHelpManifest,
  parseHelpSearchIndex,
  parseHelpTourDefinition,
} from './helpContentParsers';

export {
  parseHelpManifest,
  parseHelpSearchIndex,
  parseHelpTourDefinition,
} from './helpContentParsers';

const DEFAULT_HELP_CONTENT_URL =
  'https://raw.githubusercontent.com/marginaliabible/Marginalia.Help/main/';

function readHelpContentBaseUrl(): string {
  const configured = (import.meta.env['VITE_HELP_CONTENT_URL'] || '').trim();
  if (configured) {
    return configured.endsWith('/') ? configured : `${configured}/`;
  }
  // Local Vite middleware serves the sibling Marginalia.Help repo.
  if (import.meta.env.DEV) {
    return '/help-content/';
  }
  return DEFAULT_HELP_CONTENT_URL;
}

function joinHelpUrl(baseUrl: string, relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+/, '');
  return `${baseUrl}${trimmed}`;
}

async function fetchTextFromHelp(relativePath: string): Promise<string> {
  const absolute = joinHelpUrl(readHelpContentBaseUrl(), relativePath);
  let lastStatus = 0;

  for (const candidate of buildFetchUrlCandidates(absolute)) {
    const response = await fetch(candidate, { cache: 'no-store' });
    if (response.ok) {
      return await response.text();
    }
    lastStatus = response.status;
  }

  throw new Error(`Help content ${relativePath} responded with ${lastStatus || 404}`);
}

async function fetchJsonFromHelp<T>(relativePath: string): Promise<T> {
  const text = await fetchTextFromHelp(relativePath);
  return JSON.parse(text) as T;
}

class HelpContentService {
  private manifestPromise: Promise<HelpManifest> | null = null;
  private searchIndexPromise: Promise<HelpSearchIndex> | null = null;
  private readonly articleCache = new Map<string, Promise<string>>();
  private readonly tourCache = new Map<string, Promise<HelpTourDefinition>>();

  getContentBaseUrl(): string {
    return readHelpContentBaseUrl();
  }

  /** Drop in-memory caches so the next fetch picks up updated Help repo files. */
  clearCache(): void {
    this.manifestPromise = null;
    this.searchIndexPromise = null;
    this.articleCache.clear();
    this.tourCache.clear();
  }

  async getManifest(forceRefresh = false): Promise<HelpManifest> {
    if (!this.manifestPromise || forceRefresh) {
      this.manifestPromise = fetchJsonFromHelp<unknown>('manifest.json')
        .then(parseHelpManifest)
        .catch((error) => {
          this.manifestPromise = null;
          throw error;
        });
    }
    return this.manifestPromise;
  }

  async getSearchIndex(forceRefresh = false): Promise<HelpSearchIndex> {
    if (!this.searchIndexPromise || forceRefresh) {
      this.searchIndexPromise = fetchJsonFromHelp<unknown>('search-index.json')
        .then(parseHelpSearchIndex)
        .catch((error) => {
          this.searchIndexPromise = null;
          throw error;
        });
    }
    return this.searchIndexPromise;
  }

  async getArticleMarkdown(path: string): Promise<string> {
    const key = path.trim();
    let pending = this.articleCache.get(key);
    if (!pending) {
      pending = fetchTextFromHelp(key).catch((error) => {
        this.articleCache.delete(key);
        throw error;
      });
      this.articleCache.set(key, pending);
    }
    return pending;
  }

  async getTour(tourId: string): Promise<HelpTourDefinition> {
    const manifest = await this.getManifest();
    const meta = manifest.tours.find((tour) => tour.id === tourId);
    if (!meta) {
      throw new Error(`Unknown help tour: ${tourId}`);
    }

    let pending = this.tourCache.get(meta.path);
    if (!pending) {
      pending = fetchJsonFromHelp<unknown>(meta.path)
        .then(parseHelpTourDefinition)
        .catch((error) => {
          this.tourCache.delete(meta.path);
          throw error;
        });
      this.tourCache.set(meta.path, pending);
    }
    return pending;
  }
}

export const helpContentService = new HelpContentService();
