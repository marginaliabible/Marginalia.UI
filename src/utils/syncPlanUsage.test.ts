import { computeSyncPlanUsage, splitUsageAtCap, sumCommittedSizes } from './syncPlanUsage';
import { PLAN_GIB } from './syncStoragePlans';

const DISCONNECTED_AT = '2026-10-01T00:00:00.000Z';
const BEFORE = '2026-09-30T00:00:00.000Z';
const AFTER = '2026-10-02T00:00:00.000Z';

describe('syncPlanUsage', () => {
  it('sums committed sizes', () => {
    expect(sumCommittedSizes([
      { type: 'del', size: 100, documentId: 'a', hash: 'aa' },
      { type: 'scan', size: 50, documentId: 'b', hash: 'bb' },
    ])).toBe(150);
  });

  it('clears mod/del committed size when a matching hash is staged selected', () => {
    const usage = computeSyncPlanUsage({
      committed: [
        { type: 'del', size: 80, documentId: 'doc-1', hash: 'AbCd' },
        { type: 'scan', size: 40, documentId: 'doc-1', hash: 'abcd' },
      ],
      publishedByDocumentId: new Map([['doc-1', 'abcd']]),
      stagedSelectedDocs: [{ documentId: 'doc-1', hash: 'abcd', provider: 'google', sizeBytes: 200 }],
      appliedSelectedDocs: [],
      deselectedAppliedRootBytes: [],
      selectedBytes: 200,
    });
    expect(usage.clearedCommittedBytes).toBe(80);
    expect(usage.committedAdjustedBytes).toBe(40);
    expect(usage.billableBytes).toBe(240);
  });

  it('adds half file size when deselecting an uploaded doc', () => {
    const usage = computeSyncPlanUsage({
      committed: [],
      publishedByDocumentId: new Map([['doc-1', 'hash1']]),
      stagedSelectedDocs: [],
      appliedSelectedDocs: [{ documentId: 'doc-1', hash: 'hash1', provider: 'microsoft', sizeBytes: 101 }],
      deselectedAppliedRootBytes: [],
      selectedBytes: 0,
    });
    expect(usage.pendingDelChargeBytes).toBe(50);
    expect(usage.committedAdjustedBytes).toBe(50);
  });

  it('adds half of deselected applied root sizes (folder unselect without loaded children)', () => {
    const usage = computeSyncPlanUsage({
      committed: [],
      publishedByDocumentId: new Map(),
      stagedSelectedDocs: [],
      appliedSelectedDocs: [],
      deselectedAppliedRootBytes: [101, 40],
      selectedBytes: 0,
    });
    expect(usage.pendingDelChargeBytes).toBe(50 + 20);
    expect(usage.committedAdjustedBytes).toBe(70);
  });

  it('splits under/over the active plan cap', () => {
    const split = splitUsageAtCap(0.6 * PLAN_GIB, 0.8 * PLAN_GIB, PLAN_GIB);
    expect(split.committedUnder).toBeCloseTo(0.6 * PLAN_GIB);
    expect(split.committedOver).toBe(0);
    expect(split.selectedUnder).toBeCloseTo(0.4 * PLAN_GIB);
    expect(split.selectedOver).toBeCloseTo(0.4 * PLAN_GIB);
  });

  it('clears stowed disconnect dels when membership is not listed yet', () => {
    const usage = computeSyncPlanUsage({
      committed: [{ type: 'del', size: 80, documentId: 'doc-1', hash: 'abcd', provider: 'G' }],
      publishedByDocumentId: new Map([['doc-1', 'abcd']]),
      stagedSelectedDocs: [],
      appliedSelectedDocs: [],
      deselectedAppliedRootBytes: [],
      selectedBytes: 200,
      membershipKnown: false,
      disconnectedAtByProvider: { google: DISCONNECTED_AT },
    });
    expect(usage.clearedCommittedBytes).toBe(80);
    expect(usage.committedAdjustedBytes).toBe(0);
    expect(usage.billableBytes).toBe(200);
  });

  it('clears stowed dels for live files last-modified before disconnectedAt', () => {
    const usage = computeSyncPlanUsage({
      committed: [{ type: 'del', size: 80, documentId: 'doc-1', hash: 'abcd', provider: 'G' }],
      publishedByDocumentId: new Map([['doc-1', 'abcd']]),
      stagedSelectedDocs: [{ documentId: 'doc-1', hash: 'abcd', provider: 'google', sizeBytes: 200 }],
      appliedSelectedDocs: [],
      deselectedAppliedRootBytes: [],
      selectedBytes: 200,
      membershipKnown: true,
      liveSelectedDocs: [{ documentId: 'doc-1', lastModified: BEFORE, provider: 'google' }],
      disconnectedAtByProvider: { google: DISCONNECTED_AT },
    });
    expect(usage.clearedCommittedBytes).toBe(80);
    expect(usage.committedAdjustedBytes).toBe(0);
    expect(usage.billableBytes).toBe(200);
  });

  it('keeps stowed dels when the live file is missing and does not add a picker del', () => {
    const usage = computeSyncPlanUsage({
      committed: [{ type: 'del', size: 80, documentId: 'doc-1', hash: 'abcd', provider: 'G' }],
      publishedByDocumentId: new Map([['doc-1', 'abcd']]),
      stagedSelectedDocs: [],
      appliedSelectedDocs: [{ documentId: 'doc-1', hash: 'abcd', provider: 'google', sizeBytes: 200 }],
      deselectedAppliedRootBytes: [],
      selectedBytes: 0,
      membershipKnown: true,
      liveSelectedDocs: [],
      disconnectedAtByProvider: { google: DISCONNECTED_AT },
    });
    expect(usage.clearedCommittedBytes).toBe(0);
    expect(usage.pendingDelChargeBytes).toBe(0);
    expect(usage.committedAdjustedBytes).toBe(80);
    expect(usage.billableBytes).toBe(80);
  });

  it('keeps stowed dels when last-modified is after disconnectedAt, plus full selected bytes', () => {
    const usage = computeSyncPlanUsage({
      committed: [{ type: 'del', size: 80, documentId: 'doc-1', hash: 'abcd', provider: 'G' }],
      publishedByDocumentId: new Map([['doc-1', 'abcd']]),
      stagedSelectedDocs: [{ documentId: 'doc-1', hash: 'abcd', provider: 'google', sizeBytes: 200 }],
      appliedSelectedDocs: [],
      deselectedAppliedRootBytes: [],
      selectedBytes: 200,
      membershipKnown: true,
      liveSelectedDocs: [{ documentId: 'doc-1', lastModified: AFTER, provider: 'google' }],
      disconnectedAtByProvider: { google: DISCONNECTED_AT },
    });
    expect(usage.clearedCommittedBytes).toBe(0);
    expect(usage.committedAdjustedBytes).toBe(80);
    expect(usage.billableBytes).toBe(280);
  });

  it('clears stowed dels for live files with no last-modified', () => {
    const usage = computeSyncPlanUsage({
      committed: [{ type: 'del', size: 80, documentId: 'doc-1', hash: 'abcd', provider: 'G' }],
      publishedByDocumentId: new Map([['doc-1', 'abcd']]),
      stagedSelectedDocs: [{ documentId: 'doc-1', hash: 'abcd', provider: 'google' }],
      appliedSelectedDocs: [],
      deselectedAppliedRootBytes: [],
      selectedBytes: 200,
      membershipKnown: true,
      liveSelectedDocs: [{ documentId: 'doc-1', provider: 'google' }],
      disconnectedAtByProvider: { google: DISCONNECTED_AT },
    });
    expect(usage.clearedCommittedBytes).toBe(80);
    expect(usage.committedAdjustedBytes).toBe(0);
  });

  it('leaves historical dels (hash not in documents.json) untouched', () => {
    const usage = computeSyncPlanUsage({
      committed: [{ type: 'del', size: 80, documentId: 'old', hash: 'deadbeef', provider: 'G' }],
      publishedByDocumentId: new Map([['doc-1', 'abcd']]),
      stagedSelectedDocs: [{ documentId: 'doc-1', hash: 'abcd', provider: 'google' }],
      appliedSelectedDocs: [],
      deselectedAppliedRootBytes: [],
      selectedBytes: 200,
      membershipKnown: true,
      liveSelectedDocs: [{ documentId: 'doc-1', lastModified: BEFORE, provider: 'google' }],
      disconnectedAtByProvider: { google: DISCONNECTED_AT },
    });
    expect(usage.clearedCommittedBytes).toBe(0);
    expect(usage.committedAdjustedBytes).toBe(80);
    expect(usage.billableBytes).toBe(280);
  });

  it('skips folder pending dels when uncleared stowed dels already cover missing published files', () => {
    const usage = computeSyncPlanUsage({
      committed: [{ type: 'del', size: 80, documentId: 'doc-1', hash: 'abcd', provider: 'G' }],
      publishedByDocumentId: new Map([['doc-1', 'abcd']]),
      stagedSelectedDocs: [],
      appliedSelectedDocs: [],
      deselectedAppliedRootBytes: [200],
      selectedBytes: 0,
      membershipKnown: true,
      liveSelectedDocs: [],
      disconnectedAtByProvider: { google: DISCONNECTED_AT },
    });
    expect(usage.pendingDelChargeBytes).toBe(0);
    expect(usage.committedAdjustedBytes).toBe(80);
  });
});
