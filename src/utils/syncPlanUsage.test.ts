import { computeSyncPlanUsage, splitUsageAtCap, sumCommittedSizes } from './syncPlanUsage';
import { PLAN_GIB } from './syncStoragePlans';

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
});
