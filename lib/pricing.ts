/**
 * lib/pricing.ts
 * Money & pricing utilities for Stakt.
 * - All arithmetic in integer cents to avoid float drift.
 * - Locale-aware formatting.
 * - Charm pricing (.99/.95/.90) with currency-specific decimals.
 * - Helpers to serialize for PayPal/Stripe.
 */

export type CurrencyCode =
  | 'USD' | 'AUD' | 'NZD' | 'CAD' | 'EUR' | 'GBP' | 'JPY' | 'SGD' | 'HKD';

export type Charm = '.99' | '.95' | '.90' | 'none';

const DECIMALS: Record<CurrencyCode, number> = {
  USD: 2, AUD: 2, NZD: 2, CAD: 2, EUR: 2, GBP: 2, JPY: 0, SGD: 2, HKD: 2,
};

const DEFAULT_LOCALE: Record<CurrencyCode, string> = {
  USD: 'en-US', AUD: 'en-AU', NZD: 'en-NZ', CAD: 'en-CA',
  EUR: 'de-DE', GBP: 'en-GB', JPY: 'ja-JP', SGD: 'en-SG', HKD: 'en-HK',
};

export class Money {
  readonly cents: bigint;
  readonly currency: CurrencyCode;

  private constructor(cents: bigint, currency: CurrencyCode) {
    this.cents = cents;
    this.currency = currency;
  }

  /** Construct from integer cents (number or bigint) */
  static fromCents(cents: number | bigint, currency: CurrencyCode): Money {
    if (!Number.isFinite(Number(cents))) throw new Error('Invalid cents');
    return new Money(BigInt(Math.trunc(Number(cents))), currency);
  }

  /** Construct from decimal number (e.g., 12.99) */
  static fromDecimal(amount: number, currency: CurrencyCode): Money {
    const d = DECIMALS[currency];
    if (!Number.isFinite(amount)) throw new Error('Invalid amount');
    const cents = Math.round(amount * 10 ** d);
    return Money.fromCents(cents, currency);
  }

  /** Construct from user-entered string like "12.99" or "1299" (JPY) */
  static parse(str: string, currency: CurrencyCode): Money {
    const s = (str || '').replace(/[^\d.]/g, '');
    if (!s) return Money.fromCents(0, currency);
    const d = DECIMALS[currency];
    if (d === 0) return Money.fromCents(parseInt(s, 10), currency);
    const [int, fracRaw = ''] = s.split('.');
    const frac = (fracRaw + '00').slice(0, d);
    const cents = parseInt(int, 10) * 10 ** d + parseInt(frac || '0', 10);
    return Money.fromCents(cents, currency);
  }

  toNumber(): number {
    const d = DECIMALS[this.currency];
    return Number(this.cents) / 10 ** d;
  }

  format(locale?: string, options?: Intl.NumberFormatOptions): string {
    const d = DECIMALS[this.currency];
    return new Intl.NumberFormat(
      locale || DEFAULT_LOCALE[this.currency],
      { style: 'currency', currency: this.currency, minimumFractionDigits: d, maximumFractionDigits: d, ...options }
    ).format(this.toNumber());
  }

  /** Serialize for PayPal/Stripe amounts (value string with correct decimals) */
  toProcessorAmount(): { currency_code: CurrencyCode; value: string } {
    const d = DECIMALS[this.currency];
    const value = (Number(this.cents) / 10 ** d).toFixed(d);
    return { currency_code: this.currency, value };
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }
  sub(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents - other.cents, this.currency);
  }
  /** Multiply by a scalar (e.g., quantity) */
  mul(n: number): Money {
    return new Money(BigInt(Math.round(Number(this.cents) * n)), this.currency);
  }
  /** Multiply by basis points (100 bps = 1%) */
  mulBps(bps: number): Money {
    return new Money(BigInt(Math.round(Number(this.cents) * (bps / 10000))), this.currency);
  }

  clamp(min?: Money, max?: Money): Money {
    let c = this.cents;
    if (min) { this.assertSameCurrency(min); if (c < min.cents) c = min.cents; }
    if (max) { this.assertSameCurrency(max); if (c > max.cents) c = max.cents; }
    return new Money(c, this.currency);
  }

  /** Apply charm pricing (e.g., .99) without going below a minimum */
  withCharm(charm: Charm = '.99', min?: Money): Money {
    const d = DECIMALS[this.currency];
    if (charm === 'none' || d === 0) return min ? this.clamp(min) : this;
    const dollars = Math.floor(Number(this.cents) / 100);
    const ending = charm === '.99' ? 99 : charm === '.95' ? 95 : 90;
    let candidate = Money.fromCents(dollars * 100 + ending, this.currency);
    if (candidate.cents < this.cents) {
      candidate = Money.fromCents((dollars + 1) * 100 + ending, this.currency);
    }
    if (min && candidate.cents < min.cents) {
      const minDollars = Math.floor(Number(min.cents) / 100);
      candidate = Money.fromCents((minDollars + 1) * 100 + ending, this.currency);
    }
    return candidate;
  }

  private assertSameCurrency(other: Money) {
    if (this.currency !== other.currency) throw new Error('Currency mismatch');
  }
}

/** Convert number-of-dollars to integer cents */
export const dollarsToCents = (n: number, currency: CurrencyCode) =>
  Money.fromDecimal(n, currency).cents;

/** Convert integer cents to number-of-dollars */
export const centsToDollars = (cents: number | bigint, currency: CurrencyCode) =>
  Money.fromCents(cents, currency).toNumber();

/** Humanize integer cents like "$12.99" */
export const humanizeCents = (cents: number | bigint, currency: CurrencyCode, locale?: string) =>
  Money.fromCents(cents, currency).format(locale);

/** Build a price ladder given a minimum price (cents) already meeting the floor */
export function buildCharmLadder(
  minPriceCents: number,
  currency: CurrencyCode,
  multipliers: number[] = [1.0, 1.15, 1.30],
  charm: Charm = '.99'
): number[] {
  const base = Money.fromCents(minPriceCents, currency);
  const ladder = multipliers.map((m) => base.mul(m).withCharm(charm, base).cents);
  // dedupe
  const uniq = Array.from(new Set(ladder.map((b) => Number(b))));
  return uniq;
}

/** Round arbitrary cents up to a charm ending (never below baseline) */
export function roundCentsToCharm(
  cents: number,
  currency: CurrencyCode,
  charm: Charm = '.99',
  minCents?: number
): number {
  const m = Money.fromCents(cents, currency).withCharm(charm, minCents ? Money.fromCents(minCents, currency) : undefined);
  return Number(m.cents);
}

/** Parse a price query param & guard extremes (UI safety) */
export function parsePriceParam(
  raw: string | null | undefined,
  currency: CurrencyCode,
  { minCents = 0, maxCents = 1_000_000_00 }: { minCents?: number; maxCents?: number } = {}
): number {
  if (!raw) return minCents;
  const m = Money.parse(raw, currency);
  let cents = Number(m.cents);
  if (cents < minCents) cents = minCents;
  if (cents > maxCents) cents = maxCents;
  return cents;
}

/** PayPal helpers */
export interface PayPalAmount { currency_code: CurrencyCode; value: string; }
export const toPayPalAmount = (cents: number, currency: CurrencyCode): PayPalAmount =>
  Money.fromCents(cents, currency).toProcessorAmount();

/** Format compact like "$12.9k" for KPI badges */
export function formatCompact(
  cents: number | bigint,
  currency: CurrencyCode,
  locale?: string
): string {
  const n = centsToDollars(cents, currency);
  const f = new Intl.NumberFormat(locale || DEFAULT_LOCALE[currency], { notation: 'compact', maximumFractionDigits: 1 });
  const symbol = new Intl.NumberFormat(locale || DEFAULT_LOCALE[currency], { style: 'currency', currency }).formatToParts(0)
    .find(p => p.type === 'currency')?.value || '';
  // Intl with currency+compact is inconsistent; combining symbol + compact number is more predictable
  return `${symbol}${f.format(n)}`;
}
