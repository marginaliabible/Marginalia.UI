import type { BibleBook } from '../models/bible';
import { loadPageScriptureReferences } from './loadPageScriptureReferences';

jest.mock('../services/storageAuthenticatedFetch', () => ({
  fetchStorageAware: jest.fn(),
}));

describe('loadPageScriptureReferences', () => {
  const books: BibleBook[] = [
    {
      name: 'Romans',
      chapters: [{
        chapter: 12,
        verses: [
          { verse: 1, text: 'a' },
          { verse: 2, text: 'b' },
        ],
      }],
    },
  ];

  it('falls back to page-text detection when no pages base URL is provided', async () => {
    const references = await loadPageScriptureReferences({
      pageNumber: 3,
      books,
      pagesBaseUrl: null,
      pageText: 'See Rom. 12:1-2 here.',
    });

    expect(references).toEqual([{
      raw: 'Rom. 12:1-2',
      book: 'Romans',
      chapter: 12,
      verses: [1, 2],
    }]);
  });
});
