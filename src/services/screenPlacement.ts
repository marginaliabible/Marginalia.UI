import { dismissToast, showToast } from './toastService';
import type { ScreenArea } from '../utils/popoutBounds';
import { centerOnScreen, type ScreenLayout } from '../utils/popoutWindow';

interface ScreenDetailedLike extends ScreenArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The live object from the Window Management API; it updates as screens change and this window moves. */
export interface ScreenDetailsLike {
  screens: readonly ScreenDetailedLike[];
  currentScreen: ScreenDetailedLike;
}

type WindowWithScreenDetails = Window & { getScreenDetails?: () => Promise<ScreenDetailsLike> };
type PlacementPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Chrome renamed the permission; older versions only know the first name. */
const PERMISSION_NAMES = ['window-management', 'window-placement'];

export const SCREEN_PLACEMENT_OFFER_MESSAGE =
  'We see you\'re rocking multiple monitors! Allow window management and we\'ll remember which displays you use for which pop-outs.';

export const SCREEN_PLACEMENT_SINGLE_DISPLAY_OFFER_MESSAGE =
  'Allow window management to ensure new windows get displayed when reused.';

let permission: PlacementPermission = 'unknown';
let details: ScreenDetailsLike | null = null;
let offeredThisLoad = false;
let stopPermissionWatch: (() => void) | null = null;

/** Readable without any permission, unlike the screens themselves. Undefined outside Chromium. */
export const hasMultipleDisplays = (): boolean => (
  typeof window !== 'undefined' && (window.screen as Screen & { isExtended?: boolean }).isExtended === true
);

const getScreenDetailsFn = (): (() => Promise<ScreenDetailsLike>) | null => {
  const fn = typeof window === 'undefined' ? undefined : (window as WindowWithScreenDetails).getScreenDetails;
  return typeof fn === 'function' ? fn.bind(window) : null;
};

async function queryPermission(): Promise<PermissionStatus | null> {
  for (const name of PERMISSION_NAMES) {
    try {
      return await navigator.permissions.query({ name: name as PermissionName });
    } catch {
      // This browser doesn't know the name; try the next one.
    }
  }
  return null;
}

/** Shows the browser's permission prompt when the permission hasn't been decided yet. */
async function loadScreenDetails(): Promise<boolean> {
  const getScreenDetails = getScreenDetailsFn();
  if (!getScreenDetails) {
    return false;
  }
  try {
    details = await getScreenDetails();
    permission = 'granted';
    return true;
  } catch {
    details = null;
    permission = 'denied';
    return false;
  }
}

/** Learns the permission state up front, so a pop-out click can place its window synchronously. */
export async function initScreenPlacement(): Promise<void> {
  if (!getScreenDetailsFn() || typeof navigator === 'undefined' || !navigator.permissions) {
    return;
  }

  const status = await queryPermission();
  if (!status) {
    return;
  }

  const apply = () => {
    permission = status.state;
    if (permission !== 'granted') {
      details = null;
    } else if (!details) {
      void loadScreenDetails();
    }
  };
  apply();
  status.addEventListener('change', apply);
  stopPermissionWatch = () => status.removeEventListener('change', apply);
}

const toArea = (screen: ScreenDetailedLike): ScreenArea => ({
  availLeft: screen.availLeft,
  availTop: screen.availTop,
  availWidth: screen.availWidth,
  availHeight: screen.availHeight,
});

const sameScreen = (left: ScreenDetailedLike, right: ScreenDetailedLike): boolean => (
  left.left === right.left && left.top === right.top && left.width === right.width && left.height === right.height
);

/** Null unless the user granted window management and more than one display is still connected. */
export function getScreenLayout(): ScreenLayout | null {
  if (permission !== 'granted' || !details || !hasMultipleDisplays()) {
    return null;
  }

  const current = details.currentScreen;
  const other = details.screens.find((screen) => !sameScreen(screen, current));
  return { screens: details.screens.map(toArea), other: other ? toArea(other) : null };
}

/** Moves a popup this window just opened onto the other display, keeping its size where it fits. */
export function moveToOtherScreen(popup: Window): void {
  const other = getScreenLayout()?.other;
  if (!other) {
    return;
  }

  try {
    if (popup.closed) {
      return;
    }
    const { left, top, width, height } = centerOnScreen(popup.outerWidth, popup.outerHeight, other);
    popup.moveTo(left, top);
    if (width !== popup.outerWidth || height !== popup.outerHeight) {
      popup.resizeTo(width, height);
    }
  } catch {
    // Closed in the meantime.
  }
}

/** Asks once per page load whether pop-outs may use window management (multi-display placement or reliable reuse). */
export function offerScreenPlacement(onGranted?: () => void): void {
  if (offeredThisLoad || permission !== 'prompt') {
    return;
  }

  offeredThisLoad = true;
  let toastId = '';
  toastId = showToast({
    key: 'screen-placement-offer',
    message: hasMultipleDisplays()
      ? SCREEN_PLACEMENT_OFFER_MESSAGE
      : SCREEN_PLACEMENT_SINGLE_DISPLAY_OFFER_MESSAGE,
    actions: [
      {
        label: 'Allow',
        onClick: () => {
          dismissToast(toastId);
          void loadScreenDetails().then((granted) => {
            if (granted) {
              onGranted?.();
            }
          });
        },
      },
      { label: 'Not now', onClick: () => dismissToast(toastId) },
    ],
  });
}

export function __resetScreenPlacementForTests(): void {
  stopPermissionWatch?.();
  stopPermissionWatch = null;
  permission = 'unknown';
  details = null;
  offeredThisLoad = false;
}
