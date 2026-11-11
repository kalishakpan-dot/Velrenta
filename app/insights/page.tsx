// app/insights/page.tsx  → /insights   (construction news + market movers)

import type { Metadata } from 'next';
import Link from 'next/link';
import PublicShell from '../components/PublicShell';
import { OpenChatButton } from '../components/QuoteChat';
import ChangeBadge from '../components/ChangeBadge';
import { getNews, timeAgo, TOPICS } from '../lib/news';
import { getAllSummaries, fmtNaira, SITE_URL } from '../lib/market';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Construction News & Building Material Price Trends in Nigeria | Velrenta',
  description:
    'Daily construction and building news in Nigeria, plus the building materials whose prices moved most this month.',
  alternates: { canonical: `${SITE_URL}/insights` },
};

export default async function Insights({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic = 'all' } = await searchParams;
  const [news, summaries] = await Promise.all([getNews(topic), getAllSummaries()]);

  const movers = summaries
    .filter((s) => s.change30 !== null && Math.abs(s.change30) >= 0.5)
    .sort((a, b) => Math.abs(b.change30!) - Math.abs(a.change30!))
    .slice(0, 4);

  return (
    <PublicShell active="insights">
      <main className="max-w-5xl mx-auto px-4 pt-10">
        <h1 className="text-3xl md:text-4xl font-bold text-white max-w-2xl leading-tight">
          Construction news and market trends
        </h1>
        <p className="text-slate-400 mt-3 max-w-xl">
          Headlines from across the industry, with the material prices that moved most this month.
        </p>

        {movers.length > 0 && (
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">Biggest price moves this month</h2>
              <Link href="/prices" className="text-xs font-medium text-emerald-400 hover:text-emerald-300">
                All prices
              </Link>
            </div>
            <ul className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {movers.map((m) => (
                <li key={m.slug}>
                  <Link
                    href={`/prices/${m.slug}`}
                    className="block h-full rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-slate-600 transition"
                  >
                    <p className="text-xs text-slate-400 truncate">{m.productName}</p>
                    <p className="text-[11px] text-slate-500 truncate">{m.city}</p>
                    <p className="text-lg font-bold text-white mt-3">{fmtNaira(m.current)}</p>
                    <div className="mt-1.5"><ChangeBadge value={m.change30} /></div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10">
          <h2 className="sr-only">Latest news</h2>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="News topics">
            {TOPICS.map((t) => (
              <Link
                key={t.key}
                href={t.key === 'all' ? '/insights' : `/insights?topic=${t.key}`}
                aria-current={topic === t.key ? 'page' : undefined}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  topic === t.key
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                    : 'text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-200'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>

          {news.length === 0 ? (
            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-10 text-center">
              <p className="text-sm text-slate-300">News is unavailable right now</p>
              <p className="text-xs text-slate-500 mt-1">Check back in a few minutes.</p>
            </div>
          ) : (
            <ul className="mt-6 rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800/70 overflow-hidden">
              {news.map((n) => (
                <li key={n.link}>
                  <a
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="block px-4 py-4 hover:bg-slate-800/40 transition"
                  >
                    <p className="text-sm font-medium text-white leading-snug">{n.title}</p>
                    <p className="text-xs text-slate-500 mt-1.5">
                      {n.source} · {timeAgo(n.publishedAt)}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-600 mt-3">
            Headlines link to the original publishers. Velrenta is not responsible for third-party content.
          </p>
        </section>

        <section className="mt-10 rounded-xl border border-slate-800 bg-slate-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-white">Buying materials soon?</h2>
            <p className="text-xs text-slate-400 mt-1">Compare quotes from verified suppliers in one request.</p>
          </div>
               <OpenChatButton className="shrink-0 text-center bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs transition">
            Request a quote
          </OpenChatButton>
        </section>
      </main>
    </PublicShell>
  );
}
