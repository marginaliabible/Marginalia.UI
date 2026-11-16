/** Window event so tour/tooltips can open a Help article by id. */
export const HELP_OPEN_ARTICLE_EVENT = 'marginalia:help-open-article';

let pendingArticleId: string | null = null;
const dialogDismissers = new Set<() => void>();

/**
 * Register a dialog/modal dismisser invoked when Help opens an article
 * (so overlays do not sit on top of the Help tab).
 */
export function registerHelpArticleDialogDismisser(dismiss: () => void): () => void {
  dialogDismissers.add(dismiss);
  return () => {
    dialogDismissers.delete(dismiss);
  };
}

function dismissRegisteredDialogs(): void {
  for (const dismiss of [...dialogDismissers]) {
    try {
      dismiss();
    } catch {
      // Keep opening Help even if a dismisser throws.
    }
  }
}

export function openHelpArticle(articleId: string): void {
  const id = articleId.trim();
  if (typeof window === 'undefined' || !id) {
    return;
  }
  dismissRegisteredDialogs();
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
