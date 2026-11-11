import React from 'react';
import { openHelpArticle } from './openHelpArticle';

const ARTICLE_LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g;

export interface RenderTourContentOptions {
  /** Called when the user follows an in-tour Help article link (e.g. Account Sync). */
  onArticleLinkClick?: () => void;
}

/**
 * Renders tour step text with markdown-style article links: [Label](article-id).
 * Absolute http(s) links stay as normal anchors; other relative targets open Help articles.
 */
export function renderTourContent(
  content: string,
  options: RenderTourContentOptions = {}
): React.ReactNode {
  const { onArticleLinkClick } = options;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  ARTICLE_LINK_PATTERN.lastIndex = 0;

  while ((match = ARTICLE_LINK_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }

    const label = match[1];
    const href = match[2];
    if (/^https?:\/\//i.test(href)) {
      nodes.push(
        <a key={`${match.index}-${href}`} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      );
    } else {
      const articleId = href.replace(/\.md$/i, '').replace(/^\.\//, '');
      nodes.push(
        <button
          key={`${match.index}-${articleId}`}
          type="button"
          className="btn btn-link help-article-link p-0 align-baseline"
          onClick={() => {
            openHelpArticle(articleId);
            onArticleLinkClick?.();
          }}
        >
          {label}
        </button>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes.length === 1 ? nodes[0] : <>{nodes}</>;
}
