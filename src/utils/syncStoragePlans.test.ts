import {
  PLAN_GIB,
  bytesToBarPercent,
  defaultActivePlan,
  formatPlanPriceLabel,
  formatPlanPriceParts,
  plansForUsage,
  requiredPlanForBytes,
  visiblePlans,
} from './syncStoragePlans';

describe('syncStoragePlans', () => {
  it('treats any usage ≤ 1GB as Free', () => {
    expect(requiredPlanForBytes(0).label).toBe('Free');
    expect(requiredPlanForBytes(PLAN_GIB).label).toBe('Free');
    expect(requiredPlanForBytes(PLAN_GIB + 1).label).toBe('Pro');
  });

  it('names Pro XL / XXL / Pro N and prices them', () => {
    expect(requiredPlanForBytes(10 * PLAN_GIB + 1).label).toBe('Pro XL');
    expect(requiredPlanForBytes(20 * PLAN_GIB + 1).label).toBe('Pro XXL');
    const pro4 = requiredPlanForBytes(30 * PLAN_GIB + 1);
    expect(pro4.label).toBe('Pro 4');
    expect(pro4.priceUsd).toBe(39.99);
    const pro5 = requiredPlanForBytes(40 * PLAN_GIB + 1);
    expect(pro5.label).toBe('Pro 5');
    expect(pro5.priceUsd).toBe(49.99);
  });

  it('defaults the ladder to Free…Pro XXL and extends two above required', () => {
    const under30 = plansForUsage(5 * PLAN_GIB);
    expect(under30.map((plan) => plan.label)).toEqual(['Free', 'Pro', 'Pro XL', 'Pro XXL']);

    const needsPro4 = plansForUsage(35 * PLAN_GIB);
    expect(needsPro4.map((plan) => plan.label)).toContain('Pro 4');
    expect(needsPro4[needsPro4.length - 1]?.label).toBe('Pro 6');
  });

  it('keeps Free in the radio list when maxLabels is tight', () => {
    const all = plansForUsage(35 * PLAN_GIB);
    const required = requiredPlanForBytes(35 * PLAN_GIB);
    const visible = visiblePlans(all, required.capGb, 3);
    expect(visible[0]?.label).toBe('Free');
    expect(visible.map((plan) => plan.label)).toEqual(['Free', 'Pro 4', 'Pro 5', 'Pro 6']);

    const under30 = plansForUsage(25 * PLAN_GIB);
    const requiredXxxl = requiredPlanForBytes(25 * PLAN_GIB);
    const cramped = visiblePlans(under30, requiredXxxl.capGb, 3);
    expect(cramped.map((plan) => plan.label)).toEqual(['Free', 'Pro XXL', 'Pro 4', 'Pro 5']);
  });

  it('formats FREE vs paid price parts', () => {
    expect(formatPlanPriceParts(defaultActivePlan()).isFree).toBe(true);
    const pro = requiredPlanForBytes(2 * PLAN_GIB);
    expect(formatPlanPriceParts(pro)).toEqual({
      isFree: false,
      dollars: '$10',
      centsTax: '.99 +tax',
      period: 'per year',
    });
    expect(formatPlanPriceLabel(pro)).toBe('$10.99');
  });

  it('stretches 1GB to ~2.5× linear share on a 30GB bar scale', () => {
    const scaleMax = 30 * PLAN_GIB;
    const curved = bytesToBarPercent(PLAN_GIB, scaleMax);
    const linear = (PLAN_GIB / scaleMax) * 100;
    expect(curved / linear).toBeCloseTo(2.5, 5);
    expect(bytesToBarPercent(0, scaleMax)).toBe(0);
    expect(bytesToBarPercent(scaleMax, scaleMax)).toBe(100);
  });
});
