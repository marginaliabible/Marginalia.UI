import React from 'react';
import type { MultiValue } from 'react-select';
import type { TranslationSelectOption } from '../App';
import TranslationSelector from './TranslationSelector';
import LanguageTagSelector from './LanguageTagSelector';

interface SettingsModalProps {
  theme: string;
  handleThemeToggle: (e: React.ChangeEvent<HTMLInputElement>) => void;
  selectedLanguages: string[];
  handleLanguagesChange: (selected: string[]) => void;
  languageOptions: { code: string; count: number }[];
  getLanguageDisplayName: (code: string) => string;
  selectedTranslationIds: string[];
  translationSelectOptions: TranslationSelectOption[];
  selectedTranslationOptions: TranslationSelectOption[];
  handleTranslationSelectionChange: (selected: MultiValue<TranslationSelectOption>) => void | Promise<void>;
  closeSettingsModal: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  theme,
  handleThemeToggle,
  selectedLanguages,
  handleLanguagesChange,
  languageOptions,
  getLanguageDisplayName,
  selectedTranslationIds,
  translationSelectOptions,
  selectedTranslationOptions,
  handleTranslationSelectionChange,
  closeSettingsModal,
}) => (
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
          <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
            <div className="d-flex flex-column">
              <span className="text-body-secondary small text-uppercase fw-semibold">
                Appearance
              </span>
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
          </section>

          <section>
            <div className="d-flex align-items-baseline justify-content-between gap-2 mb-2">
              <div className="d-flex flex-column">
                <span className="text-body-secondary small text-uppercase fw-semibold">
                  Translations
                </span>
                <span className="fw-semibold">Active translations</span>
                <span className="text-body-secondary small">
                  Add or remove translations for the verse view.
                </span>
              </div>
              <span className="badge bg-primary-subtle text-primary-emphasis">
                {selectedTranslationIds.length} selected
              </span>
            </div>
            <TranslationSelector
              inputId="settingsTranslationSelectorInput"
              options={translationSelectOptions}
              value={selectedTranslationOptions}
              onChange={handleTranslationSelectionChange}
              label=""
            />
          </section>

          <section>
            <div className="d-flex align-items-baseline justify-content-between gap-2 mb-2">
              <div className="d-flex flex-column">
                <span className="text-body-secondary small text-uppercase fw-semibold">
                  Languages
                </span>
                <span className="fw-semibold">Available translations</span>
                <span className="text-body-secondary small">
                  Choose which languages to show.
                </span>
              </div>
              <span className="badge bg-primary-subtle text-primary-emphasis">
                {selectedLanguages.length} selected
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
        </div>
        <div className="modal-footer">
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

export default SettingsModal;
