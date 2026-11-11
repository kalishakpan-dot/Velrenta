// app/prices/[slug]/page.tsx  → /prices/dangote-cement-50kg-price-in-port-harcourt

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import PublicShell from '../../components/PublicShell';
import PriceChart from '../../components/PriceChart';
import ChangeBadge from '../../components/ChangeBadge';
import { getAllSummaries, getSummary, fmtNaira, fmtDate, monthYear, SITE_URL } from '../../lib/market';
import { OpenChatButton } from '../../components/QuoteChat';


export const revalidate = 1800;

export async function generateStaticParams() {
  const all = await getAllSummaries();
  return all.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await getSummary(slug);
  if (!data) return { title: 'Price not found | Velrenta', robots: { index: false } };
  const { item } = data;
  const title = `Price of ${item.productName} in ${item.city} Today (${monthYear()})`;
  const description = `${item.productName} costs about ${fmtNaira(item.current)} per ${item.unit} in ${item.city}. See the price range, 30-day trend and get live quotes from suppliers.`;
  return {
    title: `${title} | Velrenta`,
    description,
    alternates: { canonical: `${SITE_URL}/prices/${item.slug}` },
    openGraph: { title, description, type: 'website', url: `${SITE_URL}/prices/${item.slug}` },
  };
}

export default async function PricePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getSummary(slug);
  if (!data) notFound();
  const { item, otherCities, sameCity } = data;

  const ask = `I need a quote for ${item.productName} in ${item.city}`;
  // const quoteHref = `/?ask=${encodeURIComponent(ask)}`;

  const faqs = [
    {
      q: `What is the price of ${item.productName} in ${item.city} today?`,
      a: `The average price of ${item.productName} in ${item.city} is about ${fmtNaira(item.current)} per ${item.unit}. Recent quotes range from ${fmtNaira(item.min)} to ${fmtNaira(item.max)}. Last updated ${fmtDate(item.updatedAt)}.`,
    },
    {
      q: `Why do prices for ${item.productName} change?`,
      a: 'Prices move with supplier stock, transport costs, fuel prices, exchange rates and demand. Quote the exact quantity and delivery location to get a firm price.',
    },
    {
      q: `How do I get the best price for ${item.productName} in ${item.city}?`,
      a: 'Request quotes from several suppliers at the same time and compare the delivered price, not just the unit price. Velrenta does this for you in one request.',
    },
  ];

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: item.productName,
      category: item.category,
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'NGN',
        lowPrice: Math.round(item.min),
        highPrice: Math.round(item.max),
        offerCount: Math.max(item.suppliers.length, 1),
        areaServed: item.city,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Prices', item: `${SITE_URL}/prices` },
        { '@type': 'ListItem', position: 2, name: `${item.productName} in ${item.city}`, item: `${SITE_URL}/prices/${item.slug}` },
      ],
    },
  ];

  return (
    <PublicShell active="prices">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <main className="max-w-5xl mx-auto px-4 pt-8">
        <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
          <Link href="/prices" className="hover:text-slate-300">Prices</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-400">{item.productName}, {item.city}</span>
        </nav>

        <h1 className="mt-4 text-3xl md:text-4xl font-bold text-white leading-tight max-w-3xl">
          Price of {item.productName} in {item.city} today
        </h1>
        <p className="text-sm text-slate-500 mt-2">Updated {fmtDate(item.updatedAt)} · {monthYear()}</p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs text-slate-400">Average price</p>
                <p className="text-4xl font-bold text-emerald-400 mt-1">
                  {fmtNaira(item.current)}
                  <span className="text-sm font-normal text-slate-500"> per {item.unit}</span>
                </p>
              </div>
              <ChangeBadge value={item.change30} />
            </div>
            <div className="mt-5">
              <PriceChart points={item.points} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs text-slate-400">Price range</p>
              <p className="text-lg font-bold text-white mt-1">
                {fmtNaira(item.min)} – {fmtNaira(item.max)}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {item.suppliers.length > 0
                  ? `From ${item.suppliers.length} supplier${item.suppliers.length > 1 ? 's' : ''}`
                  : 'Recent supplier quotes'}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
              <p className="text-sm font-bold text-white">Get today’s exact price</p>
              <p className="text-xs text-slate-300 mt-1">
                Suppliers quote your quantity, delivered to your site.
              </p>
              <OpenChatButton
                ask={ask}
                className="mt-4 block w-full text-center bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs transition"
              >
                Request a quote
              </OpenChatButton>
            </div>
          </div>
        </div>

        {otherCities.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold text-white">{item.productName} price in other cities</h2>
            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800/70 overflow-hidden">
              {[item, ...otherCities]
                .sort((a, b) => a.current - b.current)
                .map((c) => (
                  <Link
                    key={c.slug}
                    href={`/prices/${c.slug}`}
                    className={`flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-800/40 transition ${c.slug === item.slug ? 'bg-slate-800/40' : ''
                      }`}
                  >
                    <span className="text-slate-200">
                      {c.city}
                      {c.slug === item.slug && <span className="text-xs text-slate-500"> (this page)</span>}
                    </span>
                    <span className="font-semibold text-white">{fmtNaira(c.current)}</span>
                  </Link>
                ))}
            </div>
          </section>
        )}

        <section className="mt-10 max-w-3xl">
          <h2 className="text-lg font-bold text-white">Common questions</h2>
          <div className="mt-3 space-y-2">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-white list-none flex justify-between gap-3">
                  {f.q}
                  <span className="text-slate-500 group-open:rotate-45 transition shrink-0">+</span>
                </summary>
                <p className="text-sm text-slate-400 mt-2 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {sameCity.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold text-white">Other materials in {item.city}</h2>
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sameCity.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={`/prices/${s.slug}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 hover:border-slate-600 transition"
                  >
                    <span className="text-sm text-slate-200 truncate">{s.productName}</span>
                    <span className="text-sm font-semibold text-emerald-400 shrink-0">{fmtNaira(s.current)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </PublicShell>
  );
}
