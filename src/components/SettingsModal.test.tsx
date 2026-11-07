import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsModal from './SettingsModal';
import { HelpTourProvider } from '../help/HelpTourContext';

jest.mock('./LanguageTagSelector', () => () => null);

const mockGetAppVersion = jest.fn(() => 'v2026.11.00-a1b2c3d');
const mockGetAppGitSha = jest.fn(() => 'a1b2c3d4e5f67890');

jest.mock('../services/appBuildIdentity', () => ({
  getAppVersion: () => mockGetAppVersion(),
  getAppGitSha: () => mockGetAppGitSha(),
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
  const startTour = jest.fn();

  const renderModal = (props: Partial<typeof defaultProps> = {}) => render(
    <HelpTourProvider startTour={startTour} startTourAtTarget={jest.fn()}>
      <SettingsModal {...defaultProps} {...props} />
    </HelpTourProvider>
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppVersion.mockReturnValue('v2026.11.00-a1b2c3d');
    mockGetAppGitSha.mockReturnValue('a1b2c3d4e5f67890');
  });

  it('points to File Sync > Subscriptions instead of managing sources inline', () => {
    renderModal();

    expect(screen.getByText('File Sync > Subscriptions')).toBeTruthy();
    expect(screen.queryByLabelText('Source URL')).toBeNull();
  });

  it('links beta versions to the release tag and copies the full git sha', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderModal();

    const versionLink = screen.getByRole('link', { name: 'v2026.11.00-a1b2c3d', hidden: true });
    expect(versionLink.getAttribute('href')).toBe(
      'https://github.com/marginaliabible/Marginalia.UI/releases/tag/v2026.11.00'
    );
    fireEvent.click(screen.getByLabelText('Copy commit SHA', { hidden: true }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('a1b2c3d4e5f67890'));
  });

  it('links prod versions without a copy button', () => {
    mockGetAppVersion.mockReturnValue('v2026.11.00');
    mockGetAppGitSha.mockReturnValue('a1b2c3d4e5f67890');

    renderModal();

    const versionLink = screen.getByRole('link', { name: 'v2026.11.00', hidden: true });
    expect(versionLink.getAttribute('href')).toBe(
      'https://github.com/marginaliabible/Marginalia.UI/releases/tag/v2026.11.00'
    );
    expect(screen.queryByLabelText('Copy commit SHA', { hidden: true })).toBeNull();
  });

  it('starts the settings tour from the header help button', () => {
    renderModal();

    fireEvent.click(screen.getByLabelText('Show me how: Settings', { hidden: true }));
    expect(startTour).toHaveBeenCalledWith('open-settings');
  });
});
