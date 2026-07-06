import { useRef, useState } from 'react';
import LanguageTagSelector from './LanguageTagSelector';
import type { ArtifactType, RepositoryType } from '../models/bible';
import type { SourceArtifactInventory, SourceArtifactSummary, SourceLibraryRecord } from '../services/bibleService';

interface SettingsModalProps {
  theme: string;
  handleThemeToggle: (e: React.ChangeEvent<HTMLInputElement>) => void;
  selectedLanguages: string[];
  handleLanguagesChange: (selected: string[]) => void;
  languageOptions: { code: string; count: number }[];
  getLanguageDisplayName: (code: string) => string;
  sourceUrls: string[];
  sourceArtifactSummary: SourceArtifactSummary;
  sourceLibraries: SourceLibraryRecord[];
  sourceArtifactInventory: SourceArtifactInventory | null;
  onLoadSourceDiagnostics: () => Promise<void>;
  onRefreshSources: () => Promise<void>;
  onRequestGitHubAuth: () => void;
  isSourceDiagnosticsLoading: boolean;
  onAddSourceUrl: (url: string) => Promise<{ ok: boolean; message: string; suggestGitHubAuth?: boolean }>;
  onRemoveSourceUrl: (url: string) => void;
  closeSettingsModal: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  theme,
  handleThemeToggle,
  selectedLanguages,
  handleLanguagesChange,
  languageOptions,
  getLanguageDisplayName,
  sourceUrls,
  sourceArtifactSummary,
  sourceLibraries,
  sourceArtifactInventory,
  onLoadSourceDiagnostics,
  onRefreshSources,
  onRequestGitHubAuth,
  isSourceDiagnosticsLoading,
  onAddSourceUrl,
  onRemoveSourceUrl,
  closeSettingsModal,
}) => {
  const diagnosticsRef = useRef<HTMLDetailsElement | null>(null);
  const [sourceUrlInput, setSourceUrlInput] = useState('');
  const [sourceInputError, setSourceInputError] = useState<string | null>(null);
  const [sourceInputSuccess, setSourceInputSuccess] = useState<string | null>(null);
  const [sourceSuggestGitHubAuth, setSourceSuggestGitHubAuth] = useState(false);
  const [isValidatingSource, setIsValidatingSource] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);

  const collapseDiagnostics = () => {
    setIsDiagnosticsOpen(false);
    if (diagnosticsRef.current) {
      diagnosticsRef.current.open = false;
    }
  };

  const formatArtifactType = (value: ArtifactType): string => {
    if (value === 'translation') {
      return 'Translation';
    }
    if (value === 'translation-library') {
      return 'Translation Library';
    }
    return 'Resource Library';
  };

  const formatRepositoryType = (value: RepositoryType): string => {
    if (value === 'github-public') {
      return 'GitHub Public';
    }
    if (value === 'github-private') {
      return 'GitHub Private';
    }
    if (value === 'hosted') {
      return 'Hosted';
    }
    return 'Local';
  };

  const diagnosticsItems = sourceArtifactInventory?.items ?? [];

  const isHttpUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleAddSourceUrl = async () => {
    const next = sourceUrlInput.trim();
    if (!next) {
      setSourceInputError('Enter a URL to add a source.');
      setSourceInputSuccess(null);
      setSourceSuggestGitHubAuth(false);
      return;
    }

    if (!isHttpUrl(next)) {
      setSourceInputError('Source URL must start with http:// or https://');
      setSourceInputSuccess(null);
      setSourceSuggestGitHubAuth(false);
      return;
    }

    if (sourceUrls.includes(next)) {
      setSourceInputError('That source URL is already saved.');
      setSourceInputSuccess(null);
      setSourceSuggestGitHubAuth(false);
      return;
    }

    setIsValidatingSource(true);
    const result = await onAddSourceUrl(next);
    setIsValidatingSource(false);

    if (!result.ok) {
      setSourceInputError(result.message);
      setSourceInputSuccess(null);
      setSourceSuggestGitHubAuth(Boolean(result.suggestGitHubAuth));
      return;
    }

    setSourceInputError(null);
    setSourceInputSuccess(result.message);
    setSourceSuggestGitHubAuth(false);
    setSourceUrlInput('');
    collapseDiagnostics();
  };

  const handleGitHubAuthLinkClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onRequestGitHubAuth();
  };

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
              <div className="d-flex align-items-baseline gap-3 mb-2">
                <div className="d-flex flex-column">
                  <span className="text-body-secondary small text-uppercase fw-semibold">
                    Sources
                  </span>
                </div>
                <span className="badge bg-secondary-subtle text-secondary-emphasis">
                  {sourceUrls.length} saved
                </span>
              </div>
              <div className="d-flex flex-column gap-1 mb-2">
                  <span className="fw-semibold">Saved source URLs</span>
                  <span className="text-body-secondary small">
                    Add multiple URLs and remove them later as needed.
                  </span>
              </div>
              <div className="d-flex flex-wrap gap-2 mb-3">
                <span className="badge bg-primary-subtle text-primary-emphasis">
                  Translations: {sourceArtifactSummary.translation}
                </span>
                <span className="badge bg-info-subtle text-info-emphasis">
                  Translation libraries: {sourceArtifactSummary.translationLibrary}
                </span>
                <span className="badge bg-success-subtle text-success-emphasis">
                  Resource libraries: {sourceArtifactSummary.resourceLibrary}
                </span>
              </div>

              <div className="d-flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  onClick={() => {
                    void onRefreshSources();
                  }}
                >
                  Refresh sources
                </button>
              </div>

              <div className="input-group mb-3">
                <input
                  type="url"
                  className="form-control"
                  value={sourceUrlInput}
                  onChange={(event) => {
                    setSourceUrlInput(event.target.value);
                    if (sourceInputError) {
                      setSourceInputError(null);
                      setSourceSuggestGitHubAuth(false);
                    }
                    if (sourceInputSuccess) {
                      setSourceInputSuccess(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleAddSourceUrl();
                    }
                  }}
                  placeholder="https://example.com/source.json"
                  aria-label="Source URL"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    void handleAddSourceUrl();
                  }}
                  disabled={sourceUrlInput.trim().length === 0 || isValidatingSource}
                >
                  {isValidatingSource ? 'Validating...' : 'Add source'}
                </button>
              </div>

              {sourceInputError && (
                <div className="text-danger small mb-3">
                  <span>{sourceInputError}</span>
                  {sourceSuggestGitHubAuth && (
                    <>
                      {' '}
                      <a href="#" onClick={handleGitHubAuthLinkClick}>
                        Authenticate with GitHub
                      </a>
                    </>
                  )}
                </div>
              )}

              {sourceInputSuccess && (
                <p className="text-success small mb-3">{sourceInputSuccess}</p>
              )}

              {sourceUrls.length > 0 ? (
                <div className="list-group">
                  {sourceUrls.map((url) => (
                    <div
                      key={url}
                      className="list-group-item d-flex align-items-center justify-content-between gap-3"
                    >
                      <div className="text-truncate" title={url}>{url}</div>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm flex-shrink-0"
                        onClick={() => {
                          collapseDiagnostics();
                          onRemoveSourceUrl(url);
                        }}
                        aria-label={`Remove ${url}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-body-secondary small mb-0">No saved sources yet.</p>
              )}

              {sourceLibraries.length > 0 ? (
                <div className="mt-3 mb-3">
                  <span className="small text-body-secondary">
                    {sourceLibraries.length} libraries detected
                  </span>
                </div>
              ) : null}

              <details
                ref={diagnosticsRef}
                className="mt-3"
                onToggle={(event) => {
                  const details = event.currentTarget as HTMLDetailsElement;
                  setIsDiagnosticsOpen(details.open);
                  if (details.open && !sourceArtifactInventory && !isSourceDiagnosticsLoading) {
                    void onLoadSourceDiagnostics();
                  }
                }}
              >
                <summary className="small text-body-secondary settings-diagnostics-summary">
                  Diagnostics
                </summary>

                {isDiagnosticsOpen && (
                  <div className="mt-2">
                    {isSourceDiagnosticsLoading ? (
                      <p className="text-body-secondary small mb-0">Loading diagnostics...</p>
                    ) : (
                      <>
                        <div className="d-flex flex-wrap gap-2 mb-3">
                          <span className="badge bg-secondary-subtle text-secondary-emphasis">
                            Hosted: {sourceArtifactInventory?.repositorySummary.hosted ?? 0}
                          </span>
                          <span className="badge bg-secondary-subtle text-secondary-emphasis">
                            Local: {sourceArtifactInventory?.repositorySummary.local ?? 0}
                          </span>
                          <span className="badge bg-secondary-subtle text-secondary-emphasis">
                            GitHub public: {sourceArtifactInventory?.repositorySummary.githubPublic ?? 0}
                          </span>
                          <span className="badge bg-secondary-subtle text-secondary-emphasis">
                            GitHub private: {sourceArtifactInventory?.repositorySummary.githubPrivate ?? 0}
                          </span>
                        </div>

                        {diagnosticsItems.length > 0 ? (
                          <div className="table-responsive overflow-auto settings-diagnostics-table-wrap">
                            <table className="table table-sm table-striped mb-0 align-middle">
                              <thead className="position-sticky top-0 z-1">
                                <tr>
                                  <th scope="col">ID</th>
                                  <th scope="col">Type</th>
                                  <th scope="col">Repository</th>
                                </tr>
                              </thead>
                              <tbody>
                                {diagnosticsItems.map((item) => (
                                  <tr key={`${item.id}:${item.source}`}>
                                    <td className="text-truncate settings-diagnostics-id" title={`${item.id} - ${item.label}`}>
                                      {item.id}
                                    </td>
                                    <td>{formatArtifactType(item.artifactType)}</td>
                                    <td>{formatRepositoryType(item.repositoryType)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-body-secondary small mb-0">No diagnostics rows available.</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </details>
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
};

export default SettingsModal;
