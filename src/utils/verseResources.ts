import type { VerseResourceDocument, VerseResourcesPayload } from '../services/bibleService';

export type ResourceVerseMatchMode = 'all' | 'any';

const documentKey = (document: VerseResourceDocument): string => (
  `${document.libraryId}::${document.documentId}::${document.title}`
);

/** One link per page number; reference texts from every merged link for that page are kept. */
export const mergePageLinks = <Link extends { page: number; raws?: string[] }>(
  left: Link[],
  right: Link[]
): Link[] => {
  const byPage = new Map<number, Link>();

  for (const link of [...left, ...right]) {
    const existing = byPage.get(link.page);
    if (!existing) {
      byPage.set(link.page, link);
      continue;
    }

    const missingRaws = (link.raws ?? []).filter((raw) => !(existing.raws ?? []).includes(raw));
    if (missingRaws.length > 0) {
      byPage.set(link.page, {
        ...existing,
        raws: [...(existing.raws ?? []), ...missingRaws],
      });
    }
  }

  return Array.from(byPage.values()).sort((a, b) => a.page - b.page);
};

const mergeDocuments = (
  left: VerseResourceDocument,
  right: VerseResourceDocument
): VerseResourceDocument => {
  const pageLinks = mergePageLinks(left.pageLinks, right.pageLinks);
  return {
    ...left,
    tags: Array.from(new Set([...left.tags, ...right.tags])),
    pages: Array.from(new Set([...left.pages, ...right.pages])).sort((a, b) => a - b),
    pageLinks,
  };
};

const collectTags = (documents: VerseResourceDocument[]): string[] => (
  Array.from(new Set(documents.flatMap((document) => document.tags)))
    .sort((left, right) => left.localeCompare(right))
);

export const mergeVerseResourcePayloads = (
  payloads: VerseResourcesPayload[],
  matchMode: ResourceVerseMatchMode
): VerseResourcesPayload | null => {
  if (payloads.length === 0) {
    return null;
  }

  if (payloads.length === 1) {
    return payloads[0];
  }

  const reference = payloads[0].reference ?? {
    book: '',
    chapter: 0,
    verse: 0,
  };

  const maps = payloads.map((payload) => {
    const map = new Map<string, VerseResourceDocument>();
    for (const document of payload.documents) {
      const key = documentKey(document);
      const existing = map.get(key);
      map.set(key, existing ? mergeDocuments(existing, document) : document);
    }
    return map;
  });

  const keys = matchMode === 'all'
    ? Array.from(maps[0].keys()).filter((key) => maps.every((map) => map.has(key)))
    : Array.from(new Set(maps.flatMap((map) => Array.from(map.keys()))));

  const documents = keys
    .map((key) => {
      const matches = maps
        .map((map) => map.get(key))
        .filter((document): document is VerseResourceDocument => Boolean(document));
      return matches.reduce((merged, document) => mergeDocuments(merged, document));
    })
    .sort((left, right) => left.title.localeCompare(right.title));

  return {
    reference,
    tags: collectTags(documents),
    documents,
  };
};
