// lib/fees.ts
export type Platform = 'etsy'|'ebay'|'gumroad'|'shopify'|'tiktok_shop'|'stripe_links'|'other';

export interface FeePreset {
  pctBps: number;     // basis points of price (100 bps = 1%)
  fixedCents: number; // per-transaction fixed cents
  label: string;
}

export const PLATFORM_FEES: Record<Platform, FeePreset> = {
  etsy:         { pctBps: 650 + 325, fixedCents: 0,   label: 'Etsy + payment (~9.75%)' },
  ebay:         { pctBps: 1300,       fixedCents: 0,   label: 'eBay final value (avg)' },
  gumroad:      { pctBps: 1000,       fixedCents: 30,  label: 'Gumroad 10% + $0.30' },
  shopify:      { pctBps: 290,        fixedCents: 30,  label: 'Stripe 2.9% + $0.30' },
  tiktok_shop:  { pctBps: 600,        fixedCents: 0,   label: 'TikTok Shop (~6%)' },
  stripe_links: { pctBps: 290,        fixedCents: 30,  label: 'Stripe 2.9% + $0.30' },
  other:        { pctBps: 300,        fixedCents: 30,  label: 'Generic PSP 3% + $0.30' },
};
