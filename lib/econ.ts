/* lib/econ.ts
   Profit Floor engine for Snap-to-Listing + Trend Scope.
   - All monetary values in CENTS (integers) to avoid float drift.
   - Floors/fees/buffers in BASIS POINTS (bps). 100 bps = 1%.
*/

export type Platform =
  | 'etsy'
  | 'ebay'
  | 'gumroad'
  | 'shopify'
  | 'tiktok_shop'
  | 'stripe_links'
  | 'other';

export type ProductKind = 'physical' | 'digital' | 'service' | 'flip';

/** Basis points helpers */
export const bps = (pct: number) => Math.round(pct * 100); // 0.30 → 30 bps? (Note: see below)
export const pctFromBps = (bps: number) => bps / 10000;    // 3000 bps → 0.30 (30%)

/** Default floors (bps) per product kind */
export const DEFAULT_FLOORS_BPS: Record<ProductKind, number> = {
  physical: 3000, // 30%
  digital:  7000, // 70%
  service:  2500, // 25% effective margin target
  flip:     2500, // 25% + sell-through time check
};

/** Default buffer for refunds/defects (bps of price) */
export const DEFAULT_BUFFER_BPS = 300; // 3%

/** Platform fee presets (bps of price) + fixed cents */
export interface FeePreset {
  pctBps: number;     // percentage fee in bps of price (e.g., 650 = 6.5%)
  fixedCents: number; // per-transaction fixed component
  label: string;      // human readable source
}

/** Minimal table; extend as needed */
export const PLATFORM_FEES: Record<Platform, FeePreset> = {
  etsy:         { pctBps: 650 + 325, fixedCents: 0,   label: 'Etsy + payment (~9.75%)' }, // 6.5% + ~3.25%
  ebay:         { pctBps: 1300,       fixedCents: 0,   label: 'eBay final value (avg)' },
  gumroad:      { pctBps: 1000,       fixedCents: 30,  label: 'Gumroad 10% + $0.30' },
  shopify:      { pctBps: 290,        fixedCents: 30,  label: 'Stripe 2.9% + $0.30' },
  tiktok_shop:  { pctBps: 600,        fixedCents: 0,   label: 'TikTok Shop (~6%)' },
  stripe_links: { pctBps: 290,        fixedCents: 30,  label: 'Stripe 2.9% + $0.30' },
  other:        { pctBps: 300,        fixedCents: 30,  label: 'Generic PSP 3% + $0.30' },
};

export interface EconInputs {
  /** Listing price in cents */
  priceCents: number;
  /** Cost of goods in cents (include freight-in if known) */
  cogsCents: number;
  /** Outbound shipping (your cost) in cents */
  shippingCents: number;
  /** Packaging & supplies in cents (optional) */
  packagingCents?: number;
  /** Platform (drives fee preset) */
  platform: Platform;
  /** Product kind (drives floor) */
  kind: ProductKind;
  /** Optional overrides for fees / buffers / floors (bps) */
  overridePctBps?: number;
  overrideFixedCents?: number;
  bufferBps?: number;     // default 300
  floorBps?: number;      // default from kind
  /** Optional metadata */
  country?: 'US' | 'AU' | 'UK' | 'EU' | 'Other';
}

/** Result of a single-SKU evaluation */
export interface EconResult {
  priceCents: number;
  feesCents: number;
  bufferCents: number;
  cogsCents: number;
  shippingCents: number;
  packagingCents: number;
  profitCents: number;
  marginBps: number;   // e.g., 3390 = 33.90%
  pass: boolean;
  floorBps: number;
  breakdown: {
    feeLabel: string;
    platformPctBps: number;
    fixedFeeCents: number;
  };
}

/** Utility: safe integer multiply by bps: amount * (bps/10000) */
function mulBps(amountCents: number, rateBps: number): number {
  // round to nearest cent
  return Math.round((amountCents * rateBps) / 10000);
}

/** Compute platform fees (pct * price + fixed) */
export function computeFeesCents(
  priceCents: number,
  platform: Platform,
  overridePctBps?: number,
  overrideFixedCents?: number
): { feesCents: number; pctBps: number; fixedCents: number; label: string } {
  const preset = PLATFORM_FEES[platform] ?? PLATFORM_FEES.other;
  const pctBps = overridePctBps ?? preset.pctBps;
  const fixedCents = overrideFixedCents ?? preset.fixedCents;
  const feesCents = mulBps(priceCents, pctBps) + fixedCents;
  return { feesCents, pctBps, fixedCents, label: preset.label };
}

/** Evaluate a SKU against the Profit Floor */
export function evaluateEcon(input: EconInputs): EconResult {
  const {
    priceCents,
    cogsCents,
    shippingCents,
    packagingCents = 0,
    platform,
    kind,
    overridePctBps,
    overrideFixedCents,
    bufferBps = DEFAULT_BUFFER_BPS,
    floorBps = DEFAULT_FLOORS_BPS[kind],
  } = input;

  if (priceCents <= 0) throw new Error('priceCents must be > 0');

  const { feesCents, pctBps, fixedCents, label } = computeFeesCents(
    priceCents,
    platform,
    overridePctBps,
    overrideFixedCents
  );
  const bufferCents = mulBps(priceCents, bufferBps);
  const profitCents =
    priceCents - (cogsCents + shippingCents + packagingCents + feesCents + bufferCents);
  const marginBps = Math.round((profitCents * 10000) / priceCents);
  const pass = marginBps >= floorBps;

  return {
    priceCents,
    feesCents,
    bufferCents,
    cogsCents,
    shippingCents,
    packagingCents,
    profitCents,
    marginBps,
    pass,
    floorBps,
    breakdown: {
      feeLabel: label,
      platformPctBps: pctBps,
      fixedFeeCents: fixedCents,
    },
  };
}

/** Solve for the MIN price (in cents) that hits the floor exactly */
export function minPriceForFloorCents(input: Omit<EconInputs, 'priceCents'>): number {
  const {
    cogsCents,
    shippingCents,
    packagingCents = 0,
    platform,
    kind,
    overridePctBps,
    overrideFixedCents,
    bufferBps = DEFAULT_BUFFER_BPS,
    floorBps = DEFAULT_FLOORS_BPS[kind],
  } = input;

  const preset = PLATFORM_FEES[platform] ?? PLATFORM_FEES.other;
  const pctBps = overridePctBps ?? preset.pctBps;
  const fixedCents = overrideFixedCents ?? preset.fixedCents;

  // price - (cogs + ship + pack + fixed + pct*price + buffer*price) >= floor*price
  // price * (1 - pct - buffer - floor) >= (cogs + ship + pack + fixed)
  const denomBps = 10000 - pctBps - bufferBps - floorBps;
  if (denomBps <= 0) return Number.POSITIVE_INFINITY;

  const rhsCents = cogsCents + shippingCents + packagingCents + fixedCents;
  // priceCents >= rhsCents / (denomBps/10000)
  const priceCents = Math.ceil((rhsCents * 10000) / denomBps);
  return priceCents;
}

/** Solve for MAX COGS at a given price to still meet the floor */
export function maxCogsForFloorCents(input: EconInputs): number {
  const {
    priceCents,
    shippingCents,
    packagingCents = 0,
    platform,
    kind,
    overridePctBps,
    overrideFixedCents,
    bufferBps = DEFAULT_BUFFER_BPS,
    floorBps = DEFAULT_FLOORS_BPS[kind],
  } = input;

  const preset = PLATFORM_FEES[platform] ?? PLATFORM_FEES.other;
  const pctBps = overridePctBps ?? preset.pctBps;
  const fixedCents = overrideFixedCents ?? preset.fixedCents;

  // price * (1 - pct - buffer - floor) - (shipping + packaging + fixed)
  const headroomCents =
    mulBps(priceCents, 10000 - pctBps - bufferBps - floorBps) / 1 - (shippingCents + packagingCents + fixedCents);
  // Note: mulBps returns cents; division by 1 is a no-op to emphasize units.
  return Math.floor(headroomCents);
}

/** "Charm price" rounding:  .99 / .95 / .90 endings */
export type Charm = '.99' | '.95' | '.90' | 'none';

/** Round cents up to meet charm ending (and never below minCents) */
export function roundToCharm(priceCents: number, charm: Charm = '.99', minCents?: number): number {
  const ensure = (n: number) => (minCents && n < minCents ? minCents : n);
  if (charm === 'none') return ensure(priceCents);

  const dollars = Math.floor(priceCents / 100);
  const endings: Record<Charm, number> = { '.99': 99, '.95': 95, '.90': 90, none: 0 };
  const target = dollars * 100 + endings[charm];
  if (target >= priceCents) return ensure(target);
  // bump a dollar and re-apply charm
  return ensure((dollars + 1) * 100 + endings[charm]);
}

/** Build a price ladder that guarantees ≥ floor at entry and ascends by steps */
export function buildPriceLadderCents(
  baseInput: Omit<EconInputs, 'priceCents'>,
  steps: number[] = [1.0, 1.15, 1.30],
  charm: Charm = '.99'
): number[] {
  const p0 = minPriceForFloorCents(baseInput);
  const ladder = steps.map((m, i) => {
    const raw = Math.ceil(p0 * m);
    const charmed = roundToCharm(raw, charm, p0);
    // Verify each rung still meets floor
    const evalRes = evaluateEcon({ ...baseInput, priceCents: charmed, cogsCents: baseInput.cogsCents });
    if (!evalRes.pass && i === 0) {
      // Extremely high fees/floor — push to the exact min p0 and charm upwards once more.
      return roundToCharm(p0 + 1, charm, p0);
    }
    return charmed;
  });
  // Deduplicate in case charm produced duplicates
  return Array.from(new Set(ladder));
}

export interface VariantInput {
  sku: string;
  priceCents: number;
  cogsCents: number;
  shippingCents: number;
  packagingCents?: number;
}

export interface VariantEval extends EconResult {
  sku: string;
}

/** Evaluate a set of variants; grey out failing ones */
export function evaluateVariants(
  variants: VariantInput[],
  common: Omit<EconInputs, 'priceCents' | 'cogsCents' | 'shippingCents' | 'packagingCents'>
): VariantEval[] {
  return variants.map((v) => {
    const res = evaluateEcon({
      ...common,
      priceCents: v.priceCents,
      cogsCents: v.cogsCents,
      shippingCents: v.shippingCents,
      packagingCents: v.packagingCents ?? 0,
    });
    return { sku: v.sku, ...res };
  });
}

/** Heuristic sell-through check for flips (must sell within N days) */
export function passesSellThrough(
  expectedDaysToSell: number,
  thresholdDays: number = 14
): boolean {
  return expectedDaysToSell <= thresholdDays;
}

/** Human-readable helper for UI */
export function humanizeCents(n: number): string {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  return `${sign}$${(v / 100).toFixed(2)}`;
}

/** Example usage (remove in prod)
const res = evaluateEcon({
  priceCents: 1490,
  cogsCents: 500,
  shippingCents: 320,
  platform: 'etsy',
  kind: 'physical',
});
console.log(res.pass, res.marginBps/100 + '%');
*/
