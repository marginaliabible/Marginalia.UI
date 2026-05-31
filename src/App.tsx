import AppHeader from './components/AppHeader';
import SearchBar from './components/SearchBar';
import WorkspaceMainPane from './components/WorkspaceMainPane';
import WorkspaceDivider from './components/WorkspaceDivider';
import WorkspaceSidePanel from './components/WorkspaceSidePanel';
import SidePanelContent from './components/SidePanelContent';
import LoadingStatus from './components/LoadingStatus';
import SettingsModal from './components/SettingsModal';
import { useEffect, useMemo, useRef, useState, ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAppDispatch, useAppSelector } from './store/hooks';
import {
  loadTranslation,
  refreshTranslations,
  setActiveTab,
  closeTab,
  setCurrentBibleFromId,
} from './store/slices/bibleSlice';
import {
  setSelectedTranslationId,
  setSelectedTranslationIds,
  setSelectedBook,
  setSelectedChapter,
  setFocusVerse,
  setSelectedLanguages,
  setTheme,
  setReady,
  restoreState,
  addTranslationRecord,
  removeTranslationRecord,
  toggleStarTranslation,
  reorderTranslations,
} from './store/slices/uiSlice';
import { bibleService } from './services/bibleService';
import type { QuickJumpTarget } from './models/bible';
import {
  type WorkspacePanelKey,
  normalizeLanguageSelection,
  normalizeLanguages,
  detectPreferredLanguages,
  getLanguageDisplayName,
  applyTheme,
  detectPreferredTheme,
  scrollToVerse,
} from './App';
import { useDesktopLayout } from './hooks/useDesktopLayout';
import { useWorkspaceSplit } from './hooks/useWorkspaceSplit';
import { usePopupPanel } from './hooks/usePopupPanel';
import { useMobilePanelEffects } from './hooks/useMobilePanelEffects';
import './App.scss';

const STATE_CACHE_KEY = 'gitbible:state';

function App() {
  const dispatch = useAppDispatch();
  const modalRef = useRef<any>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);

  // Redux state
  const {
    availableTranslations,
    currentBible,
    isLoading,
    error,
    activeTabId,
    isPanelDetached,
    detachedPanelName,
  } = useAppSelector((state) => state.bible);

  const {
    selectedTranslationId,
    selectedTranslationIds,
    translationRecords,
    selectedBook,
    selectedChapter,
    selectedLanguages,
    theme,
    ready,
  } = useAppSelector((state) => state.ui);

  const safeAvailableTranslations = Array.isArray(availableTranslations) ? availableTranslations : [];
  const safeTranslationRecords = Array.isArray(translationRecords) ? translationRecords : [];
  const safeSelectedTranslationIds = Array.isArray(selectedTranslationIds) ? selectedTranslationIds : [];
  const safeSelectedLanguages = Array.isArray(selectedLanguages) ? selectedLanguages : [];

  const isDesktopLayout = useDesktopLayout();
  const isMobileLayout = !isDesktopLayout;

  const activeWorkspacePanel: WorkspacePanelKey | null = activeTabId ? 'search' : null;

  const { popupContainer, focusDetachedPanel, handleToggleDetachPanel } = usePopupPanel({
    dispatch,
    theme,
    isPanelDetached,
    detachedPanelName,
  });

  const { mainPanePercent, sidePanePercent, handleDividerPointerDown, handleDividerKeyDown } =
    useWorkspaceSplit({ workspaceRef, isDesktopLayout, activeWorkspacePanel });

  useMobilePanelEffects({
    isMobileLayout,
    isMobilePanelOpen,
    isDesktopLayout,
    isPanelDetached,
    activeWorkspacePanel,
    setIsMobilePanelOpen,
  });

  // Ctrl+F to focus search input
  useEffect(() => {
    const handleCtrlF = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleCtrlF);
    return () => window.removeEventListener('keydown', handleCtrlF);
  }, []);

  // Initialize app
  useEffect(() => {
    const initApp = async () => {
      const hasPersistedState =
        typeof window !== 'undefined' && window.localStorage.getItem(STATE_CACHE_KEY) !== null;
      const savedState = bibleService.readState();

      const normalizedLanguages = normalizeLanguages(savedState?.languages);
      const detectedLanguages = detectPreferredLanguages();
      const finalLanguages = normalizedLanguages.length > 0 ? normalizedLanguages : detectedLanguages;

      const hydratedTranslationRecords = Array.isArray(savedState?.translationRecords)
        ? savedState.translationRecords
        : undefined;
      const hydratedTranslationIds = Array.isArray(savedState?.lastTranslationIds)
        ? savedState.lastTranslationIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : undefined;
      const fallbackTranslationId = hydratedTranslationRecords?.[0]?.id || hydratedTranslationIds?.[0] || 'KJV';
      const nextTranslationId =
        typeof savedState?.lastTranslationId === 'string' && savedState.lastTranslationId.trim().length > 0
          ? savedState.lastTranslationId
          : fallbackTranslationId;
      const nextTranslationIds = hydratedTranslationIds && hydratedTranslationIds.length > 0
        ? hydratedTranslationIds
        : [nextTranslationId];
      const nextTranslationRecords = hydratedTranslationRecords && hydratedTranslationRecords.length > 0
        ? hydratedTranslationRecords
        : [{ id: nextTranslationId, starred: true }];
      const hasSavedReference =
        hasPersistedState
        && typeof savedState?.lastBook === 'string'
        && savedState.lastBook.trim().length > 0
        && typeof savedState?.lastChapter === 'number'
        && savedState.lastChapter > 0;
      const initialBook = hasSavedReference ? savedState.lastBook : 'John';
      const initialChapter = hasSavedReference ? savedState.lastChapter : 10;
      const initialVerse =
        hasSavedReference
        && typeof savedState?.lastVerse === 'number'
        && savedState.lastVerse > 0
          ? savedState.lastVerse
          : 10;

      dispatch(restoreState({
        selectedTranslationId: nextTranslationId,
        selectedTranslationIds: nextTranslationIds,
        translationRecords: nextTranslationRecords,
        selectedBook: initialBook,
        selectedChapter: initialChapter,
        focusVerse: initialVerse,
        theme: savedState?.theme ?? detectPreferredTheme(),
        selectedLanguages: finalLanguages,
      }));

      await dispatch(loadTranslation(nextTranslationId));
      void dispatch(refreshTranslations(false));
      dispatch(setReady(true));
    };

    initApp();
  }, [dispatch]);

  // Persist state on changes
  useEffect(() => {
    if (!ready) return;

    bibleService.persistState({
      lastTranslationId: selectedTranslationId,
      lastTranslationIds: safeSelectedTranslationIds,
      translationRecords: safeTranslationRecords,
      lastBook: selectedBook || undefined,
      lastChapter: selectedBook ? selectedChapter : undefined,
      lastVerse: undefined,
      lastSearch: undefined,
      theme,
      languages: safeSelectedLanguages,
    });
  }, [
    selectedTranslationId,
    safeSelectedTranslationIds,
    safeTranslationRecords,
    selectedBook,
    selectedChapter,
    theme,
    safeSelectedLanguages,
    ready,
  ]);

  useEffect(() => {
    dispatch(setCurrentBibleFromId(selectedTranslationId));
  }, [dispatch, selectedTranslationId]);

  // Safety fallback: if a translation is loaded but selection is missing,
  // default to John 10:10 (or closest available chapter in John).
  useEffect(() => {
    if (!currentBible || selectedBook) {
      return;
    }

    const johnBook = currentBible.books.find((book) => book.name === 'John') ?? currentBible.books[0];
    if (!johnBook) {
      return;
    }

    const chapterTenExists = johnBook.chapters.some((chapter) => chapter.chapter === 10);
    const defaultChapter = chapterTenExists
      ? 10
      : (johnBook.chapters[0]?.chapter ?? 1);
    const defaultVerse = chapterTenExists ? 10 : 1;

    dispatch(setSelectedBook(johnBook.name));
    dispatch(setSelectedChapter(defaultChapter));
    dispatch(setFocusVerse(defaultVerse));
  }, [currentBible, selectedBook, dispatch]);

  // Apply theme changes to document
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const translationMetadataById = useMemo(
    () =>
      new Map(safeAvailableTranslations.map((translation) => [translation.id, translation] as const)),
    [safeAvailableTranslations]
  );

  const languageOptions = useMemo(() => {
    const langMap = new Map<string, { code: string; count: number }>();
    for (const translation of safeAvailableTranslations) {
      const rawLang = translation.language;
      const codes = Array.isArray(rawLang) ? rawLang : (rawLang ? [rawLang] : []);
      for (const code of codes) {
        const existing = langMap.get(code);
        if (existing) {
          existing.count++;
        } else {
          langMap.set(code, { code, count: 1 });
        }
      }
    }
    return Array.from(langMap.values())
      .sort((a, b) => {
        const nameA = getLanguageDisplayName(a.code);
        const nameB = getLanguageDisplayName(b.code);
        return nameA.localeCompare(nameB);
      });
  }, [safeAvailableTranslations]);

  const filteredTranslations = useMemo(() => {
    if (safeSelectedLanguages.length === 0) {
      return safeAvailableTranslations;
    }
    const normalizedCodes = new Set(normalizeLanguages(safeSelectedLanguages));
    const matches = safeAvailableTranslations.filter((t) => {
      const langs = Array.isArray(t.language) ? t.language : (t.language ? [t.language] : []);
      return langs.some((l) => normalizedCodes.has(l));
    });
    return matches.length === 0 ? safeAvailableTranslations : matches;
  }, [safeAvailableTranslations, safeSelectedLanguages]);

  // Ensure selectedTranslationId is valid; fallback to first starred or KJV
  useEffect(() => {
    const recordIds = new Set(safeTranslationRecords.map((r) => r.id));
    if (!recordIds.has(selectedTranslationId)) {
      const starredIds = safeTranslationRecords.filter((r) => r.starred).map((r) => r.id);
      const validId = starredIds[0] || safeTranslationRecords[0]?.id || 'KJV';
      dispatch(setSelectedTranslationId(validId));
    }
  }, [safeTranslationRecords, selectedTranslationId, dispatch]);

  const addableTranslations = useMemo(() => {
    const selectedIds = new Set(safeTranslationRecords.map((record) => record.id));
    return filteredTranslations
      .filter((translation) => !selectedIds.has(translation.id))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredTranslations, safeTranslationRecords]);

  const starredTranslationIds = useMemo(() => {
    return safeTranslationRecords.filter((r) => r.starred).map((r) => r.id);
  }, [safeTranslationRecords]);

  // Keep selectedTranslationIds in sync with translationRecords for backward compatibility
  useEffect(() => {
    const recordIds = safeTranslationRecords.map((r) => r.id);
    if (JSON.stringify(safeSelectedTranslationIds) !== JSON.stringify(recordIds)) {
      dispatch(setSelectedTranslationIds(recordIds));
    }
  }, [safeTranslationRecords, dispatch, safeSelectedTranslationIds]);

  const useWideLayout = starredTranslationIds.length + (activeTabId ? 1 : 0) > 3;
  const hasSidePanel = !isPanelDetached && Boolean(activeWorkspacePanel);

  const goToReference = async (target: QuickJumpTarget, translationId?: string) => {
    if (isPanelDetached) {
      window.focus();
    }

    const nextActiveId = translationId && safeSelectedTranslationIds.includes(translationId)
      ? translationId
      : selectedTranslationId;

    const loadResult = await dispatch(loadTranslation(nextActiveId));

    if (nextActiveId !== selectedTranslationId) {
      dispatch(setSelectedTranslationId(nextActiveId));
      dispatch(setCurrentBibleFromId(nextActiveId));
    }

    const activeBible = loadTranslation.fulfilled.match(loadResult)
      ? loadResult.payload
      : currentBible;
    if (!activeBible) return;

    if (!activeBible.books.some((book) => book.name === target.book)) {
      return;
    }

    dispatch(setSelectedBook(target.book));
    dispatch(setSelectedChapter(target.chapter));
    dispatch(setFocusVerse(target.verse ?? null));

    await scrollToVerse(target);
  };

  const handleThemeToggle = (e: ChangeEvent<HTMLInputElement>) => {
    dispatch(setTheme(e.target.checked ? 'dark' : 'light'));
  };

  const handleLanguagesChange = (selected: string[]) => {
    dispatch(setSelectedLanguages(normalizeLanguageSelection(selected)));
  };

  const openSettingsModal = async () => {
    const el = document.getElementById('settingsModal');
    if (!el) return;

    if (!modalRef.current) {
      const { default: Modal } = await import('bootstrap/js/dist/modal');
      modalRef.current = Modal.getOrCreateInstance(el);
    }

    modalRef.current?.show();
  };

  const closeSettingsModal = () => {
    modalRef.current?.hide();
  };

  const handleSelectTab = (tabId: string) => {
    dispatch(setActiveTab(tabId));
    if (isPanelDetached) {
      focusDetachedPanel();
    }
  };

  const handleCloseTab = (tabId: string) => {
    dispatch(closeTab(tabId));
  };

  return (
    <>
      <div className={`container app-shell ${useWideLayout ? 'app-shell-wide' : ''}`}>
        <AppHeader onOpenSettings={openSettingsModal} />

        <SearchBar
          searchInputRef={searchInputRef}
          starredTranslationIds={starredTranslationIds}
          goToReference={goToReference}
          isPanelDetached={isPanelDetached}
          focusDetachedPanel={focusDetachedPanel}
          isDesktopLayout={isDesktopLayout}
          setIsMobilePanelOpen={setIsMobilePanelOpen}
        />

        <div
          ref={workspaceRef}
          className={`workspace-layout ${hasSidePanel ? 'has-side-panel' : ''} ${
            isDesktopLayout ? 'is-desktop' : 'is-mobile'
          }`}
        >
          <WorkspaceMainPane
            isDesktopLayout={isDesktopLayout}
            isPanelDetached={isPanelDetached}
            activeWorkspacePanel={activeWorkspacePanel}
            mainPanePercent={mainPanePercent}
            isMobileLayout={isMobileLayout}
            setIsMobilePanelOpen={setIsMobilePanelOpen}
            translationMetadataById={translationMetadataById}
          />

          {isDesktopLayout && !isPanelDetached && activeWorkspacePanel && (
            <WorkspaceDivider
              onPointerDown={handleDividerPointerDown}
              onKeyDown={handleDividerKeyDown}
            />
          )}

          {hasSidePanel && (
            <WorkspaceSidePanel
              isMobileLayout={isMobileLayout}
              isDesktopLayout={isDesktopLayout}
              isPanelDetached={isPanelDetached}
              isMobilePanelOpen={isMobilePanelOpen}
              setIsMobilePanelOpen={setIsMobilePanelOpen}
              sidePanePercent={sidePanePercent}
              goToReference={goToReference}
              translationRecords={safeTranslationRecords}
              translationMetadataById={translationMetadataById}
              addableTranslations={addableTranslations}
              onAddTranslation={(id) => dispatch(addTranslationRecord(id))}
              onRemoveTranslation={(id) => dispatch(removeTranslationRecord(id))}
              onToggleStar={(id) => dispatch(toggleStarTranslation(id))}
              onReorder={(fromIndex, toIndex) => dispatch(reorderTranslations({ fromIndex, toIndex }))}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onToggleDetach={handleToggleDetachPanel}
            />
          )}

          {isMobileLayout && hasSidePanel && isMobilePanelOpen && (
            <button
              type="button"
              className="mobile-panel-backdrop"
              aria-label="Close side panel"
              onClick={() => setIsMobilePanelOpen(false)}
            />
          )}
        </div>

        <LoadingStatus isLoading={isLoading} error={error} />

        <SettingsModal
          theme={theme}
          handleThemeToggle={handleThemeToggle}
          selectedLanguages={safeSelectedLanguages}
          handleLanguagesChange={handleLanguagesChange}
          languageOptions={languageOptions}
          getLanguageDisplayName={getLanguageDisplayName}
          closeSettingsModal={closeSettingsModal}
        />
      </div>

      {isPanelDetached && activeWorkspacePanel && popupContainer && createPortal(
        <div className="workspace-scroll panel-scroll-with-tabs popout-panel-shell">
          <SidePanelContent
            isMobileLayout={false}
            isDesktopLayout={true}
            isPanelDetached={isPanelDetached}
            isMobilePanelOpen={false}
            setIsMobilePanelOpen={() => {}}
            goToReference={goToReference}
            translationRecords={safeTranslationRecords}
            translationMetadataById={translationMetadataById}
            addableTranslations={addableTranslations}
            onAddTranslation={(id) => dispatch(addTranslationRecord(id))}
            onRemoveTranslation={(id) => dispatch(removeTranslationRecord(id))}
            onToggleStar={(id) => dispatch(toggleStarTranslation(id))}
            onReorder={(fromIndex, toIndex) => dispatch(reorderTranslations({ fromIndex, toIndex }))}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onToggleDetach={handleToggleDetachPanel}
          />
        </div>,
        popupContainer
      )}
    </>
  );
}

export default App;