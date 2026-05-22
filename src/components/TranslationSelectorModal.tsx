import React from 'react';
import type { MultiValue } from 'react-select';
import type { TranslationSelectOption } from '../App';
import TranslationSelector from './TranslationSelector';

interface TranslationSelectorModalProps {
  translationSelectOptions: TranslationSelectOption[];
  selectedTranslationOptions: TranslationSelectOption[];
  handleTranslationSelectionChange: (selected: MultiValue<TranslationSelectOption>) => void | Promise<void>;
  closeTranslationModal: () => void;
}

const TranslationSelectorModal: React.FC<TranslationSelectorModalProps> = ({
  translationSelectOptions,
  selectedTranslationOptions,
  handleTranslationSelectionChange,
  closeTranslationModal
}) => (
  <div
    className="modal fade"
    id="translationSelectorModal"
    tabIndex={-1}
    aria-labelledby="translationSelectorModalLabel"
    aria-hidden="true"
  >
    <div className="modal-dialog modal-dialog-centered">
      <div className="modal-content shadow">
        <div className="modal-header">
          <h2 className="modal-title h5 mb-0" id="translationSelectorModalLabel">
            Select Translations
          </h2>
          <button
            type="button"
            className="btn-close"
            data-bs-dismiss="modal"
            aria-label="Close"
            onClick={closeTranslationModal}
          ></button>
        </div>
        <div className="modal-body">
          <TranslationSelector
            inputId="translationSelectorModalInput"
            options={translationSelectOptions}
            value={selectedTranslationOptions}
            onChange={handleTranslationSelectionChange}
          />
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            data-bs-dismiss="modal"
            onClick={closeTranslationModal}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
);

export default TranslationSelectorModal;
