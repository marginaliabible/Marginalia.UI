import { copyRichTextToClipboard } from './copyRichTextToClipboard';

class FakeClipboardItem {
  constructor(public readonly items: Record<string, Blob>) {}
}

describe('copyRichTextToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalClipboardItem = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    (globalThis as { ClipboardItem: typeof ClipboardItem }).ClipboardItem =
      FakeClipboardItem as unknown as typeof ClipboardItem;
    document.execCommand = jest.fn(() => false);
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    if (originalClipboardItem) {
      (globalThis as { ClipboardItem: typeof ClipboardItem }).ClipboardItem = originalClipboardItem;
    } else {
      delete (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    }
    document.execCommand = originalExecCommand;
  });

  it('returns true when clipboard.write succeeds', async () => {
    const write = jest.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText: jest.fn() },
    });

    await expect(copyRichTextToClipboard('plain', '<b>html</b>')).resolves.toBe(true);
    expect(write).toHaveBeenCalled();
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('returns false when every clipboard path fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: jest.fn(async () => {
          throw new Error('denied');
        }),
        writeText: jest.fn(async () => {
          throw new Error('denied');
        }),
      },
    });
    document.execCommand = jest.fn(() => false);

    await expect(copyRichTextToClipboard('plain', '<b>html</b>')).resolves.toBe(false);
  });

  it('falls back to execCommand when clipboard.write is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: jest.fn(async () => {
          throw new Error('denied');
        }),
        writeText: jest.fn(),
      },
    });
    document.execCommand = jest.fn(() => true);

    await expect(copyRichTextToClipboard('plain', '<b>html</b>')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});
