import { useEffect, useMemo, useRef, useState } from 'react';
import type { FederatedProvider } from '../models/bible';
import {
  bytesToBarPercent,
  defaultActivePlan,
  formatPlanPriceLabel,
  formatPlanPriceParts,
  planForCapGb,
  plansForUsage,
  requiredPlanForBytes,
  visiblePlans,
  type SyncStoragePlan,
  PLAN_GIB,
} from '../utils/syncStoragePlans';
import { splitUsageAtCap } from '../utils/syncPlanUsage';
import './SyncPlanUsageBar.scss';

const PROVIDER_LABEL: Record<FederatedProvider, string> = {
  google: 'Google Drive',
  microsoft: 'OneDrive',
};

const LABEL_WIDTH_PX = 72;

export interface SyncPlanUsageBarProps {
  committedBytes: number;
  selectedBytes: number;
  providersWithSelection: FederatedProvider[];
  activePlan?: SyncStoragePlan;
  selectedPlan: SyncStoragePlan;
  onSelectedPlanChange: (plan: SyncStoragePlan) => void;
}

function formatTickLabel(capGb: number): string {
  return `${capGb}GB`;
}

function formatLegendSize(sizeBytes: number): string {
  const bytes = Math.max(0, Math.floor(Number(sizeBytes) || 0));
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${Math.round(mb)} MB`;
  }
  const gb = mb / 1024;
  return gb < 10 ? `${gb.toFixed(1)} GB` : `${Math.round(gb)} GB`;
}

function barPercentCss(bytes: number, scaleMaxBytes: number): string {
  return `${bytesToBarPercent(bytes, scaleMaxBytes)}%`;
}

interface LegendEntry {
  key: string;
  label: string;
  bytes: number;
  swatchClass: string;
  tooltip: string;
}

const SyncPlanUsageBar: React.FC<SyncPlanUsageBarProps> = ({
  committedBytes,
  selectedBytes,
  providersWithSelection,
  activePlan = defaultActivePlan(),
  selectedPlan,
  onSelectedPlanChange,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [maxLabels, setMaxLabels] = useState(7);
  const [warningCollapsed, setWarningCollapsed] = useState(false);

  const billableBytes = Math.max(0, committedBytes) + Math.max(0, selectedBytes);
  const requiredPlan = useMemo(() => requiredPlanForBytes(billableBytes), [billableBytes]);
  const ladder = useMemo(() => plansForUsage(billableBytes), [billableBytes]);
  const displayed = useMemo(
    () => visiblePlans(ladder, requiredPlan.capGb, maxLabels),
    [ladder, maxLabels, requiredPlan.capGb]
  );
  // Keep the Free radio when cramped; only the in-bar "1GB" label may drop.
  const showFreeTickLabel = maxLabels >= displayed.length
    || !displayed.some((plan) => plan.capGb === 1);
  const scaleMaxBytes = displayed.length > 0
    ? displayed[displayed.length - 1]!.capBytes
    : 30 * PLAN_GIB;

  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setMaxLabels(Math.max(3, Math.floor(width / LABEL_WIDTH_PX)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Auto-select required plan when usage grows past the current selection.
  useEffect(() => {
    if (selectedPlan.capGb < requiredPlan.capGb) {
      onSelectedPlanChange(planForCapGb(requiredPlan.capGb));
    }
  }, [onSelectedPlanChange, requiredPlan.capGb, selectedPlan.capGb]);

  const segments = splitUsageAtCap(committedBytes, selectedBytes, activePlan.capBytes);
  // Segment widths are differences of curved cumulative positions (not linear byte shares).
  const segmentEnds = [
    segments.committedUnder,
    segments.committedUnder + segments.selectedUnder,
    segments.committedUnder + segments.selectedUnder + segments.committedOver,
    segments.committedUnder + segments.selectedUnder + segments.committedOver + segments.selectedOver,
  ];
  const segmentStarts = [0, segmentEnds[0]!, segmentEnds[1]!, segmentEnds[2]!];
  const segmentWidths = segmentEnds.map((end, i) =>
    Math.max(0, bytesToBarPercent(end, scaleMaxBytes) - bytesToBarPercent(segmentStarts[i]!, scaleMaxBytes))
  );
  const pctAt = (bytes: number) => barPercentCss(bytes, scaleMaxBytes);

  const price = formatPlanPriceParts(selectedPlan);
  const showUpgradeWarning = requiredPlan.capGb > activePlan.capGb && providersWithSelection.length > 0;
  const providerList = formatProviderList(providersWithSelection);
  const overPlanBytes = segments.committedOver + segments.selectedOver;
  // One key per visible color segment (blue / green / yellow).
  const legendEntries: LegendEntry[] = [
    segments.committedUnder > 0
      ? {
          key: 'committed',
          label: 'Committed Processing',
          bytes: segments.committedUnder,
          swatchClass: 'bg-primary',
          tooltip: 'Data for which processing was already completed',
        }
      : null,
    segments.selectedUnder > 0
      ? {
          key: 'selected',
          label: 'Selected files',
          bytes: segments.selectedUnder,
          swatchClass: 'bg-success',
          tooltip: "Files you've selected covered by your current plan",
        }
      : null,
    overPlanBytes > 0
      ? {
          key: 'over',
          label: 'Over plan',
          bytes: overPlanBytes,
          swatchClass: 'bg-warning',
          tooltip: 'Selected or Committed data not covered by your current plan',
        }
      : null,
  ].filter((entry): entry is LegendEntry => entry !== null);

  return (
    <section className="sync-plan-usage" aria-label="Storage plan usage">
      {showUpgradeWarning && (
        <div
          className={`sync-plan-usage-warning alert alert-warning mb-3 mt-0${warningCollapsed ? ' is-collapsed' : ''}`}
          role="status"
          onClick={warningCollapsed ? () => setWarningCollapsed(false) : undefined}
        >
          <span className="sync-plan-usage-warning-text">
            The size of the files in {providerList} are more than what we can process without you upgrading
            your plan. Either deselect files from your cloud provider{providersWithSelection.length > 1 ? 's' : ''} to
            remain within your plan limits, or click the Upgrade button below to purchase a larger plan.
            Subscriptions, such as the Built-In library do not count toward your usage—Only your own cloud
            provider files.
          </span>
          {warningCollapsed ? (
            <button
              type="button"
              className="sync-plan-usage-warning-toggle"
              aria-expanded={false}
              aria-label="Expand warning"
              onClick={(e) => {
                e.stopPropagation();
                setWarningCollapsed(false);
              }}
            >
              +
            </button>
          ) : (
            <button
              type="button"
              className="sync-plan-usage-warning-collapse-hit"
              aria-expanded={true}
              aria-label="Collapse warning"
              onClick={() => setWarningCollapsed(true)}
            >
              <span className="sync-plan-usage-warning-toggle" aria-hidden="true">
                −
              </span>
            </button>
          )}
        </div>
      )}
      <div className="sync-plan-usage-row">
        <div className="sync-plan-usage-main">
          {legendEntries.length > 0 && (
            <ul className="sync-plan-usage-legend" aria-label="Usage key">
              {legendEntries.map((entry) => (
                <li key={entry.key} className="sync-plan-usage-legend-item" title={entry.tooltip}>
                  <span className={`sync-plan-usage-legend-swatch ${entry.swatchClass}`} aria-hidden="true" />
                  <span>
                    {entry.label} ({formatLegendSize(entry.bytes)})
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="sync-plan-usage-track-wrap" ref={trackRef}>
            <div className="sync-plan-usage-track progress" role="progressbar" aria-valuemin={0} aria-valuemax={scaleMaxBytes} aria-valuenow={billableBytes}>
              {segments.committedUnder > 0 && (
                <div
                  className="progress-bar bg-primary"
                  style={{ width: `${segmentWidths[0]}%` }}
                  title="Data for which processing was already completed"
                />
              )}
              {segments.selectedUnder > 0 && (
                <div
                  className="progress-bar bg-success"
                  style={{ width: `${segmentWidths[1]}%` }}
                  title="Files you've selected covered by your current plan"
                />
              )}
              {segments.committedOver > 0 && (
                <div
                  className="progress-bar bg-warning"
                  style={{ width: `${segmentWidths[2]}%` }}
                  title="Selected or Committed data not covered by your current plan"
                />
              )}
              {segments.selectedOver > 0 && (
                <div
                  className="progress-bar bg-warning"
                  style={{ width: `${segmentWidths[3]}%` }}
                  title="Selected or Committed data not covered by your current plan"
                />
              )}
              {displayed.map((plan) => (
                plan.capGb === 1 && !showFreeTickLabel ? null : (
                  <span
                    key={`tick-label-${plan.capGb}`}
                    className="sync-plan-usage-tick-label"
                    style={{ left: pctAt(plan.capBytes) }}
                  >
                    {formatTickLabel(plan.capGb)}
                  </span>
                )
              ))}
              {displayed.map((plan) => (
                <span
                  key={`tick-${plan.capGb}`}
                  className="sync-plan-usage-tick"
                  style={{ left: pctAt(plan.capBytes) }}
                />
              ))}
            </div>
            <div className="sync-plan-usage-radios" role="radiogroup" aria-label="Storage plan">
              {displayed.map((plan) => {
                const disabled = plan.capGb < requiredPlan.capGb;
                const checked = selectedPlan.capGb === plan.capGb;
                return (
                  <label
                    key={plan.capGb}
                    className={`sync-plan-usage-radio${disabled ? ' is-disabled' : ''}`}
                    style={{ left: pctAt(plan.capBytes) }}
                  >
                    <span className="sync-plan-usage-stem" aria-hidden="true" />
                    <input
                      type="radio"
                      name="sync-storage-plan"
                      value={plan.capGb}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onSelectedPlanChange(plan)}
                    />
                    <span className="sync-plan-usage-radio-label">
                      <span className="sync-plan-usage-radio-tier">{plan.label}</span>
                      {plan.priceUsd > 0 && (
                        <span className="sync-plan-usage-radio-price">{formatPlanPriceLabel(plan)}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <div className="sync-plan-usage-price" aria-live="polite">
          {price.isFree ? (
            <span className="sync-plan-usage-price-free">FREE</span>
          ) : (
            <>
              <span className="sync-plan-usage-price-dollars">{price.dollars}</span>
              <div className="sync-plan-usage-price-meta">
                <span className="sync-plan-usage-price-cents">{price.centsTax}</span>
                <span className="sync-plan-usage-price-period">{price.period}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
};

function formatProviderList(providers: FederatedProvider[]): string {
  const labels = providers.map((provider) => PROVIDER_LABEL[provider]);
  if (labels.length === 0) {
    return 'your cloud storage';
  }
  if (labels.length === 1) {
    return labels[0]!;
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export default SyncPlanUsageBar;
