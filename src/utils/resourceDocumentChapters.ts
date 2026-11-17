export interface ResourceChapter {
  title: string;
  page: number;
}

export interface ResourcePageLinkLike {
  page: number;
}

export interface ChapterPageGroup<Link extends ResourcePageLinkLike> {
  /** Chapter title when hits fall inside a TOC chapter; null for pages before the first chapter. */
  chapter: ResourceChapter | null;
  links: Link[];
}

/**
 * Assign each page hit to the latest chapter whose start page is <= the hit page.
 * Pages before the first chapter stay in a leading group with chapter = null.
 */
export function groupPageLinksByChapter<Link extends ResourcePageLinkLike>(
  pageLinks: Link[],
  chapters: ResourceChapter[] | undefined
): ChapterPageGroup<Link>[] {
  const links = [...pageLinks].sort((left, right) => left.page - right.page);
  if (links.length === 0) {
    return [];
  }

  const sortedChapters = [...(chapters ?? [])]
    .filter((chapter) => chapter.title.trim().length > 0 && Number.isFinite(chapter.page) && chapter.page >= 1)
    .sort((left, right) => left.page - right.page);

  if (sortedChapters.length === 0) {
    return [{ chapter: null, links }];
  }

  const groups: ChapterPageGroup<Link>[] = [];
  let chapterIndex = -1;

  for (const link of links) {
    while (
      chapterIndex + 1 < sortedChapters.length
      && sortedChapters[chapterIndex + 1].page <= link.page
    ) {
      chapterIndex += 1;
    }

    const chapter = chapterIndex >= 0 ? sortedChapters[chapterIndex] : null;
    const last = groups[groups.length - 1];
    if (last && last.chapter?.page === chapter?.page && last.chapter?.title === chapter?.title) {
      last.links.push(link);
    } else {
      groups.push({ chapter, links: [link] });
    }
  }

  return groups;
}
