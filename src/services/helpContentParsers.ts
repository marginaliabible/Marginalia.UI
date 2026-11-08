import type {
  HelpManifest,
  HelpSearchIndex,
  HelpTourDefinition,
  HelpTourStep,
} from '../models/help';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseHelpManifest(payload: unknown): HelpManifest {
  if (!isPlainObject(payload) || !Array.isArray(payload['articles']) || !Array.isArray(payload['tours'])) {
    throw new Error('Help manifest is invalid');
  }

  const articles = (payload['articles'] as unknown[]).flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }
    const id = readString(entry['id']);
    const title = readString(entry['title']);
    const path = readString(entry['path']);
    const section = readString(entry['section']) ?? '';
    if (!id || !title || !path) {
      return [];
    }
    return [{ id, title, path, section }];
  });

  const tours = (payload['tours'] as unknown[]).flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }
    const id = readString(entry['id']);
    const path = readString(entry['path']);
    if (!id || !path) {
      return [];
    }
    return [{ id, path }];
  });

  return {
    schemaVersion: typeof payload['schemaVersion'] === 'number' ? payload['schemaVersion'] : 1,
    articles,
    tours,
  };
}

export function parseHelpSearchIndex(payload: unknown): HelpSearchIndex {
  if (!isPlainObject(payload) || !Array.isArray(payload['documents'])) {
    throw new Error('Help search index is invalid');
  }

  const documents = (payload['documents'] as unknown[]).flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }
    const id = readString(entry['id']);
    const title = readString(entry['title']);
    if (!id || !title) {
      return [];
    }
    const headings = Array.isArray(entry['headings'])
      ? entry['headings'].filter((heading): heading is string => typeof heading === 'string')
      : [];
    const headingSlugs = Array.isArray(entry['headingSlugs'])
      ? entry['headingSlugs'].filter((slug): slug is string => typeof slug === 'string')
      : undefined;

    return [{
      id,
      title,
      section: typeof entry['section'] === 'string' ? entry['section'] : '',
      headings,
      headingSlugs,
      body: typeof entry['body'] === 'string' ? entry['body'] : '',
    }];
  });

  return {
    schemaVersion: typeof payload['schemaVersion'] === 'number' ? payload['schemaVersion'] : 1,
    documents,
  };
}

export function parseHelpTourDefinition(payload: unknown): HelpTourDefinition {
  if (!isPlainObject(payload) || typeof payload['id'] !== 'string' || !Array.isArray(payload['steps'])) {
    throw new Error('Help tour definition is invalid');
  }

  const steps = (payload['steps'] as unknown[]).flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }
    const target = readString(entry['target']);
    const content = readString(entry['content']);
    if (!target || !content) {
      return [];
    }

    const step: HelpTourStep = { target, content };
    const title = readString(entry['title']);
    if (title) {
      step.title = title;
    }
    const spotlightTarget = readString(entry['spotlightTarget']);
    if (spotlightTarget) {
      step.spotlightTarget = spotlightTarget;
    }
    const placement = readString(entry['placement']);
    if (placement) {
      step.placement = placement as HelpTourStep['placement'];
    }
    const before = entry['before'];
    if (isPlainObject(before) && typeof before['action'] === 'string') {
      if (before['action'] === 'openSettings') {
        step.before = { action: 'openSettings' };
      } else if (before['action'] === 'openTranslationsPanel') {
        step.before = { action: 'openTranslationsPanel' };
      } else if (before['action'] === 'ensureTranslationsTab') {
        step.before = { action: 'ensureTranslationsTab' };
      } else if (
        before['action'] === 'selectPanelTab'
        && typeof before['tabType'] === 'string'
      ) {
        step.before = {
          action: 'selectPanelTab',
          tabType: before['tabType'] as 'search' | 'translations' | 'resources' | 'links' | 'help',
        };
      }
    }
    const advanceVisible = readString(entry['advanceVisible']);
    if (advanceVisible) {
      step.advanceVisible = advanceVisible;
    }
    const advanceEvent = readString(entry['advanceEvent']);
    if (advanceEvent) {
      step.advanceEvent = advanceEvent;
    }
    return [step];
  });

  if (steps.length === 0) {
    throw new Error('Help tour definition has no valid steps');
  }

  return { id: (payload['id'] as string).trim(), steps };
}
