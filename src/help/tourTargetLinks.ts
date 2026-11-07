import type { HelpTourDefinition } from '../models/help';
import { helpContentService } from '../services/helpContentService';

export interface ParsedHelpTargetRef {
  /** Optional tour id when the link is `target:tour-id.target-id`. */
  tourId?: string;
  /** Logical help target id (e.g. translations-selected). */
  targetId: string;
}

export interface TourStepTargetMatch {
  tourId: string;
  stepIndex: number;
}

/** Parse `translations-selected` or `use-translations-panel.translations-selected`. */
export function parseHelpTargetRef(spec: string): ParsedHelpTargetRef {
  const trimmed = spec.trim();
  const separator = trimmed.indexOf('.');
  if (separator > 0 && separator < trimmed.length - 1) {
    return {
      tourId: trimmed.slice(0, separator),
      targetId: trimmed.slice(separator + 1),
    };
  }
  return { targetId: trimmed };
}

function stepUsesTarget(step: HelpTourDefinition['steps'][number], targetId: string): boolean {
  return step.target === targetId || step.spotlightTarget === targetId;
}

/**
 * Find the first tour step that uses the given logical target.
 * Prefer an explicit tour id when provided (`tourId.targetId`).
 */
export async function findTourStepForTarget(spec: string): Promise<TourStepTargetMatch | null> {
  const { tourId, targetId } = parseHelpTargetRef(spec);
  if (!targetId) {
    return null;
  }

  const manifest = await helpContentService.getManifest();
  const candidates = tourId
    ? manifest.tours.filter((tour) => tour.id === tourId)
    : manifest.tours;

  for (const meta of candidates) {
    const definition = await helpContentService.getTour(meta.id);
    const stepIndex = definition.steps.findIndex((step) => stepUsesTarget(step, targetId));
    if (stepIndex >= 0) {
      return { tourId: definition.id, stepIndex };
    }
  }

  return null;
}
