// app/prices/page.tsx  → /prices   (public, indexable)

import type { Metadata } from 'next';
import Link from 'next/link';
import PublicShell from '../components/PublicShell';
import ChangeBadge from '../components/ChangeBadge';
import { getAllSummaries, fmtNaira, monthYear, SITE_URL } from '../lib/market';
import { OpenChatButton } from '../components/QuoteChat';

export const revalidate = 1800;

export const metadata: Metadata = {
  title: `Building Material Prices in Nigeria Today (${monthYear()}) | Velrenta`,
  description:
    'Check today’s price of cement, iron rods, pipes and more in Port Harcourt, Lagos, Abuja and other cities. Updated from real supplier quotes.',
  alternates: { canonical: `${SITE_URL}/prices` },
};

export default async function PricesIndex({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; city?: string; category?: string }>;
}) {
  const { q = '', city = '', category = '' } = await searchParams;
  const all = await getAllSummaries();

  const cities = [...new Set(all.map((s) => s.city))].sort();
  const categories = [...new Set(all.map((s) => s.category))].sort();

  const list = all.filter(
    (s) =>
      (!q || s.productName.toLowerCase().includes(q.toLowerCase())) &&
      (!city || s.city === city) &&
      (!category || s.category === category)
  );

  const href = (next: Partial<{ q: string; city: string; category: string }>) => {
    const p = new URLSearchParams();
    const merged = { q, city, category, ...next };
    Object.entries(merged).forEach(([k, v]) => v && p.set(k, v));
    const s = p.toString();
    return s ? `/prices?${s}` : '/prices';
  };

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border transition ${active
      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
      : 'text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-200'
    }`;

  return (
    <PublicShell active="prices">
      <main className="max-w-5xl mx-auto px-4 pt-10">
        <h1 className="text-3xl md:text-4xl font-bold text-white max-w-2xl leading-tight">
          What building materials cost today
        </h1>
        <p className="text-slate-400 mt-3 max-w-xl">
          Average prices from real supplier quotes. Pick a material and city, then request a live quote in one tap.
        </p>

        <form action="/prices" className="mt-6 flex gap-2 max-w-xl">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search cement, iron rod, PVC pipe..."
            aria-label="Search materials"
            className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
          {city && <input type="hidden" name="city" value={city} />}
          {category && <input type="hidden" name="category" value={category} />}
          <button className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-5 rounded-xl text-sm transition">
            Search
          </button>
        </form>

        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 w-14">City</span>
            <Link href={href({ city: '' })} className={chip(!city)}>All</Link>
            {cities.map((c) => (
              <Link key={c} href={href({ city: c })} className={chip(city === c)}>{c}</Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 w-14">Type</span>
            <Link href={href({ category: '' })} className={chip(!category)}>All</Link>
            {categories.map((c) => (
              <Link key={c} href={href({ category: c })} className={chip(category === c)}>{c}</Link>
            ))}
          </div>
        </div>

        {list.length === 0 ? (
          <div className="mt-10 rounded-xl border border-slate-800 bg-slate-900 p-10 text-center">
            <p className="text-sm text-slate-300">No prices match your search</p>
            <p className="text-xs text-slate-500 mt-1">Try another material or city, or ask for a quote directly.</p>
            <Link href="/" className="inline-block mt-4 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-lg px-4 py-2 transition">
              Request a quote
            </Link>
          </div>
        ) : (
          <ul className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {list.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/prices/${s.slug}`}
                  className="block rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-slate-600 transition h-full"
                >
                  <p className="text-sm font-semibold text-white">{s.productName}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{s.city}</p>
                  <div className="flex items-end justify-between gap-3 mt-4">
                    <p className="text-2xl font-bold text-emerald-400">
                      {fmtNaira(s.current)}
                      <span className="text-xs font-normal text-slate-500"> / {s.unit}</span>
                    </p>
                    <ChangeBadge value={s.change30} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-12 rounded-xl border border-slate-800 bg-slate-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-white">Don’t see your material?</h2>
            <p className="text-xs text-slate-400 mt-1">Tell our assistant what you need and suppliers will quote you.</p>
          </div>
          <OpenChatButton className="shrink-0 text-center bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs transition">
            Request a quote
          </OpenChatButton>
        </section>
      </main>
    </PublicShell>
  );
}
