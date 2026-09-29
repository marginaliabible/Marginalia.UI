import { useRef } from 'react';
import { render } from '@testing-library/react';
import { useViewerZoomInputs } from './useViewerZoomInputs';

type Callbacks = {
  onZoomStep: jest.Mock;
  onZoomReset: jest.Mock;
  onZoomTo: jest.Mock;
};

function Harness({ withFrame, callbacks }: { withFrame: boolean; callbacks: Callbacks }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useViewerZoomInputs({
    enabled: true,
    stageRef,
    frameRef: withFrame ? frameRef : undefined,
    frameKey: 'doc',
    scale: 1,
    ...callbacks,
  });
  return (
    <div ref={stageRef} data-testid="stage">
      {withFrame && <iframe ref={frameRef} title="doc" />}
    </div>
  );
}

function setup(withFrame = false) {
  const callbacks: Callbacks = { onZoomStep: jest.fn(), onZoomReset: jest.fn(), onZoomTo: jest.fn() };
  const utils = render(<Harness withFrame={withFrame} callbacks={callbacks} />);
  return { ...utils, callbacks };
}

function keydown(target: EventTarget, view: Window, init: KeyboardEventInit): KeyboardEvent {
  const { KeyboardEvent } = view as Window & typeof globalThis;
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('useViewerZoomInputs', () => {
  it('zooms from Ctrl +/-/0 on the host window', () => {
    const { callbacks } = setup();

    const zoomIn = keydown(window, window, { key: '=', ctrlKey: true });
    keydown(window, window, { key: '-', metaKey: true });
    keydown(window, window, { key: '0', ctrlKey: true });
    keydown(window, window, { key: '=' });

    expect(zoomIn.defaultPrevented).toBe(true);
    expect(callbacks.onZoomStep.mock.calls).toEqual([[1], [-1]]);
    expect(callbacks.onZoomReset).toHaveBeenCalledTimes(1);
  });

  it('steps on Ctrl+wheel over the stage, accumulating small trackpad deltas', () => {
    const { callbacks, getByTestId } = setup();
    const stage = getByTestId('stage');

    const notch = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true });
    stage.dispatchEvent(notch);
    for (let i = 0; i < 10; i += 1) {
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, ctrlKey: true, cancelable: true }));
    }
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));

    expect(notch.defaultPrevented).toBe(true);
    // -100 -> one step in (-40 left over); +100 of small deltas reaches +60 -> one step out.
    expect(callbacks.onZoomStep.mock.calls).toEqual([[1], [-1]]);
  });

  it('handles zoom keys inside the iframe and forwards other shortcuts to the host', () => {
    const { callbacks, container } = setup(true);
    const frame = container.querySelector('iframe')!;
    const frameWindow = frame.contentWindow!;

    const zoomOut = keydown(frameWindow, frameWindow, { key: '-', ctrlKey: true });
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(callbacks.onZoomStep).toHaveBeenCalledWith(-1);

    const hostListener = jest.fn((event: KeyboardEvent) => {
      if (event.key === 'k') {
        event.preventDefault();
      }
    });
    window.addEventListener('keydown', hostListener, true);
    try {
      const shortcut = keydown(frameWindow, frameWindow, { key: 'k', ctrlKey: true });
      const plain = keydown(frameWindow, frameWindow, { key: 'j' });

      expect(hostListener).toHaveBeenCalledTimes(1);
      const forwarded = hostListener.mock.calls[0]![0];
      expect(forwarded.target).toBe(frame);
      expect(forwarded.ctrlKey).toBe(true);
      expect(shortcut.defaultPrevented).toBe(true);
      expect(plain.defaultPrevented).toBe(false);
    } finally {
      window.removeEventListener('keydown', hostListener, true);
    }
  });
});
