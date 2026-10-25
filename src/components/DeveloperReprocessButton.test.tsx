import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeveloperReprocessButton from './DeveloperReprocessButton';
import { requestDocumentReprocess } from '../services/cloudControlService';
import {
  __resetDeveloperToolsForTests,
  isDeveloperToolsEnabled,
} from '../services/developerToolsService';
import { __resetToastsForTests, getToasts } from '../services/toastService';

jest.mock('../services/cloudControlService', () => ({
  requestDocumentReprocess: jest.fn(async () => undefined),
  fetchDeveloperCapabilities: jest.fn(async () => ({ ok: true, isDeveloper: false })),
}));

jest.mock('../services/developerToolsService', () => ({
  isDeveloperToolsEnabled: jest.fn(() => true),
  ensureDeveloperCapabilities: jest.fn(async () => true),
  subscribeDeveloperTools: () => () => undefined,
  __resetDeveloperToolsForTests: jest.fn(),
}));

const mockReprocess = requestDocumentReprocess as jest.MockedFunction<typeof requestDocumentReprocess>;
const mockIsDeveloper = isDeveloperToolsEnabled as jest.MockedFunction<typeof isDeveloperToolsEnabled>;

describe('DeveloperReprocessButton', () => {
  beforeEach(() => {
    mockReprocess.mockReset();
    mockReprocess.mockResolvedValue(undefined);
    mockIsDeveloper.mockReturnValue(true);
    window.confirm = jest.fn(() => true);
    __resetToastsForTests();
    __resetDeveloperToolsForTests();
  });

  afterEach(() => {
    __resetToastsForTests();
  });

  it('does not render when developer tools are off', () => {
    mockIsDeveloper.mockReturnValue(false);
    const { container } = render(
      <DeveloperReprocessButton
        userId="dev@example.com"
        provider="google"
        documentId="doc-1"
        documentLabel="Notes.pdf"
        processed
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('is disabled when the document is not processed', () => {
    render(
      <DeveloperReprocessButton
        userId="dev@example.com"
        provider="google"
        documentId="doc-1"
        documentLabel="Notes.pdf"
        processed={false}
      />
    );
    const button = screen.getByRole('button', { name: 'Blow away and reprocess Notes.pdf' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Blow away and reprocess is only available for processed documents');
    fireEvent.click(button);
    expect(mockReprocess).not.toHaveBeenCalled();
  });

  it('confirms then asks CloudControlService to reprocess', async () => {
    render(
      <DeveloperReprocessButton
        userId="dev@example.com"
        provider="google"
        documentId="doc-1"
        documentLabel="Notes.pdf"
        fileName="Notes.pdf"
        processed
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Blow away and reprocess Notes.pdf' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(getToasts().map((toast) => toast.message)).toEqual([
      '"Notes.pdf" will be blown away and restarted.',
    ]);
    await waitFor(() => {
      expect(mockReprocess).toHaveBeenCalledWith({
        userId: 'dev@example.com',
        provider: 'google',
        documentId: 'doc-1',
        fileName: 'Notes.pdf',
      });
    });
  });

  it('does nothing when the confirmation is cancelled', () => {
    window.confirm = jest.fn(() => false);
    render(
      <DeveloperReprocessButton
        userId="dev@example.com"
        provider="google"
        documentId="doc-1"
        documentLabel="Notes.pdf"
        processed
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Blow away and reprocess Notes.pdf' }));
    expect(mockReprocess).not.toHaveBeenCalled();
    expect(getToasts()).toEqual([]);
  });
});
