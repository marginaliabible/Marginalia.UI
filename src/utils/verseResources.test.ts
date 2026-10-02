import { mergePageLinks, mergeVerseResourcePayloads } from './verseResources';
import type { VerseResourceDocument, VerseResourcesPayload } from '../services/bibleService';

const document = (
  id: string,
  title: string,
  pages: number[],
  tags: string[] = []
): VerseResourceDocument => ({
  libraryId: 'lib',
  libraryLabel: 'Library',
  documentId: id,
  title,
  tags,
  pages,
  pageLinks: pages.map((page) => ({ page, url: `https://example.com/${id}#${page}` })),
  link: { doc: id, lib: '0a1b2c3d' },
});

const payload = (verse: number, documents: VerseResourceDocument[]): VerseResourcesPayload => ({
  reference: { book: 'Genesis', chapter: 1, verse },
  tags: Array.from(new Set(documents.flatMap((entry) => entry.tags))),
  documents,
});

describe('mergeVerseResourcePayloads', () => {
  it('returns the single payload unchanged', () => {
    const only = payload(1, [document('a', 'Alpha', [3], ['commentary'])]);
    expect(mergeVerseResourcePayloads([only], 'all')).toEqual(only);
  });

  it('keeps documents present in every verse for ALL', () => {
    const merged = mergeVerseResourcePayloads([
      payload(1, [
        document('a', 'Alpha', [3], ['commentary']),
        document('b', 'Beta', [8], ['map']),
      ]),
      payload(2, [
        document('a', 'Alpha', [4], ['notes']),
        document('c', 'Gamma', [12], ['sermon']),
      ]),
    ], 'all');

    expect(merged?.documents.map((entry) => entry.documentId)).toEqual(['a']);
    expect(merged?.documents[0].pages).toEqual([3, 4]);
    expect(merged?.documents[0].tags).toEqual(['commentary', 'notes']);
    expect(merged?.tags).toEqual(['commentary', 'notes']);
  });

  it('unions documents across verses for ANY', () => {
    const merged = mergeVerseResourcePayloads([
      payload(1, [document('a', 'Alpha', [3], ['commentary'])]),
      payload(2, [document('b', 'Beta', [8], ['map'])]),
    ], 'any');

    expect(merged?.documents.map((entry) => entry.documentId)).toEqual(['a', 'b']);
    expect(merged?.tags).toEqual(['commentary', 'map']);
  });

  it('keeps one link per page carrying every verse reference text on that page', () => {
    const withRaws = (raws: string[]): VerseResourceDocument => ({
      ...document('a', 'Alpha', [2]),
      pageLinks: [{ page: 2, url: 'https://example.com/a#2', raws }],
    });

    const merged = mergeVerseResourcePayloads([
      payload(6, [withRaws(['Romans 12:6-8'])]),
      payload(7, [withRaws(['Rom 12:7', 'Romans 12:6-8'])]),
    ], 'all');

    expect(merged?.documents[0].pageLinks).toEqual([
      { page: 2, url: 'https://example.com/a#2', raws: ['Romans 12:6-8', 'Rom 12:7'] },
    ]);
  });
});

describe('mergePageLinks', () => {
  it('collapses links for the same page and unions their reference texts', () => {
    const merged = mergePageLinks(
      [
        { page: 5, url: 'u#5', raws: ['1 Pet. 2:24'] },
        { page: 2, url: 'u#2' },
      ],
      [
        { page: 2, url: 'u#2', raws: ['1Pe 2:24'] },
        { page: 5, url: 'u#5', raws: ['1Pe 2:24', '1 Pet. 2:24'] },
      ]
    );

    expect(merged).toEqual([
      { page: 2, url: 'u#2', raws: ['1Pe 2:24'] },
      { page: 5, url: 'u#5', raws: ['1 Pet. 2:24', '1Pe 2:24'] },
    ]);
  });
});
