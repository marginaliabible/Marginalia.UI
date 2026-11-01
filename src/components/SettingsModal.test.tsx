import { render, screen } from '@testing-library/react';
import SettingsModal from './SettingsModal';

jest.mock('./LanguageTagSelector', () => () => null);

describe('SettingsModal', () => {
  it('points to File Sync > Subscriptions instead of managing sources inline', () => {
    render(
      <SettingsModal
        theme="light"
        handleThemeToggle={jest.fn()}
        translatorItalics
        handleTranslatorItalicsToggle={jest.fn()}
        translatorParagraphMarks
        handleTranslatorParagraphMarksToggle={jest.fn()}
        selectedLanguages={[]}
        handleLanguagesChange={jest.fn()}
        languageOptions={[]}
        getLanguageDisplayName={(code) => code}
        closeSettingsModal={jest.fn()}
      />
    );

    expect(screen.getByText('File Sync > Subscriptions')).toBeTruthy();
    expect(screen.queryByLabelText('Source URL')).toBeNull();
  });
});
