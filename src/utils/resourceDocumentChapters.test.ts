import { groupPageLinksByChapter } from './resourceDocumentChapters';

describe('groupPageLinksByChapter', () => {
  const links = (pages: number[]) => pages.map((page) => ({ page }));

  it('returns a single ungrouped list when there are no chapters', () => {
    expect(groupPageLinksByChapter(links([2, 5]), undefined)).toEqual([
      { chapter: null, links: [{ page: 2 }, { page: 5 }] },
    ]);
  });

  it('keeps pages before the first chapter ungrouped', () => {
    expect(groupPageLinksByChapter(
      links([3, 12, 20]),
      [{ title: 'The Word Receive', page: 10 }, { title: 'Later', page: 18 }]
    )).toEqual([
      { chapter: null, links: [{ page: 3 }] },
      { chapter: { title: 'The Word Receive', page: 10 }, links: [{ page: 12 }] },
      { chapter: { title: 'Later', page: 18 }, links: [{ page: 20 }] },
    ]);
  });

  it('groups multiple hits under one chapter', () => {
    expect(groupPageLinksByChapter(
      links([145, 147]),
      [{ title: 'The Word Receive', page: 140 }]
    )).toEqual([
      {
        chapter: { title: 'The Word Receive', page: 140 },
        links: [{ page: 145 }, { page: 147 }],
      },
    ]);
  });
});
