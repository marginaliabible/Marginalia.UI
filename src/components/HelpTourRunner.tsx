import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { helpContentService } from '../services/helpContentService';
import { resolveHelpTourTarget } from '../help/tourTargets';
import { subscribeHelpTourEvent } from '../help/tourEvents';
import { isElementVisible } from '../help/isElementVisible';
import { scrollTourTargetIntoView } from '../help/scrollTourTargetIntoView';
import { renderTourContent } from '../help/renderTourContent';
import { HELP_OPEN_ARTICLE_EVENT } from '../help/openHelpArticle';
import { openHelpAccountSync } from '../help/accountSyncOpener';
import { ensureResourcesPanelTourReady } from '../help/resourcesPanelTourGates';
import {
  clearTourResumeIndex,
  getTourResumeIndex,
  RESUME_BEACON_TTL_MS,
  saveTourResumeIndex,
  shouldShowResumeBeacon,
} from '../help/tourProgress';
import { HelpTourProvider, type StartTourOptions } from '../help/HelpTourContext';
import { findTourStepForTarget } from '../help/tourTargetLinks';
import {
  handOffHelpTourIfNeeded,
  registerHelpTourStarter,
} from '../help/helpTourStarter';
import { queryTourTargetElement } from '../help/tourTargetWindows';
import { useSourcePreferences } from '../hooks/useSourcePreferences';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { openHelpTab, openVerseTabs, setActiveTab } from '../store/slices/bibleSlice';
import { routeInteraction } from '../services/windowRouting';
import type { QuickJumpTarget } from '../models/bible';
import type { OpenVerseTabsPayload } from '../models/windowMessages';
import type { HelpTourBeforeAction, HelpTourStep } from '../models/help';
import type { ButtonType, Controls, EventHandler, Placement, Step } from 'react-joyride';

interface HelpTourRunnerProps {
  onOpenSettings: () => void | Promise<void>;
  goToReference: (target: QuickJumpTarget, translationId?: string) => Promise<void>;
  children: React.ReactNode;
}

type JoyrideModule = typeof import('react-joyride');

interface ResumeBeaconState {
  tourId: string;
  stepIndex: number;
  step: HelpTourStep;
}

const DEFAULT_TOUR_BUTTONS: ButtonType[] = ['back', 'close', 'primary'];
const WAITING_TOUR_BUTTONS: ButtonType[] = ['back', 'close'];
const BLOCKER_TOUR_BUTTONS: ButtonType[] = ['close'];

/** When jumping past step 0, "ensure tab" befores should open the panel instead. */
const ENSURE_TAB_OPEN_PANEL: Partial<Record<HelpTourBeforeAction['action'], HelpTourBeforeAction>> = {
  ensureTranslationsTab: { action: 'openTranslationsPanel' },
  ensureResourcesTab: { action: 'openResourcesPanel' },
};

function resolveBeforeActionForResume(
  before: HelpTourBeforeAction,
  resumeIndex: number
): HelpTourBeforeAction {
  if (resumeIndex <= 0) {
    return before;
  }
  return ENSURE_TAB_OPEN_PANEL[before.action] ?? before;
}

const HelpTourRunner: React.FC<HelpTourRunnerProps> = ({ onOpenSettings, goToReference, children }) => {
  const dispatch = useAppDispatch();
  const tabs = useAppSelector((state) => state.bible.tabs);
  const currentBible = useAppSelector((state) => state.bible.currentBible);
  const selectedBook = useAppSelector((state) => state.ui.selectedBook);
  const selectedChapter = useAppSelector((state) => state.ui.selectedChapter);
  const selectedVerses = useAppSelector((state) => state.ui.selectedVerses);
  const sourceUrls = useAppSelector((state) => state.ui.sourceUrls);
  const sourcePreferences = useSourcePreferences();
  const [joyrideModule, setJoyrideModule] = useState<JoyrideModule | null>(null);
  const [helpSteps, setHelpSteps] = useState<HelpTourStep[]>([]);
  const [run, setRun] = useState(false);
  const [initialStepIndex, setInitialStepIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [primaryEnabled, setPrimaryEnabled] = useState(true);
  const [tourInstanceKey, setTourInstanceKey] = useState(0);
  const [resumeBeacon, setResumeBeacon] = useState<ResumeBeaconState | null>(null);
  const activeTourIdRef = useRef<string | null>(null);
  const currentStepIndexRef = useRef(0);
  const controlsRef = useRef<Controls | null>(null);
  const helpStepsRef = useRef<HelpTourStep[]>([]);
  const resumeBeaconRef = useRef<ResumeBeaconState | null>(null);
  /** Step indexes whose advanceVisible / advanceEvent gate already completed this tour run. */
  const satisfiedAdvanceVisibleRef = useRef<Set<number>>(new Set());

  helpStepsRef.current = helpSteps;
  resumeBeaconRef.current = resumeBeacon;

  useEffect(() => {
    const onOpenArticle = () => {
      routeInteraction(
        { kind: 'panel', type: 'open-help' },
        () => dispatch(openHelpTab())
      );
    };
    window.addEventListener(HELP_OPEN_ARTICLE_EVENT, onOpenArticle);
    return () => window.removeEventListener(HELP_OPEN_ARTICLE_EVENT, onOpenArticle);
  }, [dispatch]);

  const ensureVerseContext = useCallback((): OpenVerseTabsPayload => {
    const book = selectedBook?.trim() || 'John';
    const chapter = selectedChapter > 0 ? selectedChapter : 10;
    const verses = Array.isArray(selectedVerses)
      ? selectedVerses.filter((verse) => Number.isInteger(verse) && verse > 0)
      : [];
    const verse = verses[0] ?? 10;
    return {
      book,
      chapter,
      verse,
      verses: verses.length > 0 ? verses : [verse],
      hasResources: true,
    };
  }, [selectedBook, selectedChapter, selectedVerses]);

  const routeOpenVerseTabs = useCallback((payload: OpenVerseTabsPayload) => {
    routeInteraction(
      { kind: 'panel', type: 'open-verse-tabs', payload },
      () => dispatch(openVerseTabs(payload)),
      { quiet: true }
    );
  }, [dispatch]);

  const routeSelectPanelTab = useCallback((tabType: Extract<HelpTourBeforeAction, { action: 'selectPanelTab' }>['tabType']) => {
    routeInteraction(
      { kind: 'panel', type: 'select-tab', payload: { tabType } },
      () => {
        const tab = tabs.find((entry) => entry.type === tabType);
        if (tab) {
          dispatch(setActiveTab({ tabId: tab.id }));
        }
      },
      { quiet: true }
    );
  }, [dispatch, tabs]);

  const runBeforeAction = useCallback(async (action: HelpTourBeforeAction | undefined) => {
    if (!action) {
      return;
    }
    if (action.action === 'openSettings') {
      await onOpenSettings();
      // Bootstrap modal fade + layout settle before Joyride measures targets.
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      return;
    }
    if (action.action === 'openAccountSync') {
      openHelpAccountSync();
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      return;
    }
    if (action.action === 'openTranslationsPanel') {
      routeOpenVerseTabs({
        ...ensureVerseContext(),
        preferPanel: 'translations',
      });
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      return;
    }
    if (action.action === 'ensureTranslationsTab') {
      const hasTranslationsTab = tabs.some((tab) => tab.type === 'translations');
      if (!hasTranslationsTab) {
        routeOpenVerseTabs({
          ...ensureVerseContext(),
          preferPanel: 'translations',
        });
        // Keep Help active so the user can click the Translations tab themselves.
        routeSelectPanelTab('help');
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
      return;
    }
    if (action.action === 'openResourcesPanel') {
      routeOpenVerseTabs({
        ...ensureVerseContext(),
        preferPanel: 'resources',
      });
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      return;
    }
    if (action.action === 'ensureResourcesTab') {
      const hasResourcesTab = tabs.some((tab) => tab.type === 'resources');
      if (!hasResourcesTab) {
        routeOpenVerseTabs({
          ...ensureVerseContext(),
          preferPanel: 'resources',
        });
        routeSelectPanelTab('help');
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
      return;
    }
    if (action.action === 'selectPanelTab') {
      routeSelectPanelTab(action.tabType);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }, [ensureVerseContext, onOpenSettings, routeOpenVerseTabs, routeSelectPanelTab, tabs]);

  /** Open the host UI needed for a logical target when jumping mid-tour, then scroll it into view. */
  const ensureTargetVisible = useCallback(async (targetId: string) => {
    if (!isElementVisible(queryTourTargetElement(targetId))) {
      if (targetId === 'translations-panel' || targetId.startsWith('translations-')) {
        await runBeforeAction({ action: 'openTranslationsPanel' });
      } else if (targetId === 'settings-button' || targetId.startsWith('settings-')) {
        await runBeforeAction({ action: 'openSettings' });
      } else if (targetId === 'account-sync-button' || targetId.startsWith('account-sync-')) {
        await runBeforeAction({ action: 'openAccountSync' });
      } else if (
        targetId === 'search-panel'
        || targetId === 'search-results'
        || targetId === 'search-document-titles'
        || targetId === 'search-testament-toggles'
        || targetId === 'search-ot'
        || targetId === 'search-nt'
      ) {
        await runBeforeAction({ action: 'selectPanelTab', tabType: 'search' });
      } else if (
        targetId === 'resources-panel'
        || targetId.startsWith('resources-')
      ) {
        await runBeforeAction({ action: 'openResourcesPanel' });
      }
    }
    scrollTourTargetIntoView(targetId);
  }, [runBeforeAction]);

  const stopTour = useCallback(() => {
    setRun(false);
    setHelpSteps([]);
    setPrimaryEnabled(true);
    activeTourIdRef.current = null;
    controlsRef.current = null;
    satisfiedAdvanceVisibleRef.current = new Set();
  }, []);

  const endTourForArticleLink = useCallback(() => {
    const tourId = activeTourIdRef.current;
    if (tourId) {
      clearTourResumeIndex(tourId);
    }
    setResumeBeacon(null);
    stopTour();
  }, [stopTour]);

  const toJoyrideSteps = useCallback((tourSteps: HelpTourStep[], activeIndex: number, allowPrimary: boolean): Step[] => (
    tourSteps.map((step, index) => {
      const hasAdvanceGate = Boolean(step.advanceVisible || step.advanceEvent);
      const waitingOnVisibility = hasAdvanceGate && index === activeIndex && !allowPrimary;
      const isBlockerStep = step.target === 'body' && step.placement === 'center';
      return {
        target: resolveHelpTourTarget(step.target),
        ...(step.spotlightTarget
          ? { spotlightTarget: resolveHelpTourTarget(step.spotlightTarget) }
          : {}),
        title: step.title,
        content: renderTourContent(step.content, { onArticleLinkClick: endTourForArticleLink }),
        placement: (step.placement ?? 'auto') as Placement,
        skipBeacon: true,
        buttons: isBlockerStep
          ? BLOCKER_TOUR_BUTTONS
          : waitingOnVisibility
            ? WAITING_TOUR_BUTTONS
            : DEFAULT_TOUR_BUTTONS,
      };
    })
  ), [endTourForArticleLink]);

  const tourSteps = useMemo(
    () => toJoyrideSteps(helpSteps, stepIndex, primaryEnabled),
    [helpSteps, primaryEnabled, stepIndex, toJoyrideSteps]
  );

  const beaconSteps = useMemo((): Step[] => {
    if (!resumeBeacon) {
      return [];
    }
    return [{
      target: resolveHelpTourTarget(resumeBeacon.step.target),
      content: resumeBeacon.step.title
        ? `Continue: ${resumeBeacon.step.title}`
        : 'Continue the tour',
      placement: (resumeBeacon.step.placement ?? 'auto') as Placement,
      skipBeacon: false,
      hideOverlay: true,
      disableFocusTrap: true,
      skipScroll: true,
      buttons: [],
      isFixed: true,
      floatingOptions: { strategy: 'fixed' },
    }];
  }, [resumeBeacon]);

  const joyrideSteps = run ? tourSteps : beaconSteps;
  const joyrideRun = run || Boolean(resumeBeacon);

  // Joyride's isFixed mode skips document scrolling; bring each step's target into view ourselves.
  useEffect(() => {
    if (!run) {
      return;
    }
    const step = helpSteps[stepIndex];
    if (!step || step.target === 'body') {
      return;
    }
    scrollTourTargetIntoView(step.target);
    if (step.spotlightTarget) {
      scrollTourTargetIntoView(step.spotlightTarget);
    }
  }, [helpSteps, run, stepIndex, tourInstanceKey]);

  useEffect(() => {
    if (!run) {
      return;
    }

    const step = helpSteps[stepIndex];
    const hasAdvanceGate = Boolean(step?.advanceVisible || step?.advanceEvent);
    if (!hasAdvanceGate || satisfiedAdvanceVisibleRef.current.has(stepIndex)) {
      // Already completed this gate (or no gate) — allow normal Next/Back navigation.
      setPrimaryEnabled(true);
      return;
    }

    setPrimaryEnabled(false);
    let advanced = false;
    const advance = () => {
      if (advanced || !controlsRef.current) {
        return;
      }
      advanced = true;
      satisfiedAdvanceVisibleRef.current.add(stepIndex);
      setPrimaryEnabled(true);
      controlsRef.current.next();
    };

    let intervalId: number | undefined;
    if (step.advanceVisible) {
      const targetId = step.advanceVisible;
      const check = () => {
        // User completed the requested action (target now visible) — continue the tour.
        if (isElementVisible(queryTourTargetElement(targetId))) {
          advance();
        }
      };
      check();
      intervalId = window.setInterval(check, 200);
    }

    const stopEvent = step.advanceEvent
      ? subscribeHelpTourEvent(step.advanceEvent, advance)
      : null;

    return () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
      stopEvent?.();
    };
  }, [helpSteps, run, stepIndex, tourInstanceKey]);

  // Clear mid-tour resume beacon after TTL or when its target disappears.
  useEffect(() => {
    if (!resumeBeacon || run) {
      return;
    }

    const targetId = resumeBeacon.step.target;
    const timeoutId = window.setTimeout(() => {
      setResumeBeacon(null);
    }, RESUME_BEACON_TTL_MS);

    const intervalId = window.setInterval(() => {
      if (!isElementVisible(queryTourTargetElement(targetId))) {
        setResumeBeacon(null);
      }
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [resumeBeacon, run, tourInstanceKey]);

  const placeResumeBeacon = useCallback((tourId: string, resumeIndex: number, steps: HelpTourStep[]) => {
    if (!shouldShowResumeBeacon(resumeIndex, steps.length)) {
      setResumeBeacon(null);
      return;
    }
    const step = steps[resumeIndex];
    if (!step) {
      setResumeBeacon(null);
      return;
    }
    setResumeBeacon({ tourId, stepIndex: resumeIndex, step });
    setTourInstanceKey((value) => value + 1);
  }, []);

  const startTour = useCallback(async (tourId: string, options?: StartTourOptions) => {
    try {
      const mod = joyrideModule ?? await import('react-joyride');
      if (!joyrideModule) {
        setJoyrideModule(mod);
      }

      setResumeBeacon(null);

      const definition = await helpContentService.getTour(tourId);

      const resumeIndex = typeof options?.stepIndex === 'number'
        ? Math.max(0, Math.min(options.stepIndex, definition.steps.length - 1))
        : getTourResumeIndex(tourId, definition.steps.length);

      const destination = definition.steps[resumeIndex];
      // Deliver the tour to the window that owns the destination target before any local gates/UI work.
      if (
        !options?.local
        && destination
        && handOffHelpTourIfNeeded(tourId, resumeIndex, destination.target)
      ) {
        return;
      }

      if (tourId === 'resources-panel') {
        const gate = await ensureResourcesPanelTourReady({
          selectedBook,
          selectedChapter,
          availableBooks: currentBible?.books ?? [],
          sourceUrls,
          preferences: sourcePreferences,
          goToReference,
        });
        if (gate.status === 'blocked') {
          activeTourIdRef.current = tourId;
          currentStepIndexRef.current = 0;
          satisfiedAdvanceVisibleRef.current = new Set();
          setInitialStepIndex(0);
          setStepIndex(0);
          setPrimaryEnabled(true);
          setHelpSteps([{
            target: 'body',
            title: 'Resources panel',
            content: gate.message,
            placement: 'center',
          }]);
          setTourInstanceKey((value) => value + 1);
          setRun(true);
          return;
        }
      }

      // Run prerequisite befores for the resume/jump point (e.g. open Settings even if step 0 is skipped).
      const seenBefores = new Set<string>();
      for (const step of definition.steps.slice(0, resumeIndex + 1)) {
        if (!step.before) {
          continue;
        }
        const key = JSON.stringify(step.before);
        if (seenBefores.has(key)) {
          continue;
        }
        seenBefores.add(key);
        await runBeforeAction(resolveBeforeActionForResume(step.before, resumeIndex));
      }

      // Steps already passed before resume/jump shouldn't auto-advance again on Back.
      const satisfied = new Set<number>();
      for (let index = 0; index < resumeIndex; index += 1) {
        const step = definition.steps[index];
        if (step?.advanceVisible || step?.advanceEvent) {
          satisfied.add(index);
          if (step.advanceVisible) {
            await ensureTargetVisible(step.advanceVisible);
          }
        }
      }
      satisfiedAdvanceVisibleRef.current = satisfied;

      if (destination) {
        await ensureTargetVisible(destination.target);
        if (destination.spotlightTarget) {
          await ensureTargetVisible(destination.spotlightTarget);
        }
      }

      const resumeStep = definition.steps[resumeIndex];
      const resumeHasGate = Boolean(resumeStep?.advanceVisible || resumeStep?.advanceEvent);
      activeTourIdRef.current = tourId;
      currentStepIndexRef.current = resumeIndex;
      setInitialStepIndex(resumeIndex);
      setStepIndex(resumeIndex);
      setHelpSteps(definition.steps);
      setPrimaryEnabled(!resumeHasGate || satisfied.has(resumeIndex));
      setTourInstanceKey((value) => value + 1);
      setRun(true);
    } catch (tourError) {
      console.warn(
        tourError instanceof Error ? tourError.message : 'Unable to start help tour',
        tourError
      );
    }
  }, [
    currentBible?.books,
    ensureTargetVisible,
    goToReference,
    joyrideModule,
    runBeforeAction,
    selectedBook,
    selectedChapter,
    sourcePreferences,
    sourceUrls,
  ]);

  const startTourAtTarget = useCallback(async (targetSpec: string) => {
    try {
      const match = await findTourStepForTarget(targetSpec);
      if (!match) {
        console.warn(`No help tour step found for target: ${targetSpec}`);
        return;
      }
      await startTour(match.tourId, { stepIndex: match.stepIndex });
    } catch (error) {
      console.warn(
        error instanceof Error ? error.message : 'Unable to start help tour from target',
        error
      );
    }
  }, [startTour]);

  useEffect(() => registerHelpTourStarter((tourId, options) => {
    void startTour(tourId, options);
  }), [startTour]);

  // When the active step's target lives in another window, hand the tour off there.
  useEffect(() => {
    if (!run) {
      return;
    }
    const tourId = activeTourIdRef.current;
    const step = helpSteps[stepIndex];
    if (!tourId || !step) {
      return;
    }
    if (!handOffHelpTourIfNeeded(tourId, stepIndex, step.target)) {
      return;
    }
    setResumeBeacon(null);
    stopTour();
  }, [helpSteps, run, stepIndex, stopTour]);

  const handleEvent = useCallback<EventHandler>((data, controls) => {
    controlsRef.current = controls;

    // Beacon left after a mid-tour exit — clicking it resumes the full tour.
    const pendingBeacon = resumeBeaconRef.current;
    if (pendingBeacon && !run && data.lifecycle === 'tooltip') {
      const { tourId } = pendingBeacon;
      setResumeBeacon(null);
      void startTour(tourId);
      return;
    }

    const tourId = activeTourIdRef.current;

    // Completed all steps (Done) — start fresh next time.
    if (data.status === 'finished') {
      if (tourId) {
        clearTourResumeIndex(tourId);
      }
      setResumeBeacon(null);
      stopTour();
      return;
    }

    // Overlay / ESC — end on the step the user was viewing (tracked in currentStepIndexRef).
    if (data.action === 'close') {
      const resumeIndex = currentStepIndexRef.current;
      const stepsSnapshot = helpStepsRef.current;
      if (tourId) {
        saveTourResumeIndex(tourId, resumeIndex);
        placeResumeBeacon(tourId, resumeIndex, stepsSnapshot);
      }
      stopTour();
      return;
    }

    if (typeof data.index === 'number' && data.index >= 0) {
      currentStepIndexRef.current = data.index;
      setStepIndex(data.index);
      // Returning via Back should not re-trigger advanceVisible auto-advance.
      if (data.action === 'prev') {
        satisfiedAdvanceVisibleRef.current.add(data.index);
        setPrimaryEnabled(true);
      }
    }

    // X button uses closeButtonAction: 'skip'.
    if (data.status === 'skipped' || data.action === 'skip') {
      const resumeIndex = currentStepIndexRef.current;
      const stepsSnapshot = helpStepsRef.current;
      if (tourId) {
        saveTourResumeIndex(tourId, resumeIndex);
        placeResumeBeacon(tourId, resumeIndex, stepsSnapshot);
      }
      stopTour();
    }
  }, [placeResumeBeacon, run, startTour, stopTour]);

  const Joyride = joyrideModule?.Joyride;

  return (
    <HelpTourProvider startTour={startTour} startTourAtTarget={startTourAtTarget}>
      {children}
      {Joyride && joyrideSteps.length > 0 && (
        <Joyride
          key={tourInstanceKey}
          steps={joyrideSteps}
          run={joyrideRun}
          continuous={run}
          scrollToFirstStep={run}
          initialStepIndex={run ? initialStepIndex : 0}
          onEvent={handleEvent}
          locale={{ last: 'Done', open: 'View help for this feature' }}
          options={{
            showProgress: run,
            buttons: run ? DEFAULT_TOUR_BUTTONS : [],
            primaryColor: '#0d6efd',
            zIndex: 10050,
            closeButtonAction: 'skip',
            // Joyride's 'close' advances; we end the tour in onEvent instead of going next.
            overlayClickAction: run ? 'close' : false,
            dismissKeyAction: run ? 'close' : false,
            // Keep tooltip + spotlight in viewport space so nested panel scroll tracks tightly.
            isFixed: true,
            floatingOptions: { strategy: 'fixed' },
            ...(run
              ? {}
              : {
                hideOverlay: true,
                disableFocusTrap: true,
                skipBeacon: false,
              }),
          }}
        />
      )}
    </HelpTourProvider>
  );
};

export default HelpTourRunner;
