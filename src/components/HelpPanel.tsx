import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { PanelTab } from '../models/tab';
import type { HelpArticleMeta, HelpManifest } from '../models/help';
import { helpContentService } from '../services/helpContentService';
import { helpSearchService, type HelpSearchHit } from '../services/helpSearchService';
import { getAppVersion } from '../services/appBuildIdentity';
import { subscribeHelpContentHotReload } from '../help/helpContentHotReload';
import { useHelpTour } from '../help/HelpTourContext';
import './HelpPanel.scss';

interface HelpPanelProps {
  tab: PanelTab;
  isActive: boolean;
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function groupArticlesBySection(articles: HelpArticleMeta[]): Array<{ section: string; articles: HelpArticleMeta[] }> {
  const groups = new Map<string, HelpArticleMeta[]>();
  for (const article of articles) {
    const section = article.section || 'Help';
    const list = groups.get(section) ?? [];
    list.push(article);
    groups.set(section, list);
  }
  return Array.from(groups.entries()).map(([section, sectionArticles]) => ({
    section,
    articles: sectionArticles,
  }));
}

const HelpPanel: React.FC<HelpPanelProps> = ({ isActive }) => {
  const { startTour, startTourAtTarget } = useHelpTour();
  const showHelpSourcePath = getAppVersion() === 'dev';
  const [manifest, setManifest] = useState<HelpManifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<HelpSearchHit[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [articleHistory, setArticleHistory] = useState<string[]>([]);
  const [pendingHeadingSlug, setPendingHeadingSlug] = useState<string | null>(null);
  const [articleMarkdown, setArticleMarkdown] = useState<string | null>(null);
  const [isLoadingArticle, setIsLoadingArticle] = useState(false);
  const [articleError, setArticleError] = useState<string | null>(null);
  const [contentEpoch, setContentEpoch] = useState(0);
  const selectedArticleIdRef = useRef<string | null>(null);
  const skipHistoryRef = useRef(false);
  selectedArticleIdRef.current = selectedArticleId;

  useEffect(() => (
    subscribeHelpContentHotReload(() => {
      setContentEpoch((epoch) => epoch + 1);
    })
  ), []);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let cancelled = false;
    setIsLoadingCatalog(true);
    setLoadError(null);

    void (async () => {
      try {
        const [nextManifest, searchIndex] = await Promise.all([
          helpContentService.getManifest(true),
          helpContentService.getSearchIndex(true),
        ]);
        if (cancelled) {
          return;
        }
        helpSearchService.load(searchIndex);
        setManifest(nextManifest);
        setSelectedArticleId((current) => {
          if (current && nextManifest.articles.some((article) => article.id === current)) {
            return current;
          }
          return nextManifest.articles[0]?.id ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load help content');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingCatalog(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isActive, contentEpoch]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }

    const handle = window.setTimeout(() => {
      setHits(helpSearchService.search(trimmed));
    }, 150);

    return () => window.clearTimeout(handle);
  }, [query]);

  const selectedArticle = useMemo(
    () => manifest?.articles.find((article) => article.id === selectedArticleId) ?? null,
    [manifest, selectedArticleId]
  );

  useEffect(() => {
    if (!isActive || !selectedArticle) {
      return;
    }

    let cancelled = false;
    setIsLoadingArticle(true);
    setArticleError(null);

    void (async () => {
      try {
        const markdown = await helpContentService.getArticleMarkdown(selectedArticle.path);
        if (!cancelled) {
          setArticleMarkdown(markdown);
        }
      } catch (error) {
        if (!cancelled) {
          setArticleMarkdown(null);
          setArticleError(error instanceof Error ? error.message : 'Unable to load article');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingArticle(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isActive, selectedArticle, contentEpoch]);

  useEffect(() => {
    if (!pendingHeadingSlug || !articleMarkdown || isLoadingArticle) {
      return;
    }

    const handle = window.setTimeout(() => {
      const el = document.getElementById(`help-heading-${pendingHeadingSlug}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPendingHeadingSlug(null);
    }, 50);

    return () => window.clearTimeout(handle);
  }, [articleMarkdown, isLoadingArticle, pendingHeadingSlug]);

  const openArticle = useCallback((articleId: string, headingSlug?: string) => {
    const currentId = selectedArticleIdRef.current;
    if (!skipHistoryRef.current && currentId && currentId !== articleId) {
      setArticleHistory((history) => [...history, currentId]);
    }
    skipHistoryRef.current = false;
    setSelectedArticleId(articleId);
    setPendingHeadingSlug(headingSlug ?? null);
    setQuery('');
  }, []);

  const goBack = useCallback(() => {
    setArticleHistory((history) => {
      if (history.length === 0) {
        return history;
      }
      const nextHistory = history.slice(0, -1);
      const previousId = history[history.length - 1];
      skipHistoryRef.current = true;
      setSelectedArticleId(previousId);
      setPendingHeadingSlug(null);
      setQuery('');
      return nextHistory;
    });
  }, []);

  const markdownComponents = useMemo<Components>(() => ({
    a: ({ href, children }) => {
      if (href?.startsWith('tour:')) {
        const tourId = href.slice('tour:'.length).trim();
        return (
          <button
            type="button"
            className="help-tour-button"
            onClick={() => {
              void startTour(tourId);
            }}
          >
            <i className="fa-solid fa-person-chalkboard" aria-hidden="true"></i>
            <span className="help-tour-button-label">{children}</span>
          </button>
        );
      }

      if (href?.startsWith('target:')) {
        const targetSpec = href.slice('target:'.length).trim();
        return (
          <button
            type="button"
            className="btn btn-link help-target-link p-0 align-baseline"
            onClick={() => {
              void startTourAtTarget(targetSpec);
            }}
          >
            {children}
          </button>
        );
      }

      if (href?.startsWith('#')) {
        return (
          <a href={href} onClick={(event) => {
            event.preventDefault();
            const slug = href.slice(1);
            document.getElementById(`help-heading-${slug}`)?.scrollIntoView({ behavior: 'smooth' });
          }}
          >
            {children}
          </a>
        );
      }

      // Relative article link: "settings.md" or "settings"
      if (href && !/^[a-z]+:/i.test(href) && !href.startsWith('/')) {
        const articleId = href.replace(/\.md$/i, '').replace(/^\.\//, '');
        return (
          <button
            type="button"
            className="btn btn-link help-article-link p-0 align-baseline"
            onClick={() => openArticle(articleId)}
          >
            {children}
          </button>
        );
      }

      return <a href={href}>{children}</a>;
    },
    h2: ({ children }) => {
      const text = String(children);
      const slug = slugifyHeading(text);
      return <h2 id={`help-heading-${slug}`}>{children}</h2>;
    },
    h3: ({ children }) => {
      const text = String(children);
      const slug = slugifyHeading(text);
      return <h3 id={`help-heading-${slug}`}>{children}</h3>;
    },
  }), [openArticle, startTour, startTourAtTarget]);

  const sections = useMemo(
    () => (manifest ? groupArticlesBySection(manifest.articles) : []),
    [manifest]
  );

  if (!isActive && !manifest) {
    return null;
  }

  return (
    <div className="help-panel">
      {showHelpSourcePath && selectedArticle && (
        <p className="help-source-path text-body-secondary small font-monospace mb-2" title="Help article source (dev only)">
          {selectedArticle.path}
        </p>
      )}
      <div className="help-panel-search mb-3 d-flex align-items-center gap-2">
        <button
          type="button"
          className="btn btn-outline-secondary help-back-button flex-shrink-0"
          aria-label="Back to previous help topic"
          title="Back"
          disabled={articleHistory.length === 0}
          onClick={goBack}
        >
          <i className="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
        <label className="visually-hidden" htmlFor="help-search-input">Search help</label>
        <input
          id="help-search-input"
          type="search"
          className="form-control"
          placeholder="Search help…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </div>

      {isLoadingCatalog && (
        <p className="text-body-secondary small mb-3">Loading help…</p>
      )}
      {loadError && (
        <div className="alert alert-warning small" role="alert">{loadError}</div>
      )}

      {query.trim() ? (
        <div className="help-search-results mb-3">
          {hits.length === 0 ? (
            <p className="text-body-secondary small mb-0">No matching articles.</p>
          ) : (
            <ul className="list-unstyled mb-0">
              {hits.map((hit) => (
                <li key={hit.id} className="mb-2">
                  <button
                    type="button"
                    className="btn btn-link help-result-link text-start p-0"
                    onClick={() => openArticle(hit.id, hit.headingSlug)}
                  >
                    <span className="fw-semibold d-block">{hit.title}</span>
                    {hit.section && (
                      <span className="text-body-secondary small d-block">{hit.section}</span>
                    )}
                    {hit.snippet && (
                      <span className="text-body-secondary small d-block">{hit.snippet}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <nav className="help-toc mb-3" aria-label="Help topics">
          {sections.map((group) => (
            <div key={group.section} className="mb-2">
              <div className="help-toc-section text-body-secondary small text-uppercase">{group.section}</div>
              <ul className="list-unstyled mb-0">
                {group.articles.map((article) => (
                  <li key={article.id}>
                    <button
                      type="button"
                      className={`btn btn-link help-toc-link text-start p-0${
                        article.id === selectedArticleId ? ' is-active' : ''
                      }`}
                      onClick={() => openArticle(article.id)}
                    >
                      {article.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      )}

      <div className="help-article">
        {isLoadingArticle && (
          <p className="text-body-secondary small">Loading article…</p>
        )}
        {articleError && (
          <div className="alert alert-warning small" role="alert">{articleError}</div>
        )}
        {!isLoadingArticle && !articleError && articleMarkdown && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
            urlTransform={(url) => (
              // react-markdown strips unknown protocols by default; keep help deep-links.
              url.startsWith('tour:') || url.startsWith('target:')
                ? url
                : defaultUrlTransform(url)
            )}
          >
            {articleMarkdown}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
};

export default HelpPanel;
