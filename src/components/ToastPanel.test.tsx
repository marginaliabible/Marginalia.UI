import { act, fireEvent, render, screen } from '@testing-library/react';
import ToastPanel, { TOAST_AUTO_COLLAPSE_MS } from './ToastPanel';
import {
  TOAST_LIFETIME_MS,
  __resetToastsForTests,
  getToasts,
  showToast,
} from '../services/toastService';

function panel(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('.toast-panel');
  if (!element) {
    throw new Error('Toast panel is not mounted');
  }
  return element;
}

function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('ToastPanel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetToastsForTests();
  });

  afterEach(() => {
    act(() => {
      __resetToastsForTests();
    });
    jest.useRealTimers();
  });

  it('mounts on the first toast and shows the newest message on the bar', () => {
    const { container } = render(<ToastPanel />);
    expect(container.querySelector('.toast-panel')).toBeNull();

    act(() => {
      showToast({ message: 'First' });
      showToast({ message: 'Second' });
    });

    const current = panel(container).querySelector('.toast-panel__current');
    expect(current).toHaveTextContent('Second');
    expect(current).toHaveAttribute('title', 'Second');
    expect(panel(container)).not.toHaveClass('is-offscreen');
  });

  it('collapses and expands from the double chevron', () => {
    const { container } = render(<ToastPanel />);
    act(() => {
      showToast({ message: 'Hello' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Hide notifications' }));
    expect(panel(container)).toHaveClass('is-collapsed');
    expect(panel(container).querySelector('.fa-angles-right')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show notifications' }));
    expect(panel(container)).not.toHaveClass('is-collapsed');
    expect(panel(container).querySelector('.fa-angles-left')).not.toBeNull();
  });

  it('auto-collapses 12 seconds after the newest toast and re-expands for a new one', () => {
    const { container } = render(<ToastPanel />);
    act(() => {
      showToast({ message: 'Hello' });
    });

    advance(TOAST_AUTO_COLLAPSE_MS - 1);
    expect(panel(container)).not.toHaveClass('is-collapsed');
    advance(1);
    expect(panel(container)).toHaveClass('is-collapsed');

    act(() => {
      showToast({ message: 'Another' });
    });
    expect(panel(container)).not.toHaveClass('is-collapsed');
  });

  it('opens the history list newest first with local times', () => {
    const { container } = render(<ToastPanel />);
    act(() => {
      showToast({ message: 'Older' });
    });
    advance(60_000);
    act(() => {
      showToast({ message: 'Newer' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show notification history' }));
    expect(panel(container)).toHaveClass('is-list-open');
    expect(panel(container).querySelector('.toast-panel__current')).toBeNull();

    const rows = Array.from(panel(container).querySelectorAll('.toast-panel__row'));
    expect(rows.map((row) => row.querySelector('.toast-panel__row-message')?.textContent)).toEqual(['Newer', 'Older']);
    const [newest] = getToasts().slice(-1);
    const expectedTime = new Date(newest.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(rows[0].querySelector('time')).toHaveTextContent(expectedTime);

    expect(screen.getByRole('list', { name: 'Recent Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show notification history' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide notifications' })).toBeNull();
    const closeList = screen.getByRole('button', { name: 'Hide notification history' });
    expect(closeList).toHaveFocus();
    expect(closeList.querySelector('.fa-angles-down')).not.toBeNull();

    fireEvent.click(closeList);
    expect(panel(container)).not.toHaveClass('is-list-open');
    expect(screen.queryByRole('heading', { name: 'Recent Notifications' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show notification history' })).toHaveFocus();
  });

  it('opens the history list from the message and closes it on an outside click', () => {
    const onClick = jest.fn();
    const { container } = render(<ToastPanel />);
    act(() => {
      showToast({ message: 'Sync done', action: { label: 'Refresh', onClick } });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(panel(container)).not.toHaveClass('is-list-open');

    fireEvent.click(panel(container).querySelector('.toast-panel__current-message') as HTMLElement);
    expect(panel(container)).toHaveClass('is-list-open');

    fireEvent.pointerDown(panel(container).querySelector('.toast-panel__row') as HTMLElement);
    expect(panel(container)).toHaveClass('is-list-open');

    fireEvent.pointerDown(document.body);
    expect(panel(container)).not.toHaveClass('is-list-open');

    fireEvent.click(panel(container).querySelector('.toast-panel__current-message') as HTMLElement);
    fireEvent.click(screen.getByRole('heading', { name: 'Recent Notifications' }));
    expect(panel(container)).not.toHaveClass('is-list-open');
  });

  it('shows the radiation icon only for warning and error toasts', () => {
    const { container } = render(<ToastPanel />);
    act(() => {
      showToast({ message: 'Plain' });
      showToast({ message: 'Careful', tone: 'warning' });
      showToast({ message: 'Broken', tone: 'error' });
      showToast({ message: 'Done', tone: 'success' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show notification history' }));
    const iconsByMessage = Array.from(panel(container).querySelectorAll('.toast-panel__row')).map((row) => [
      row.querySelector('.toast-panel__row-message')?.textContent?.replace(/^(Warning|Error): /, ''),
      row.querySelector('.fa-radiation') !== null,
    ]);
    expect(iconsByMessage).toEqual([
      ['Done', false],
      ['Broken', true],
      ['Careful', true],
      ['Plain', false],
    ]);
  });

  it('appends the repeat count when a toast merges', () => {
    const { container } = render(<ToastPanel />);
    act(() => {
      showToast({ message: 'Saved' });
      showToast({ message: 'Saved' });
      showToast({ message: 'Saved' });
    });

    expect(panel(container).querySelector('.toast-panel__repeat')).toHaveTextContent('(x3)');
    expect(panel(container).querySelector('.toast-panel__current')).toHaveAttribute('title', 'Saved (x3)');
  });

  it('renders a toast action button', () => {
    const onClick = jest.fn();
    render(<ToastPanel />);
    act(() => {
      showToast({ message: 'Sync done', action: { label: 'Refresh', onClick } });
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders link segments and several actions without opening the history list', () => {
    const onLink = jest.fn();
    const onMove = jest.fn();
    const onMute = jest.fn();
    const { container } = render(<ToastPanel />);
    act(() => {
      showToast({
        message: 'Opened in the panel window.',
        segments: ['Opened in the ', { text: 'panel window', onClick: onLink }, '.'],
        actions: [
          { label: 'Move it here', onClick: onMove },
          { label: 'Got it!', onClick: onMute },
        ],
      });
    });

    const current = panel(container).querySelector('.toast-panel__current') as HTMLElement;
    expect(current).toHaveTextContent('Opened in the panel window.');
    expect(current).toHaveAttribute('title', 'Opened in the panel window.');

    fireEvent.click(screen.getByRole('button', { name: 'panel window' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move it here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Got it!' }));
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMute).toHaveBeenCalledTimes(1);
    expect(panel(container)).not.toHaveClass('is-list-open');
  });

  it('pauses expiry while expanded and unmounts after the last toast expires', () => {
    const { container } = render(<ToastPanel />);
    act(() => {
      showToast({ message: 'Linger' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show notification history' }));
    expect(screen.queryByRole('button', { name: 'Hide notifications' })).toBeNull();
    advance(TOAST_LIFETIME_MS * 2);
    expect(getToasts()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Hide notification history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide notifications' }));
    advance(TOAST_LIFETIME_MS);
    expect(getToasts()).toHaveLength(0);
    expect(panel(container)).toHaveClass('is-offscreen');

    advance(1_000);
    expect(container.querySelector('.toast-panel')).toBeNull();
  });
});
