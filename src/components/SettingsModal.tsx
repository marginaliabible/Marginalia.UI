import LanguageTagSelector from './LanguageTagSelector';

interface SettingsModalProps {
  theme: string;
  handleThemeToggle: (e: React.ChangeEvent<HTMLInputElement>) => void;
  translatorItalics: boolean;
  handleTranslatorItalicsToggle: (e: React.ChangeEvent<HTMLInputElement>) => void;
  translatorParagraphMarks: boolean;
  handleTranslatorParagraphMarksToggle: (e: React.ChangeEvent<HTMLInputElement>) => void;
  selectedLanguages: string[];
  handleLanguagesChange: (selected: string[]) => void;
  languageOptions: { code: string; count: number }[];
  getLanguageDisplayName: (code: string) => string;
  closeSettingsModal: () => void;
  userId?: string | null;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  theme,
  handleThemeToggle,
  translatorItalics,
  handleTranslatorItalicsToggle,
  translatorParagraphMarks,
  handleTranslatorParagraphMarksToggle,
  selectedLanguages,
  handleLanguagesChange,
  languageOptions,
  getLanguageDisplayName,
  closeSettingsModal,
  userId,
}) => {
  return (
    <div
      className="modal fade"
      id="settingsModal"
      tabIndex={-1}
      aria-labelledby="settingsModalLabel"
      aria-hidden="true"
    >
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content shadow">
          <div className="modal-header">
            <h2
              className="modal-title h5 mb-0 d-flex align-items-center gap-2"
              id="settingsModalLabel"
            >
              <i className="bi bi-gear" aria-hidden="true"></i>
              Settings
            </h2>
            <button
              type="button"
              className="btn-close"
              data-bs-dismiss="modal"
              aria-label="Close"
              onClick={closeSettingsModal}
            ></button>
          </div>
          <div className="modal-body d-flex flex-column gap-4">
            <section className="d-flex flex-column gap-3">
              <div className="d-flex flex-column">
                <span className="text-body-secondary small text-uppercase fw-semibold">
                  Appearance
                </span>
              </div>

              <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Theme</span>
                  <span className="text-body-secondary small">
                    Defaults to your browser preference.
                  </span>
                </div>
                <div className="form-check form-switch settings-theme-toggle mb-0 d-flex align-items-center gap-2">
                  <input
                    id="themeToggle"
                    className="form-check-input flex-shrink-0"
                    type="checkbox"
                    role="switch"
                    aria-checked={theme === 'dark'}
                    checked={theme === 'dark'}
                    onChange={handleThemeToggle}
                    aria-label="Toggle dark mode"
                  />
                  <label className="form-check-label fw-semibold small mb-0" htmlFor="themeToggle">
                    {theme === 'dark' ? 'Dark mode' : 'Light mode'}
                  </label>
                </div>
              </div>

              <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Italicize words added by the translator</span>
                  <span className="text-body-secondary small">
                    Applies to translations that mark supplied words with brackets.
                  </span>
                </div>
                <div className="form-check form-switch settings-theme-toggle mb-0 d-flex align-items-center gap-2">
                  <input
                    id="translatorItalicsToggle"
                    className="form-check-input flex-shrink-0"
                    type="checkbox"
                    role="switch"
                    aria-checked={translatorItalics}
                    checked={translatorItalics}
                    onChange={handleTranslatorItalicsToggle}
                    aria-label="Italicize words added by the translator"
                  />
                  <label className="form-check-label fw-semibold small mb-0" htmlFor="translatorItalicsToggle">
                    {translatorItalics ? 'On' : 'Off'}
                  </label>
                </div>
              </div>

              <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
                <div className="d-flex flex-column">
                  <span className="fw-semibold">Show paragraph marks added by the translator</span>
                  <span className="text-body-secondary small">
                    Applies to translations that mark paragraph starts with a hash.
                  </span>
                </div>
                <div className="form-check form-switch settings-theme-toggle mb-0 d-flex align-items-center gap-2">
                  <input
                    id="translatorParagraphMarksToggle"
                    className="form-check-input flex-shrink-0"
                    type="checkbox"
                    role="switch"
                    aria-checked={translatorParagraphMarks}
                    checked={translatorParagraphMarks}
                    onChange={handleTranslatorParagraphMarksToggle}
                    aria-label="Show paragraph marks added by the translator"
                  />
                  <label className="form-check-label fw-semibold small mb-0" htmlFor="translatorParagraphMarksToggle">
                    {translatorParagraphMarks ? 'On' : 'Off'}
                  </label>
                </div>
              </div>
            </section>

            <section>
              <div className="d-flex align-items-baseline gap-3 mb-2">
                <div className="d-flex flex-column">
                  <span className="text-body-secondary small text-uppercase fw-semibold">
                    Languages
                  </span>
                </div>
                <span className="badge bg-primary-subtle text-primary-emphasis">
                  {selectedLanguages.length} selected
                </span>
              </div>
              <div className="d-flex flex-column gap-1 mb-2">
                <span className="fw-semibold">Available translations</span>
                <span className="text-body-secondary small">
                  Choose which languages to show.
                </span>
              </div>
              <LanguageTagSelector
                languageOptions={languageOptions}
                selectedLanguages={selectedLanguages}
                onChange={handleLanguagesChange}
                getLanguageDisplayName={getLanguageDisplayName}
              />
              <p id="languageSelectHelp" className="form-text small mb-0 mt-2">
                Selected languages filter the translation dropdown. Defaults follow your browser
                language plus Biblical Hebrew and Ancient Greek.
              </p>
            </section>

            <section>
              <div className="d-flex flex-column mb-2">
                <span className="text-body-secondary small text-uppercase fw-semibold">
                  Sources
                </span>
              </div>
              <p className="text-body-secondary small mb-0">
                Libraries, translations, and resources are now managed under
                {' '}<span className="fw-semibold">Account Sync &gt; Subscriptions</span>.
              </p>
            </section>
          </div>
          <div className="modal-footer d-flex align-items-center">
            {userId && (
              <span className="text-body-secondary small font-monospace me-auto" title="Internal reference ID; share with support if asked.">
                User ID: {userId}
              </span>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              data-bs-dismiss="modal"
              onClick={closeSettingsModal}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
