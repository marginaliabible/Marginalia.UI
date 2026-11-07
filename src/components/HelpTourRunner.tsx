import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { helpContentService } from '../services/helpContentService';
import { resolveHelpTourTarget } from '../help/tourTargets';
import { isElementVisible } from '../help/isElementVisible';
import {
  clearTourResumeIndex,
  getTourResumeIndex,
  RESUME_BEACON_TTL_MS,
  saveTourResumeIndex,
  shouldShowResumeBeacon,
} from '../help/tourProgress';
import { HelpTourProvider, type StartTourOptions } from '../help/HelpTourContext';
import { findTourStepForTarget } from '../help/tourTargetLinks';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { openVerseTabs, setActiveTab } from '../store/slices/bibleSlice';
import type { HelpTourBeforeAction, HelpTourStep } from '../models/help';
import type { ButtonType, Controls, EventHandler, Placement, Step } from 'react-joyride';

interface HelpTourRunnerProps {
  onOpenSettings: () => void | Promise<void>;
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

const HelpTourRunner: React.FC<HelpTourRunnerProps> = ({ onOpenSettings, children }) => {
  const dispatch = useAppDispatch();
  const tabs = useAppSelector((state) => state.bible.tabs);
  const selectedBook = useAppSelector((state) => state.ui.selectedBook);
  const selectedChapter = useAppSelector((state) => state.ui.selectedChapter);
  const selectedVerses = useAppSelector((state) => state.ui.selectedVerses);
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
  /** Step indexes whose advanceVisible action already completed this tour run. */
  const satisfiedAdvanceVisibleRef = useRef<Set<number>>(new Set());

  helpStepsRef.current = helpSteps;
  resumeBeaconRef.current = resumeBeacon;

  const ensureVerseContext = useCallback(() => {
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
    };
  }, [selectedBook, selectedChapter, selectedVerses]);

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
    if (action.action === 'openTranslationsPanel') {
      const context = ensureVerseContext();
      dispatch(openVerseTabs({
        ...context,
        hasResources: true,
        preferPanel: 'translations',
      }));
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      return;
    }
    if (action.action === 'ensureTranslationsTab') {
      const helpTab = tabs.find((tab) => tab.type === 'help');
      const hasTranslationsTab = tabs.some((tab) => tab.type === 'translations');
      if (!hasTranslationsTab) {
        const context = ensureVerseContext();
        dispatch(openVerseTabs({
          ...context,
          hasResources: true,
          preferPanel: 'translations',
        }));
        // Keep Help active so the user can click the Translations tab themselves.
        if (helpTab) {
          dispatch(setActiveTab({ tabId: helpTab.id }));
        }
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
      return;
    }
    if (action.action === 'selectPanelTab') {
      const tab = tabs.find((entry) => entry.type === action.tabType);
      if (tab) {
        dispatch(setActiveTab({ tabId: tab.id }));
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
    }
  }, [dispatch, ensureVerseContext, onOpenSettings, tabs]);

  /** Open the host UI needed for a logical target when jumping mid-tour. */
  const ensureTargetVisible = useCallback(async (targetId: string) => {
    const selector = resolveHelpTourTarget(targetId);
    if (isElementVisible(document.querySelector(selector))) {
      return;
    }
    if (targetId === 'translations-panel' || targetId.startsWith('translations-')) {
      await runBeforeAction({ action: 'openTranslationsPanel' });
      return;
    }
    if (targetId === 'settings-button' || targetId.startsWith('settings-')) {
      await runBeforeAction({ action: 'openSettings' });
      return;
    }
    if (targetId === 'search-input') {
      await runBeforeAction({ action: 'selectPanelTab', tabType: 'search' });
    }
  }, [runBeforeAction]);

  const toJoyrideSteps = useCallback((tourSteps: HelpTourStep[], activeIndex: number, allowPrimary: boolean): Step[] => (
    tourSteps.map((step, index) => {
      const waitingOnVisibility = Boolean(step.advanceVisible) && index === activeIndex && !allowPrimary;
      return {
        target: resolveHelpTourTarget(step.target),
        ...(step.spotlightTarget
          ? { spotlightTarget: resolveHelpTourTarget(step.spotlightTarget) }
          : {}),
        title: step.title,
        content: step.content,
        placement: (step.placement ?? 'auto') as Placement,
        skipBeacon: true,
        buttons: waitingOnVisibility ? WAITING_TOUR_BUTTONS : DEFAULT_TOUR_BUTTONS,
      };
    })
  ), []);

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

  useEffect(() => {
    if (!run) {
      return;
    }

    const step = helpSteps[stepIndex];
    if (!step?.advanceVisible || satisfiedAdvanceVisibleRef.current.has(stepIndex)) {
      // Already completed this gate (or no gate) — allow normal Next/Back navigation.
      setPrimaryEnabled(true);
      return;
    }

    const selector = resolveHelpTourTarget(step.advanceVisible);
    let advanced = false;
    const check = () => {
      const visible = isElementVisible(document.querySelector(selector));
      setPrimaryEnabled(visible);
      // User completed the requested action (target now visible) — continue the tour.
      if (visible && !advanced && controlsRef.current) {
        advanced = true;
        satisfiedAdvanceVisibleRef.current.add(stepIndex);
        controlsRef.current.next();
      }
    };

    check();
    const intervalId = window.setInterval(check, 200);
    return () => window.clearInterval(intervalId);
  }, [helpSteps, run, stepIndex, tourInstanceKey]);

  // Clear mid-tour resume beacon after TTL or when its target disappears.
  useEffect(() => {
    if (!resumeBeacon || run) {
      return;
    }

    const selector = resolveHelpTourTarget(resumeBeacon.step.target);
    const timeoutId = window.setTimeout(() => {
      setResumeBeacon(null);
    }, RESUME_BEACON_TTL_MS);

    const intervalId = window.setInterval(() => {
      if (!isElementVisible(document.querySelector(selector))) {
        setResumeBeacon(null);
      }
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [resumeBeacon, run, tourInstanceKey]);

  const stopTour = useCallback(() => {
    setRun(false);
    setHelpSteps([]);
    setPrimaryEnabled(true);
    activeTourIdRef.current = null;
    controlsRef.current = null;
    satisfiedAdvanceVisibleRef.current = new Set();
  }, []);

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
        // Jumping past a gate: open the panel instead of only ensuring the tab exists.
        if (
          resumeIndex > 0
          && step.before.action === 'ensureTranslationsTab'
        ) {
          await runBeforeAction({ action: 'openTranslationsPanel' });
          continue;
        }
        await runBeforeAction(step.before);
      }

      // Steps already passed before resume/jump shouldn't auto-advance again on Back.
      const satisfied = new Set<number>();
      for (let index = 0; index < resumeIndex; index += 1) {
        const step = definition.steps[index];
        if (step?.advanceVisible) {
          satisfied.add(index);
          await ensureTargetVisible(step.advanceVisible);
        }
      }
      satisfiedAdvanceVisibleRef.current = satisfied;

      const destination = definition.steps[resumeIndex];
      if (destination) {
        await ensureTargetVisible(destination.target);
        if (destination.spotlightTarget) {
          await ensureTargetVisible(destination.spotlightTarget);
        }
      }

      activeTourIdRef.current = tourId;
      currentStepIndexRef.current = resumeIndex;
      setInitialStepIndex(resumeIndex);
      setStepIndex(resumeIndex);
      setHelpSteps(definition.steps);
      setPrimaryEnabled(
        !definition.steps[resumeIndex]?.advanceVisible
        || satisfied.has(resumeIndex)
      );
      setTourInstanceKey((value) => value + 1);
      setRun(true);
    } catch (tourError) {
      console.warn(
        tourError instanceof Error ? tourError.message : 'Unable to start help tour',
        tourError
      );
    }
  }, [ensureTargetVisible, joyrideModule, runBeforeAction]);

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
