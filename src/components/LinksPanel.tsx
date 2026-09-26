import React, { useEffect, useState } from 'react';
import type { PanelTab, VerseContext } from '../models/tab';
import type { ResolvedHyperlink } from '../models/hyperlink';
import { useAppSelector } from '../store/hooks';
import { hyperlinkService } from '../services/hyperlinkService';
import { firstVerseContext, formatVerseReference } from '../utils/selectedVerseContext';

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

  useEffect(() => {
    // Hidden tabs stay mounted; only populate while this tab is visible.
    if (!isActive) {
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
        const resolved = await hyperlinkService.getHyperlinksForVerse(
          firstVerseContext(verseContext),
          sourceUrls
        );
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
  }, [isActive, verseContext, sourceUrls]);

  if (!verseContext) {
    return <div className="links-panel-empty">Select a verse to see external links.</div>;
  }

  return (
    <div className="links-panel">
      <div className="links-panel-reference">{formatVerseReference(verseContext)}</div>

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
