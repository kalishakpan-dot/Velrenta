'use client';

// app/components/BuyerNav.tsx
// The single buyer navigation. Desktop: left sidebar. Phone: bottom bar (4 main tabs + More sheet).
// Used by the dashboard (app/page.tsx) and BuyerShell, so every page looks and behaves the same.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FileText,
  ShoppingBag,
  CheckCircle,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  Store,
  Newspaper,
  KeyRound,
  Truck,
  Bike,
  Wrench,
  MoreHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  short: string;
  Icon: LucideIcon;
  group: 'main' | 'apps';
  primary?: boolean; // shown in the phone bottom bar; everything else goes in "More"
}

const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', short: 'Home', Icon: ShoppingBag, group: 'main', primary: true },
  { href: '/marketplace', label: 'Marketplace', short: 'Market', Icon: Store, group: 'main', primary: true },
  { href: '/rfqs', label: 'RFQs & quotes', short: 'RFQs', Icon: FileText, group: 'main', primary: true },
  { href: '/pos', label: 'Purchase orders', short: 'Orders', Icon: CheckCircle, group: 'main', primary: true },
  { href: '/tracking', label: 'Order tracking', short: 'Tracking', Icon: Truck, group: 'main' },
  { href: '/insights', label: 'Market insights', short: 'Insights', Icon: Newspaper, group: 'main' },
  { href: '/developer', label: 'Developer API', short: 'API', Icon: KeyRound, group: 'main' },
  { href: '/sharp', label: 'My Plug', short: 'Plug', Icon: Wrench, group: 'apps' },
  { href: '/dispatch', label: 'Errand', short: 'Errand', Icon: Bike, group: 'apps' },
];

const MAIN = NAV.filter((i) => i.group === 'main');
const APPS = NAV.filter((i) => i.group === 'apps');
const PRIMARY = NAV.filter((i) => i.primary);
const MORE = NAV.filter((i) => !i.primary);

interface Props {
  name?: string;
  email?: string;
  onLogout: () => void;
}

export default function BuyerNav({ name = '', email = '', onLogout }: Props) {
  const pathname = usePathname() || '/';
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const moreActive = MORE.some((i) => isActive(i.href));

  // Close the sheet when the page changes, and on Escape.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const desktopLink = ({ href, label, Icon }: NavItem) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        title={collapsed ? label : undefined}
        aria-current={active ? 'page' : undefined}
        className={`relative flex items-center gap-3 py-2 px-3 rounded-lg text-[13px] font-medium transition ${
          collapsed ? 'justify-center' : ''
        } ${
          active
            ? 'text-emerald-400 bg-emerald-500/10 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-emerald-400'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
        }`}
      >
        <Icon className="w-[15px] h-[15px] shrink-0" />
        {!collapsed && <span>{label}</span>}
      </Link>
    );
  };

  const tabCls = (active: boolean) =>
    `relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 pt-2 pb-2.5 text-[10px] font-medium transition ${
      active ? 'text-emerald-400' : 'text-slate-400 active:text-slate-200'
    }`;

  return (
    <>
      <aside
        className={`order-last md:order-first shrink-0 bg-slate-900 border-t md:border-t-0 md:border-r border-slate-800 md:flex md:flex-col md:transition-[width] md:duration-200 ${
          collapsed ? 'md:w-[76px]' : 'md:w-64'
        }`}
      >
        {/* Desktop: brand */}
        <div
          className={`hidden md:flex items-center gap-3 h-16 border-b border-slate-800 shrink-0 ${
            collapsed ? 'justify-center' : 'px-5'
          }`}
        >
          <div className="h-9 w-9 rounded-xl bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-xl shrink-0">
            V
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-tight">Velrenta</p>
              <p className="text-[11px] text-slate-400 leading-tight">Buyer portal</p>
            </div>
          )}
        </div>

        {/* Desktop: links */}
        <nav className="hidden md:flex flex-col gap-1 p-3 flex-1 overflow-y-auto" aria-label="Main">
          {MAIN.map(desktopLink)}
          <div className="mt-4 mb-1 px-3">
            {collapsed ? (
              <div className="h-px bg-slate-800" />
            ) : (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Apps</p>
            )}
          </div>
          {APPS.map(desktopLink)}
        </nav>

        {/* Phone: bottom bar */}
        <nav className="md:hidden flex pb-[env(safe-area-inset-bottom)]" aria-label="Main">
          {PRIMARY.map(({ href, short, Icon }) => {
            const active = isActive(href);
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={tabCls(active)}>
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-emerald-400" />}
                <Icon className="w-5 h-5" />
                <span className="truncate max-w-full px-0.5">{short}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={tabCls(moreActive)}
          >
            {moreActive && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-emerald-400" />}
            <MoreHorizontal className="w-5 h-5" />
            <span>More</span>
          </button>
        </nav>

        {/* Desktop: collapse + profile */}
        <div className="hidden md:block border-t border-slate-800 p-3 space-y-2 shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            {collapsed ? (
              <ChevronsRight className="w-4 h-4" />
            ) : (
              <>
                <ChevronsLeft className="w-4 h-4" /> Collapse
              </>
            )}
          </button>

          <div
            className={`rounded-xl bg-slate-800/50 border border-slate-700/50 p-2.5 flex items-center gap-3 ${
              collapsed ? 'flex-col' : ''
            }`}
          >
            <div
              title={collapsed ? name || undefined : undefined}
              className="h-9 w-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center font-bold text-xs text-emerald-400 shrink-0"
            >
              {name?.[0]?.toUpperCase() || 'U'}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate">{name || '\u00A0'}</p>
                <p className="text-[11px] text-slate-400 truncate">{email || '\u00A0'}</p>
              </div>
            )}
            <button
              onClick={onLogout}
              title="Log out"
              aria-label="Log out"
              className="text-slate-400 hover:text-red-400 p-1 transition shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Phone: "More" bottom sheet */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="More">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-slate-900 border-t border-slate-800 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center font-bold text-xs text-emerald-400 shrink-0">
                  {name?.[0]?.toUpperCase() || 'U'}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{name || 'Buyer'}</p>
                  <p className="text-[11px] text-slate-400 truncate">{email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="p-2 text-slate-400 hover:text-white shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {MORE.map(({ href, label, Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-2 py-4 text-center text-[11px] font-medium leading-tight transition ${
                      active
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300 active:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {label}
                  </Link>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border border-slate-800 py-3 text-sm font-medium text-slate-300 hover:text-red-400 hover:border-red-500/30 transition"
            >
              <LogOut className="w-4 h-4" /> Log out
            </button>
          </div>
        </div>
      )}
    </>
  );
}