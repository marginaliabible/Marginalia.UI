import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsModal from './SettingsModal';

jest.mock('./LanguageTagSelector', () => () => null);

jest.mock('../services/appBuildIdentity', () => ({
  getAppVersion: () => 'v1.2.3-a1b2c3d',
  getAppGitSha: () => 'a1b2c3d4e5f67890',
}));

const defaultProps = {
  theme: 'light',
  handleThemeToggle: jest.fn(),
  translatorItalics: true,
  handleTranslatorItalicsToggle: jest.fn(),
  translatorParagraphMarks: true,
  handleTranslatorParagraphMarksToggle: jest.fn(),
  selectedLanguages: [] as string[],
  handleLanguagesChange: jest.fn(),
  languageOptions: [] as { code: string; count: number }[],
  getLanguageDisplayName: (code: string) => code,
  closeSettingsModal: jest.fn(),
};

describe('SettingsModal', () => {
  it('points to File Sync > Subscriptions instead of managing sources inline', () => {
    render(<SettingsModal {...defaultProps} />);

    expect(screen.getByText('File Sync > Subscriptions')).toBeTruthy();
    expect(screen.queryByLabelText('Source URL')).toBeNull();
  });

  it('shows the build version and copies the full git sha from the footer', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByText('v1.2.3-a1b2c3d')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Copy build identity'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('a1b2c3d4e5f67890'));
  });
});
