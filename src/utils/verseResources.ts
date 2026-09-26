import type { VerseResourceDocument, VerseResourcesPayload } from '../services/bibleService';

export type ResourceVerseMatchMode = 'all' | 'any';

const documentKey = (document: VerseResourceDocument): string => (
  `${document.libraryId}::${document.documentId}::${document.title}`
);

const mergePageLinks = (
  left: VerseResourceDocument['pageLinks'],
  right: VerseResourceDocument['pageLinks']
): VerseResourceDocument['pageLinks'] => {
  const byPage = new Map<number, VerseResourceDocument['pageLinks'][number]>();

  for (const link of [...left, ...right]) {
    const existing = byPage.get(link.page);
    if (!existing) {
      byPage.set(link.page, link);
      continue;
    }

    if (!existing.raw && link.raw) {
      byPage.set(link.page, {
        ...existing,
        raw: link.raw,
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

  const reference = {
    book: payloads[0].reference.book,
    chapter: payloads[0].reference.chapter,
    verse: payloads[0].reference.verse,
  };

  if (payloads.length === 1) {
    return payloads[0];
  }

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
