// app/components/PublicShell.tsx
// Header + footer for public (no login) pages, so Google visitors see the brand and a clear next step.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { QuoteChatProvider, OpenChatButton } from './QuoteChat';
import DashboardLink from './DashboardLink';

const LINKS = [
  { href: '/prices', label: 'Material prices', short: 'Prices', key: 'prices' },
  { href: '/insights', label: 'Industry news', short: 'News', key: 'insights' },
];

export default function PublicShell({
  active,
  children,
}: {
  active?: 'prices' | 'insights';
  children: ReactNode;
}) {
  return (
    <QuoteChatProvider>
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
        <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
          <div className="max-w-5xl mx-auto px-3 sm:px-4 h-16 flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 shrink-0">
              <DashboardLink />
              <Link href="/prices" className="flex items-center gap-2.5" aria-label="Velrenta prices">
                <span className="h-9 w-9 rounded-xl bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-xl">
                  V
                </span>
                <span className="hidden md:block text-sm font-bold text-white">Velrenta</span>
              </Link>
            </div>

            <nav className="flex items-center gap-0.5 sm:gap-1 min-w-0" aria-label="Main">
              {LINKS.map((l) => (
                <Link
                  key={l.key}
                  href={l.href}
                  aria-current={active === l.key ? 'page' : undefined}
                  className={`px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                    active === l.key
                      ? 'text-emerald-400 bg-emerald-500/10'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <span className="sm:hidden">{l.short}</span>
                  <span className="hidden sm:inline">{l.label}</span>
                </Link>
              ))}
            </nav>

            <OpenChatButton className="shrink-0 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3 sm:px-4 py-2 rounded-xl text-xs transition whitespace-nowrap">
              Get quotes
            </OpenChatButton>
          </div>
        </header>

        {children}

        <footer className="border-t border-slate-800 mt-16">
          <div className="max-w-5xl mx-auto px-4 py-8 text-xs text-slate-500 space-y-2">
            <p>
              Prices are averages of supplier quotes on Velrenta and change often. Treat them as a guide and
              request a live quote before you buy.
            </p>
            <p>© {new Date().getFullYear()} Velrenta. Building materials, sourced and delivered.</p>
          </div>
        </footer>
      </div>
    </QuoteChatProvider>
  );
}