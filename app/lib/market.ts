// app/lib/market.ts
// Server-side data layer for the public price pages. Reads the `market_prices` table.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

// Set NEXT_PUBLIC_SITE_URL to your real domain (not the tunnel URL) before launch.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'
).replace(/\/$/, '');

export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const fmtNaira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

export const monthYear = (d = new Date()) =>
  d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });

interface PriceRow {
  product_slug: string;
  product_name: string;
  category: string;
  unit: string;
  city: string;
  price: number;
  supplier_name: string | null;
  observed_at: string;
}

export interface PriceSummary {
  slug: string; // dangote-cement-50kg-price-in-port-harcourt
  productSlug: string;
  productName: string;
  category: string;
  unit: string;
  city: string;
  citySlug: string;
  current: number;
  min: number;
  max: number;
  change30: number | null; // % change vs ~30 days earlier
  points: { date: string; value: number }[];
  suppliers: string[];
  updatedAt: string;
}

const DAY = 86_400_000;
const SEP = '-price-in-';

export const summarySlug = (productSlug: string, city: string) =>
  `${productSlug}${SEP}${slugify(city)}`;

async function fetchRows(): Promise<PriceRow[]> {
  const since = new Date(Date.now() - 120 * DAY).toISOString();
  const { data, error } = await supabase
    .from('market_prices')
    .select('product_slug, product_name, category, unit, city, price, supplier_name, observed_at')
    .gte('observed_at', since)
    .order('observed_at', { ascending: false })
    .limit(5000);
  if (error) {
    console.error('market_prices fetch error:', error.message);
    return [];
  }
  return (data || []).map((r: any) => ({ ...r, price: Number(r.price) }));
}

function summarise(rows: PriceRow[]): PriceSummary {
  const first = rows[0]; // newest first
  const latest = new Date(first.observed_at).getTime();

  // Daily average series, oldest → newest
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const d = r.observed_at.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) || []), r.price]);
  }
  const points = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, value: v.reduce((a, b) => a + b, 0) / v.length }));

  // "Current" = the last 14 days relative to the newest observation
  const recent = rows.filter((r) => latest - new Date(r.observed_at).getTime() <= 14 * DAY);
  const prices = recent.map((r) => r.price);
  const current = prices.reduce((a, b) => a + b, 0) / prices.length;

  // Compare with observations 23–37 days before the newest one
  const prior = rows.filter((r) => {
    const age = latest - new Date(r.observed_at).getTime();
    return age >= 23 * DAY && age <= 37 * DAY;
  });
  const priorAvg = prior.length ? prior.reduce((a, r) => a + r.price, 0) / prior.length : null;

  return {
    slug: summarySlug(first.product_slug, first.city),
    productSlug: first.product_slug,
    productName: first.product_name,
    category: first.category,
    unit: first.unit,
    city: first.city,
    citySlug: slugify(first.city),
    current,
    min: Math.min(...prices),
    max: Math.max(...prices),
    change30: priorAvg ? ((current - priorAvg) / priorAvg) * 100 : null,
    points,
    suppliers: [...new Set(recent.map((r) => r.supplier_name).filter(Boolean) as string[])],
    updatedAt: first.observed_at,
  };
}

export async function getAllSummaries(): Promise<PriceSummary[]> {
  const rows = await fetchRows();
  const groups = new Map<string, PriceRow[]>();
  for (const r of rows) {
    const k = `${r.product_slug}|${slugify(r.city)}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  return [...groups.values()]
    .map(summarise)
    .sort((a, b) => a.productName.localeCompare(b.productName) || a.city.localeCompare(b.city));
}

export async function getSummary(slug: string) {
  const idx = slug.lastIndexOf(SEP);
  if (idx < 1) return null;
  const productSlug = slug.slice(0, idx);
  const citySlug = slug.slice(idx + SEP.length);

  const all = await getAllSummaries();
  const item = all.find((s) => s.productSlug === productSlug && s.citySlug === citySlug);
  if (!item) return null;

  return {
    item,
    otherCities: all.filter((s) => s.productSlug === productSlug && s.citySlug !== citySlug),
    sameCity: all.filter((s) => s.citySlug === citySlug && s.productSlug !== productSlug).slice(0, 6),
  };
}
