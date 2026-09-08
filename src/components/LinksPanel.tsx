import React, { useEffect, useState } from 'react';
import type { PanelTab, VerseContext } from '../models/tab';
import type { ResolvedHyperlink } from '../models/hyperlink';
import { useAppSelector } from '../store/hooks';
import { hyperlinkService } from '../services/hyperlinkService';

interface LinksPanelProps {
  tab: PanelTab;
  isActive: boolean;
}

const LinksPanel: React.FC<LinksPanelProps> = ({ tab, isActive }) => {
  const verseContext = tab.verseContext as VerseContext | undefined;
  const { sourceUrls } = useAppSelector((state) => state.ui);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<ResolvedHyperlink[] | null>(null);

  // Every tab body is mounted up front, so defer the first fetch until the tab is actually viewed.
  const [hasBeenViewed, setHasBeenViewed] = useState(isActive);

  useEffect(() => {
    if (isActive) {
      setHasBeenViewed(true);
    }
  }, [isActive]);

  useEffect(() => {
    if (!hasBeenViewed) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      if (!verseContext) {
        if (!cancelled) {
          setLinks(null);
          setError(null);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const resolved = await hyperlinkService.getHyperlinksForVerse(verseContext, sourceUrls);
        if (cancelled) {
          return;
        }

        setLinks(resolved);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setLinks(null);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load links');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [hasBeenViewed, verseContext, sourceUrls]);

  if (!verseContext) {
    return <div className="links-panel-empty">Select a verse to see external links.</div>;
  }

  const reference = `${verseContext.book} ${verseContext.chapter}:${verseContext.verse}`;

  return (
    <div className="links-panel">
      <div className="links-panel-reference">{reference}</div>

      {isLoading && <div className="links-panel-status">Loading links&hellip;</div>}
      {error && <div className="links-panel-status links-panel-error">{error}</div>}

      {!isLoading && !error && links && links.length === 0 && (
        <div className="links-panel-status">No external links are configured.</div>
      )}

      {links && links.length > 0 && (
        <ul className="links-panel-list">
          {links.map((link) => (
            <li key={`${link.sourceUrl}:${link.label}:${link.href}`}>
              <a href={link.href} target="_blank" rel="noopener noreferrer" className="links-panel-link">
                <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                <span>{link.label}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LinksPanel;
