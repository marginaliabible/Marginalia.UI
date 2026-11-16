import React from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import type { Components } from 'react-markdown';
import { openHelpArticle } from './openHelpArticle';

export interface RenderTourContentOptions {
  /** Called when the user follows an in-tour Help article link (e.g. Account Sync). */
  onArticleLinkClick?: () => void;
}

/**
 * Renders tour step markdown via react-markdown (same stack as Help articles).
 * Supports emphasis (`*italic*`, `**bold**`) and links: [Label](article-id) opens Help;
 * absolute http(s) links open normally.
 */
export function renderTourContent(
  content: string,
  options: RenderTourContentOptions = {}
): React.ReactNode {
  const { onArticleLinkClick } = options;

  const components: Components = {
    // Tour tooltips are short; avoid default paragraph margins from article styling.
    p: ({ children }) => <p className="mb-0">{children}</p>,
    a: ({ href, children }) => {
      if (!href) {
        return <>{children}</>;
      }
      if (/^https?:\/\//i.test(href)) {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
      if (/^[a-z]+:/i.test(href) || href.startsWith('/')) {
        return <a href={href}>{children}</a>;
      }
      const articleId = href.replace(/\.md$/i, '').replace(/^\.\//, '');
      return (
        <button
          type="button"
          className="btn btn-link help-article-link p-0 align-baseline"
          onClick={() => {
            openHelpArticle(articleId);
            onArticleLinkClick?.();
          }}
        >
          {children}
        </button>
      );
    },
  };

  return (
    <ReactMarkdown components={components} urlTransform={defaultUrlTransform}>
      {content}
    </ReactMarkdown>
  );
}
