import { render, waitFor } from '@testing-library/react';
import TranslationsPanel from './TranslationsPanel';
import { bibleService } from '../services/bibleService';
import type { PanelTab } from '../models/tab';
import type { TranslationRecord } from '../models/bible';

jest.mock('../services/bibleService', () => ({
  bibleService: {
    loadVerseText: jest.fn(),
  },
}));

const translationsTab: PanelTab = {
  id: 'tab-translations-1',
  type: 'translations',
  title: 'Translations',
  iconClass: 'fa-solid fa-language',
  verseContext: { book: 'Genesis', chapter: 1, verse: 1 },
  createdAt: 1,
  updatedAt: 1,
};

const translationRecords: TranslationRecord[] = [
  { id: 'KJV', starred: true },
];

const noop = () => {};

describe('TranslationsPanel visibility gating', () => {
  beforeEach(() => {
    (bibleService.loadVerseText as jest.Mock).mockReset();
    (bibleService.loadVerseText as jest.Mock).mockResolvedValue('In the beginning');
  });

  it('does not load verse texts while the tab is inactive', () => {
    render(
      <TranslationsPanel
        tab={translationsTab}
        isActive={false}
        translationRecords={translationRecords}
        translationMetadataById={new Map()}
        addableTranslations={[]}
        onAddTranslation={noop}
        onRemoveTranslation={noop}
        onToggleStar={noop}
        onReorder={noop}
      />
    );

    expect(bibleService.loadVerseText).not.toHaveBeenCalled();
  });

  it('does not reload while inactive when verseContext changes', async () => {
    const { rerender } = render(
      <TranslationsPanel
        tab={translationsTab}
        isActive={true}
        translationRecords={translationRecords}
        translationMetadataById={new Map()}
        addableTranslations={[]}
        onAddTranslation={noop}
        onRemoveTranslation={noop}
        onToggleStar={noop}
        onReorder={noop}
      />
    );

    await waitFor(() => {
      expect(bibleService.loadVerseText).toHaveBeenCalled();
    });

    rerender(
      <TranslationsPanel
        tab={{ ...translationsTab, verseContext: { book: 'Romans', chapter: 10, verse: 9 } }}
        isActive={false}
        translationRecords={translationRecords}
        translationMetadataById={new Map()}
        onAddTranslation={noop}
        onRemoveTranslation={noop}
        onToggleStar={noop}
        onReorder={noop}
        addableTranslations={[]}
      />
    );

    expect(bibleService.loadVerseText).not.toHaveBeenCalledWith('KJV', 'Romans', 10, 9);
  });

  it('loads the selected verse when the tab becomes active', async () => {
    const { rerender } = render(
      <TranslationsPanel
        tab={{ ...translationsTab, verseContext: { book: 'Romans', chapter: 10, verse: 9 } }}
        isActive={false}
        translationRecords={translationRecords}
        translationMetadataById={new Map()}
        addableTranslations={[]}
        onAddTranslation={noop}
        onRemoveTranslation={noop}
        onToggleStar={noop}
        onReorder={noop}
      />
    );

    expect(bibleService.loadVerseText).not.toHaveBeenCalled();

    rerender(
      <TranslationsPanel
        tab={{ ...translationsTab, verseContext: { book: 'Romans', chapter: 10, verse: 9 } }}
        isActive={true}
        translationRecords={translationRecords}
        translationMetadataById={new Map()}
        addableTranslations={[]}
        onAddTranslation={noop}
        onRemoveTranslation={noop}
        onToggleStar={noop}
        onReorder={noop}
      />
    );

    await waitFor(() => {
      expect(bibleService.loadVerseText).toHaveBeenCalledWith('KJV', 'Romans', 10, 9);
    });
  });

  it('loads every selected verse for each translation', async () => {
    (bibleService.loadVerseText as jest.Mock).mockImplementation(async (
      _id: string,
      _book: string,
      _chapter: number,
      verse: number
    ) => `text ${verse}`);

    const { findByText } = render(
      <TranslationsPanel
        tab={{
          ...translationsTab,
          verseContext: { book: 'Genesis', chapter: 1, verse: 1, verses: [1, 2] },
        }}
        isActive={true}
        translationRecords={translationRecords}
        translationMetadataById={new Map()}
        addableTranslations={[]}
        onAddTranslation={noop}
        onRemoveTranslation={noop}
        onToggleStar={noop}
        onReorder={noop}
      />
    );

    await waitFor(() => {
      expect(bibleService.loadVerseText).toHaveBeenCalledWith('KJV', 'Genesis', 1, 1);
      expect(bibleService.loadVerseText).toHaveBeenCalledWith('KJV', 'Genesis', 1, 2);
    });

    expect(await findByText('Genesis 1:1-2')).toBeTruthy();
    expect(await findByText('text 1')).toBeTruthy();
    expect(await findByText('text 2')).toBeTruthy();
  });
});
