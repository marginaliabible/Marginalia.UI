import { noteCcsAuthFailure, promptBrokerSessionRequired, __resetBrokerSessionPromptForTests, registerAccountSyncOpener, isBrokerSessionRequired, clearBrokerSessionRequired } from './brokerSessionPrompt';
import { __resetToastsForTests, getToasts } from './toastService';

describe('brokerSessionPrompt', () => {
  beforeEach(() => {
    __resetBrokerSessionPromptForTests();
    __resetToastsForTests();
  });

  afterEach(() => {
    __resetToastsForTests();
    __resetBrokerSessionPromptForTests();
  });

  it('toasts once for session_required and ignores repeats as the same toast', () => {
    expect(noteCcsAuthFailure(401, JSON.stringify({ error: 'session_required' }))).toBe(true);
    expect(noteCcsAuthFailure(401, JSON.stringify({ error: 'session_required' }))).toBe(true);
    expect(isBrokerSessionRequired()).toBe(true);
    expect(getToasts().map((toast) => toast.message)).toEqual(['Sign in again to continue.']);
  });

  it('ignores other CCS errors', () => {
    expect(noteCcsAuthFailure(409, JSON.stringify({ error: 'not_processed' }))).toBe(false);
    expect(noteCcsAuthFailure(500, 'boom')).toBe(false);
    expect(isBrokerSessionRequired()).toBe(false);
    expect(getToasts()).toEqual([]);
  });

  it('opens Account Sync from the toast action', () => {
    const open = jest.fn();
    registerAccountSyncOpener(open);
    promptBrokerSessionRequired();
    getToasts()[0]?.action?.onClick();
    expect(open).toHaveBeenCalled();
  });

  it('clears the flag after a successful sign-in', () => {
    promptBrokerSessionRequired();
    clearBrokerSessionRequired();
    expect(isBrokerSessionRequired()).toBe(false);
    expect(getToasts()).toEqual([]);
  });
});
