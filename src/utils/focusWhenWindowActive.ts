const FOCUS_RETRY_DELAYS_MS = [100, 400, 1_000];
const FOCUS_WAIT_MS = 3_000;

/**
 * A window brought forward from another one can arrive with keyboard focus on the browser's toolbar,
 * and the routed command usually lands before the window is even in front. Once it is, the page
 * focuses itself and then `focusTarget`, retrying until the page actually has keyboard focus.
 * Returns a function that stops waiting.
 */
export function focusWhenWindowActive(focusTarget: () => void): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const stop = () => {
    timers.forEach(clearTimeout);
    window.removeEventListener('focus', handleFocus);
  };
  const handleFocus = () => {
    focusTarget();
    stop();
  };
  const attempt = () => {
    if (!document.hasFocus()) {
      window.focus();
    }
    focusTarget();
    if (document.hasFocus()) {
      stop();
    }
  };

  focusTarget();
  if (document.hasFocus()) {
    return stop;
  }
  window.addEventListener('focus', handleFocus);
  for (const delay of FOCUS_RETRY_DELAYS_MS) {
    timers.push(setTimeout(attempt, delay));
  }
  timers.push(setTimeout(stop, FOCUS_WAIT_MS));
  return stop;
}
