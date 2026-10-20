/** Bytes in one gibibyte for plan caps (1GB, 10GB, …). */
export const PLAN_GIB = 1024 ** 3;

export interface SyncStoragePlan {
  /** Soft cap in bytes (inclusive). */
  capBytes: number;
  /** Cap in whole GB (1, 10, 20, …). */
  capGb: number;
  label: string;
  /** Yearly price in USD (0 for Free). */
  priceUsd: number;
}

const FREE_PLAN: SyncStoragePlan = {
  capBytes: PLAN_GIB,
  capGb: 1,
  label: 'Free',
  priceUsd: 0,
};

function planAtGb(capGb: number): SyncStoragePlan {
  if (capGb <= 1) {
    return FREE_PLAN;
  }
  if (capGb === 10) {
    return { capBytes: 10 * PLAN_GIB, capGb: 10, label: 'Pro', priceUsd: 10.99 };
  }
  if (capGb === 20) {
    return { capBytes: 20 * PLAN_GIB, capGb: 20, label: 'Pro XL', priceUsd: 19.99 };
  }
  if (capGb === 30) {
    return { capBytes: 30 * PLAN_GIB, capGb: 30, label: 'Pro XXL', priceUsd: 29.99 };
  }
  // Pro N where N = GB/10; price = prior tier + $10 each step past Pro XXL.
  const stepsPastXxxl = Math.max(0, (capGb - 30) / 10);
  return {
    capBytes: capGb * PLAN_GIB,
    capGb,
    label: `Pro ${capGb / 10}`,
    priceUsd: Math.round((29.99 + stepsPastXxxl * 10) * 100) / 100,
  };
}

/** Ladder caps: Free, then 10GB steps forever. */
export function planCapGbSequence(maxGb: number): number[] {
  const caps = [1];
  for (let gb = 10; gb <= maxGb; gb += 10) {
    caps.push(gb);
  }
  return caps;
}

export function planForCapGb(capGb: number): SyncStoragePlan {
  return planAtGb(capGb);
}

/** Smallest plan whose cap covers billableBytes. Free covers any usage ≤ 1GB. */
export function requiredPlanForBytes(billableBytes: number): SyncStoragePlan {
  const bytes = Math.max(0, Math.floor(Number(billableBytes) || 0));
  if (bytes <= FREE_PLAN.capBytes) {
    return FREE_PLAN;
  }
  let capGb = 10;
  while (bytes > capGb * PLAN_GIB) {
    capGb += 10;
  }
  return planAtGb(capGb);
}

/**
 * Plans on the timeline: always include required + two tiers above.
 * Default (required ≤ 30GB): Free…Pro XXL (0–30GB scale).
 * When required > 30GB: extend with Pro 4, Pro 5, … and drop lower options so the
 * ladder ends at required + 2 (visiblePlans may drop more for width).
 */
export function plansForUsage(billableBytes: number): SyncStoragePlan[] {
  const required = requiredPlanForBytes(billableBytes);
  const endGb = Math.max(30, required.capGb + 20);
  const caps = planCapGbSequence(endGb);
  const requiredIndex = caps.indexOf(required.capGb);
  const endIndex = Math.min(caps.length - 1, requiredIndex + 2);
  let startIndex = 0;
  if (required.capGb > 30) {
    // Keep up to 4 below + required + 2 above when the full ladder is long.
    startIndex = Math.max(0, requiredIndex - 4);
  }
  return caps.slice(startIndex, endIndex + 1).map(planAtGb);
}

/**
 * When horizontal space is tight, drop lowest (disabled) options first.
 * Always keep required + two above; with room for 7, show up to 4 below + required + 2 above.
 * Free stays in the radio list whenever it is on the ladder (the in-bar "1GB" label may still hide).
 */
export function visiblePlans(
  allPlans: SyncStoragePlan[],
  requiredCapGb: number,
  maxLabels: number
): SyncStoragePlan[] {
  if (allPlans.length === 0) {
    return [];
  }
  const freePlan = allPlans.find((plan) => plan.capGb === 1) ?? null;
  const requiredIndex = Math.max(0, allPlans.findIndex((plan) => plan.capGb === requiredCapGb));
  const endIndex = Math.min(allPlans.length - 1, requiredIndex + 2);
  const limit = Math.max(3, Math.floor(maxLabels) || 3);
  // Prefer: up to 4 below + required + 2 above.
  const idealBelow = Math.min(4, requiredIndex);
  const idealCount = idealBelow + 1 + Math.min(2, endIndex - requiredIndex);
  const count = Math.min(limit, Math.max(3, idealCount), endIndex + 1);
  let startIndex = Math.max(0, endIndex - count + 1);
  if (startIndex > requiredIndex) {
    startIndex = requiredIndex;
  }
  const sliced = allPlans.slice(startIndex, endIndex + 1).slice(-count);
  if (freePlan && !sliced.some((plan) => plan.capGb === 1)) {
    return [freePlan, ...sliced];
  }
  return sliced;
}

export function formatPlanPriceParts(plan: SyncStoragePlan): {
  isFree: boolean;
  dollars: string;
  centsTax: string;
  period: string;
} {
  if (plan.priceUsd <= 0) {
    return { isFree: true, dollars: 'FREE', centsTax: '', period: '' };
  }
  const whole = Math.floor(plan.priceUsd);
  const cents = Math.round((plan.priceUsd - whole) * 100);
  return {
    isFree: false,
    dollars: `$${whole}`,
    centsTax: `.${String(cents).padStart(2, '0')} +tax`,
    period: 'per year',
  };
}

export function formatPlanPriceLabel(plan: SyncStoragePlan): string {
  if (plan.priceUsd <= 0) {
    return '$0';
  }
  return `$${plan.priceUsd.toFixed(2)}`;
}

/** Default active plan until payment persistence exists. */
export function defaultActivePlan(): SyncStoragePlan {
  return FREE_PLAN;
}

/**
 * Power used by {@link bytesToBarPercent}. Chosen so that on a 0–30GB scale,
 * 1GB maps to ~2.5× its linear share: (1/30)^p = 2.5/30.
 */
export const BAR_SCALE_EXPONENT = Math.log(2.5 / 30) / Math.log(1 / 30);

/**
 * Map bytes → display percent (0–100) with a power curve that gives lower GB
 * values more horizontal space than linear. Progress fills, ticks, labels, and
 * radio positions should all use this so they stay aligned.
 */
export function bytesToBarPercent(bytes: number, scaleMaxBytes: number): number {
  if (!(scaleMaxBytes > 0)) {
    return 0;
  }
  const linear = Math.min(1, Math.max(0, Number(bytes) || 0) / scaleMaxBytes);
  if (linear <= 0) {
    return 0;
  }
  if (linear >= 1) {
    return 100;
  }
  return Math.pow(linear, BAR_SCALE_EXPONENT) * 100;
}
