/**
 * React Joyride 3.x debounces spotlight tracking (100ms) and uses absolute SVG
 * coordinates that lag behind nested panel scroll. Patch dist builds to:
 * - force viewport/fixed spotlight rects
 * - flushSync on scroll/resize so the cutout updates before paint
 * - observe all scroll containers via document capture
 *
 * Idempotent for the current marker. Re-run after npm install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = '/* marginalia-joyride-spotlight-follow-v2 */';

const files = [
  {
    file: path.join(root, 'node_modules/react-joyride/dist/index.mjs'),
    format: 'esm',
  },
  {
    file: path.join(root, 'node_modules/react-joyride/dist/index.cjs'),
    format: 'cjs',
  },
];

function ensureFlushSyncImport(code, format) {
  if (code.includes('flushSync')) {
    return code;
  }
  if (format === 'esm') {
    return code.replace(
      'import { createPortal } from "react-dom";',
      'import { createPortal, flushSync } from "react-dom";'
    );
  }
  if (code.includes('const reactDom = require("react-dom");')) {
    return code.replace(
      'const reactDom = require("react-dom");',
      'const reactDom = require("react-dom");\nconst flushSync = reactDom.flushSync;'
    );
  }
  return code;
}

function patchComputeRect(code) {
  const from = `	return {
		height: Math.round((elementRect?.height ?? 0) + spotlightPadding.top + spotlightPadding.bottom),
		isFixed,
		left: Math.round((elementRect?.left ?? 0) - spotlightPadding.left),
		top,
		width: Math.round((elementRect?.width ?? 0) + spotlightPadding.left + spotlightPadding.right)
	};
}`;
  const to = `	return {
		height: Math.round((elementRect?.height ?? 0) + spotlightPadding.top + spotlightPadding.bottom),
		// Force fixed/viewport spotlight tracking — absolute SVG lags behind nested panel scroll.
		isFixed: true,
		left: Math.round((elementRect?.left ?? 0) - spotlightPadding.left),
		top: Math.round((elementRect?.top ?? 0) - spotlightPadding.top),
		width: Math.round((elementRect?.width ?? 0) + spotlightPadding.left + spotlightPadding.right)
	};
}`;
  if (!code.includes(from)) {
    return { code, ok: code.includes('isFixed: true') && code.includes('elementRect?.top ?? 0') };
  }
  return { code: code.replace(from, to), ok: true };
}

/** @param {'esm' | 'cjs'} format */
function buildUpdateRectReplacement(format) {
  const useCallback = format === 'esm' ? 'useCallback' : '(0, react.useCallback)';
  const flush = format === 'esm' ? 'flushSync' : 'reactDom.flushSync';

  const stockFrom = `const updateRect = ${useCallback}(() => {
		clearTimeout(timeoutRef.current);
		timeoutRef.current = window.setTimeout(() => {
			setRect((previous) => {
				const next = computeRect(target, spotlightPadding);
				if (previous.top === next.top && previous.left === next.left && previous.width === next.width && previous.height === next.height && previous.isFixed === next.isFixed) return previous;
				return next;
			});
		}, 100);
	}, [target, spotlightPadding]);`;

  const to = `${marker}
	const updateRect = ${useCallback}(() => {
		const next = computeRect(target, spotlightPadding);
		${flush}(() => {
			setRect((previous) => {
				if (previous.top === next.top && previous.left === next.left && previous.width === next.width && previous.height === next.height && previous.isFixed === next.isFixed) return previous;
				return next;
			});
		});
	}, [target, spotlightPadding]);`;

  return { stockFrom, to };
}

function patchScrollListeners(code) {
  const fromStock = `		const setup = (element) => {
			scrollParentRef.current = getScrollParent(element, true);
			if (scrollParentRef.current) scrollParentRef.current.addEventListener("scroll", updateRect, { passive: true });
			window.addEventListener("scroll", updateRect, { passive: true });
			window.addEventListener("resize", updateRect);`;

  const to = `		const setup = (element) => {
			scrollParentRef.current = getScrollParent(element, true);
			// Capture-phase document scroll catches nested panel scrollers Joyride misses.
			document.addEventListener("scroll", updateRect, {
				passive: true,
				capture: true
			});
			window.addEventListener("resize", updateRect);`;

  let next = code;
  if (next.includes(fromStock)) {
    next = next.replace(fromStock, to);
  } else if (!next.includes('document.addEventListener("scroll", updateRect')) {
    return { code: next, ok: false };
  }

  const cleanupStock = `			if (scrollParentRef.current) scrollParentRef.current.removeEventListener("scroll", updateRect);
			window.removeEventListener("scroll", updateRect);
			window.removeEventListener("resize", updateRect);
			observerRef.current?.disconnect();
			clearTimeout(timeoutRef.current);`;

  const cleanupTo = `			document.removeEventListener("scroll", updateRect, { capture: true });
			window.removeEventListener("resize", updateRect);
			observerRef.current?.disconnect();`;

  if (next.includes(cleanupStock)) {
    next = next.replace(cleanupStock, cleanupTo);
  }

  return { code: next, ok: true };
}

let patched = 0;
let skipped = 0;

for (const { file, format } of files) {
  if (!fs.existsSync(file)) {
    console.warn(`[patch-react-joyride] missing ${path.relative(root, file)}`);
    continue;
  }

  let code = fs.readFileSync(file, 'utf8');
  if (code.includes(marker) && code.includes('flushSync(() =>')) {
    skipped += 1;
    continue;
  }

  code = ensureFlushSyncImport(code, format);
  const rect = patchComputeRect(code);
  code = rect.code;
  if (!rect.ok) {
    console.warn(`[patch-react-joyride] computeRect pattern not found in ${path.relative(root, file)}`);
  }

  const { stockFrom, to } = buildUpdateRectReplacement(format);

  if (code.includes(stockFrom)) {
    code = code.replace(stockFrom, to);
  } else if (!code.includes(marker)) {
    console.warn(`[patch-react-joyride] updateRect pattern not found in ${path.relative(root, file)}`);
    continue;
  }

  const listeners = patchScrollListeners(code);
  code = listeners.code;

  fs.writeFileSync(file, code, 'utf8');
  patched += 1;
  console.log(`[patch-react-joyride] patched ${path.relative(root, file)}`);
}

if (patched === 0 && skipped === 0) {
  process.exitCode = 1;
}
