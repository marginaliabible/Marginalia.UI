// Shared helpers for parsing resource library config.json files and building document URLs.
// Used by resourceLibraryService.ts (verse lookups) and resourceLibrarySearchService.ts (title search),
// which otherwise resolve the same { source: { baseUrl, documentUrlTemplate } } config shape independently.

export const DEFAULT_DOCUMENT_URL_TEMPLATE = '{baseUrl}/documents/{documentId}?page={page}';

export interface ResourceSourceConfigLike {
  baseUrl?: unknown;
  documentUrlTemplate?: unknown;
}

export interface ResourceLibraryConfigLike {
  source?: unknown;
  baseUrl?: unknown;
  documentUrlTemplate?: unknown;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeBaseUrl(value: string | undefined, fallbackFromConfigUrl: string): string {
  const fromValue = readString(value);
  if (fromValue) {
    try {
      return new URL(fromValue).toString().replace(/\/$/, '');
    } catch {
      try {
        return new URL(fromValue, fallbackFromConfigUrl).toString().replace(/\/$/, '');
      } catch {
        // Fall back below.
      }
    }
  }

  return fallbackFromConfigUrl.replace(/\/$/, '');
}

// Resolves { baseUrl, documentUrlTemplate } from a config payload, preferring config.source over top-level fields.
export function readResourceLibraryConnection(
  config: ResourceLibraryConfigLike,
  configUrl: string
): { baseUrl: string; documentUrlTemplate: string } {
  const sourceConfig = isPlainObject(config.source) ? config.source as ResourceSourceConfigLike : undefined;
  const configFolderUrl = new URL('.', configUrl).toString();
  const baseUrl = normalizeBaseUrl(readString(sourceConfig?.baseUrl) ?? readString(config.baseUrl), configFolderUrl);
  const documentUrlTemplate =
    readString(sourceConfig?.documentUrlTemplate)
    ?? readString(config.documentUrlTemplate)
    ?? DEFAULT_DOCUMENT_URL_TEMPLATE;

  return { baseUrl, documentUrlTemplate };
}

// Substitutes {name}, {{name}}, and array-slice tokens like {name[0..1]} (inclusive substring) in a template.
export function applyUrlTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{?(\w+)(?:\[(\d+)\.\.(\d+)\])?\}\}?/g, (match, key: string, start?: string, end?: string) => {
    const value = values[key];
    if (value === undefined) {
      return match;
    }

    return start !== undefined && end !== undefined ? value.slice(Number(start), Number(end) + 1) : value;
  });
}

export function buildDocumentPageUrl(template: string, baseUrl: string, documentId: string, page: number): string {
  const output = applyUrlTemplate(template, {
    baseUrl,
    documentId,
    page: String(page),
    pageNumber: String(page),
  });

  try {
    return new URL(output, `${baseUrl}/`).toString();
  } catch {
    return output;
  }
}
