import { helpContentService } from '../services/helpContentService';

type HelpContentHotListener = () => void;

const listeners = new Set<HelpContentHotListener>();

/** Subscribe to Marginalia.Help content changes pushed by the Vite dev plugin. */
export function subscribeHelpContentHotReload(listener: HelpContentHotListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyHelpContentHotReload(): void {
  helpContentService.clearCache();
  for (const listener of listeners) {
    listener();
  }
}

// Register as soon as this module loads (not only when HelpPanel mounts).
// Access via optional chaining so Jest (no import.meta) can still load this module.
const hot = (import.meta as ImportMeta & { hot?: { on: (event: string, cb: () => void) => void } }).hot;
hot?.on('marginalia-help:update', notifyHelpContentHotReload);
