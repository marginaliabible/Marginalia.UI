/** Window event so tour/tooltips can open a Help article by id. */
export const HELP_OPEN_ARTICLE_EVENT = 'marginalia:help-open-article';

let pendingArticleId: string | null = null;

export function openHelpArticle(articleId: string): void {
  const id = articleId.trim();
  if (typeof window === 'undefined' || !id) {
    return;
  }
  pendingArticleId = id;
  window.dispatchEvent(new CustomEvent(HELP_OPEN_ARTICLE_EVENT, { detail: { articleId: id } }));
}

export function consumePendingHelpArticleId(): string | null {
  const id = pendingArticleId;
  pendingArticleId = null;
  return id;
}

export function readHelpOpenArticleId(event: Event): string | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }
  const articleId = event.detail?.articleId;
  return typeof articleId === 'string' && articleId.trim() ? articleId.trim() : null;
}
