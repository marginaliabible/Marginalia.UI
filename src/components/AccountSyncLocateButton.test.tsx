import { fireEvent, render, screen } from '@testing-library/react';
import AccountSyncLocateButton from './AccountSyncLocateButton';
import { requestAccountSyncReveal } from '../services/accountSyncRevealService';
import { routeInteraction } from '../services/windowRouting';
import { showToast } from '../services/toastService';

jest.mock('../services/accountSyncRevealService', () => ({
  requestAccountSyncReveal: jest.fn(),
}));

jest.mock('../services/windowRouting', () => ({
  routeInteraction: jest.fn(),
}));

jest.mock('../services/toastService', () => ({
  showToast: jest.fn(),
}));

const routeMock = routeInteraction as jest.MockedFunction<typeof routeInteraction>;
const revealMock = requestAccountSyncReveal as jest.MockedFunction<typeof requestAccountSyncReveal>;
const toastMock = showToast as jest.MockedFunction<typeof showToast>;

describe('AccountSyncLocateButton', () => {
  beforeEach(() => {
    routeMock.mockReset().mockImplementation((_command, applyLocally) => {
      applyLocally();
      return 'local';
    });
    revealMock.mockReset().mockReturnValue(true);
    toastMock.mockReset();
  });

  it('routes a reveal-account-sync command to the Bible window', () => {
    render(
      <AccountSyncLocateButton
        syncItem={{ provider: 'google', itemId: 'file-1' }}
        subscriptionItem={null}
        documentLabel="Notes.pdf"
      />
    );

    fireEvent.click(screen.getByTitle('Find in Account Sync'));

    expect(routeMock).toHaveBeenCalledWith(
      {
        kind: 'bible',
        type: 'reveal-account-sync',
        payload: { kind: 'cloud', provider: 'google', itemId: 'file-1' },
      },
      expect.any(Function),
      { quiet: true }
    );
    expect(revealMock).toHaveBeenCalledWith({
      kind: 'cloud',
      provider: 'google',
      itemId: 'file-1',
    });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('toasts when Account Sync is unavailable locally', () => {
    revealMock.mockReturnValue(false);

    render(
      <AccountSyncLocateButton
        syncItem={{ provider: 'microsoft', itemId: 'drive-9' }}
        subscriptionItem={null}
        documentLabel="Study.docx"
      />
    );

    fireEvent.click(screen.getByTitle('Find in Account Sync'));

    expect(toastMock).toHaveBeenCalledWith({
      tone: 'error',
      message: "Couldn't open Account Sync to locate 'Study.docx'.",
    });
  });

  it('does not apply locally when the reveal was routed to another window', () => {
    routeMock.mockReturnValue('remote');

    render(
      <AccountSyncLocateButton
        syncItem={{ provider: 'google', itemId: 'file-1' }}
        subscriptionItem={null}
        documentLabel="Notes.pdf"
      />
    );

    fireEvent.click(screen.getByTitle('Find in Account Sync'));

    expect(revealMock).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
