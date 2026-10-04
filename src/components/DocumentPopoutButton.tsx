import React from 'react';
import { isDocumentWindow, isPanelWindow } from '../services/windowChannel';
import { usePopOutDocument } from '../hooks/useDocumentPopout';

const POP_OUT_LABEL = 'Pop into a new browser window';

const DocumentPopoutButton: React.FC = () => {
  const popOutDocument = usePopOutDocument();
  if (isDocumentWindow || isPanelWindow) {
    return null;
  }

  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary"
      onClick={popOutDocument}
      title={POP_OUT_LABEL}
      aria-label={POP_OUT_LABEL}
    >
      <i className="fa-solid fa-up-right-from-square" aria-hidden="true"></i>
    </button>
  );
};

export default DocumentPopoutButton;
