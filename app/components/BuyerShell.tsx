'use client';

// app/components/BuyerShell.tsx
// Shared layout (sidebar + header) for the RFQ and PO pages. Matches the dashboard sidebar.

import { useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import NotificationBell from './NotificationBell';

// type Active = 'dashboard' | 'marketplace' | 'rfqs' | 'pos' | 'insights' | 'tracking' | 'developer' | 'dispatch';

type Active =
  | 'dashboard'
  | 'marketplace'
  | 'sharp'
  | 'rfqs'
  | 'pos'
  | 'insights'
  | 'tracking'
  | 'developer'
  | 'dispatch';


interface Props {
  active: Active;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

interface Profile {
  name: string;
  email: string;
}

const CACHE_KEY = 'velrenta_buyer_profile';

// `group: 'apps'` items show under the "Apps" heading in the desktop sidebar.
const NAV: {
  key: Active;
  href: string;
  label: string;
  Icon: typeof ShoppingBag;
  group: 'main' | 'apps';
}[] = [
  { key: 'dashboard', href: '/', label: 'Dashboard', Icon: ShoppingBag, group: 'main' },
  { key: 'marketplace', href: '/marketplace', label: 'Marketplace', Icon: Store, group: 'main' },
  { key: 'rfqs', href: '/rfqs', label: 'RFQs & quotes', Icon: FileText, group: 'main' },
  { key: 'pos', href: '/pos', label: 'Purchase orders', Icon: CheckCircle, group: 'main' },
  { key: 'tracking', href: '/tracking', label: 'Order tracking', Icon: Truck, group: 'main' },
  { key: 'insights', href: '/insights', label: 'Market insights', Icon: Newspaper, group: 'main' },
  { key: 'developer', href: '/developer', label: 'Developer API', Icon: KeyRound, group: 'main' },
  { key: 'sharp', href: '/sharp', label: 'My Plug', Icon: Wrench, group: 'apps' },
  { key: 'dispatch', href: '/dispatch', label: 'Errand', Icon: Bike, group: 'apps' },
];

const MAIN_NAV = NAV.filter((i) => i.group === 'main');
const APPS_NAV = NAV.filter((i) => i.group === 'apps');

export default function BuyerShell({ active, title, subtitle, children }: Props) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let mounted = true;

    // Show the cached profile instantly so the name never flashes "Buyer".
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) setProfile(JSON.parse(cached));
    } catch {
      /* storage unavailable */
    }

    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/login');
        return;
      }

      const [{ data: buyer }, { data: supplier }] = await Promise.all([
        supabase.from('buyers').select('contact_name, email').eq('id', user.id).maybeSingle(),
        supabase.from('suppliers').select('id').eq('user_id', user.id).maybeSingle(),
      ]);

      if (supplier) {
        router.replace('/supplier');
        return;
      }
      if (!mounted) return;

      const next: Profile = {
        name: buyer?.contact_name || user.email?.split('@')[0] || 'Buyer',
        email: buyer?.email || user.email || '',
      };
      setProfile(next);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
    };

    load();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        router.replace('/login');
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [router]);

  const handleLogout = async () => {
    try {
      sessionStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const name = profile?.name || '';
  const email = profile?.email || '';

  const renderNavLink = ({ key, href, label, Icon }: (typeof NAV)[number]) => {
    const isActive = key === active;
    return (
      <Link
        key={href}
        href={href}
        title={collapsed ? label : undefined}
        aria-current={isActive ? 'page' : undefined}
        className={`relative flex flex-1 md:flex-none flex-col md:flex-row items-center justify-center gap-1 md:gap-3 py-2.5 md:py-2 md:px-3 md:rounded-lg text-[11px] md:text-[13px] font-medium transition ${collapsed ? '' : 'md:justify-start'
          } ${isActive
            ? 'text-emerald-400 md:bg-emerald-500/10 md:before:absolute md:before:left-0 md:before:top-2 md:before:bottom-2 md:before:w-0.5 md:before:rounded-full md:before:bg-emerald-400'
            : 'text-slate-400 hover:text-slate-200 md:hover:bg-slate-800/60'
          }`}
      >
        <Icon className="w-5 h-5 md:w-[15px] md:h-[15px] shrink-0" />
        <span className={collapsed ? 'md:hidden' : ''}>{label}</span>
      </Link>
    );
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar: left rail on desktop, bottom tab bar on mobile */}
      <aside
        className={`order-last md:order-first shrink-0 flex md:flex-col bg-slate-900 border-t md:border-t-0 md:border-r border-slate-800 pb-[env(safe-area-inset-bottom)] md:pb-0 md:transition-[width] md:duration-200 ${collapsed ? 'md:w-[76px]' : 'md:w-64'
          }`}
      >
        <div
          className={`hidden md:flex items-center gap-3 h-16 border-b border-slate-800 shrink-0 ${collapsed ? 'justify-center' : 'px-5'
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

        <nav className="flex flex-1 md:flex-col md:gap-1 md:p-3" aria-label="Main">
          {MAIN_NAV.map(renderNavLink)}

          {/* "Apps" group heading (desktop only; becomes a thin divider when collapsed) */}
          <div className="hidden md:block mt-4 mb-1 px-3">
            {collapsed ? (
              <div className="h-px bg-slate-800" />
            ) : (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Apps</p>
            )}
          </div>

          {APPS_NAV.map(renderNavLink)}

          <button
            onClick={handleLogout}
            className="md:hidden flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium text-slate-400 hover:text-red-400 transition"
          >
            <LogOut className="w-5 h-5" />
            Log out
          </button>
        </nav>

        <div className="hidden md:block border-t border-slate-800 p-3 space-y-2 shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition ${collapsed ? 'justify-center' : ''
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
            className={`rounded-xl bg-slate-800/50 border border-slate-700/50 p-2.5 flex items-center gap-3 ${collapsed ? 'flex-col' : ''
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
              onClick={handleLogout}
              title="Log out"
              aria-label="Log out"
              className="text-slate-400 hover:text-red-400 p-1 transition shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 min-h-0 h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 md:p-8">
          <header className="mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-white">{title}</h1>
              {subtitle && <p className="text-slate-400 text-sm mt-1">{subtitle}</p>}
            </div>
            <div className="shrink-0">
              <NotificationBell />
            </div>
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}