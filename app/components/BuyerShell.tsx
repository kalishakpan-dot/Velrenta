'use client';

// app/components/BuyerShell.tsx
// Shared layout (sidebar + header) for the buyer pages. The navigation lives in BuyerNav.

import { useState, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import NotificationBell from './NotificationBell';
import BuyerNav from './BuyerNav';

interface Props {
  // Kept so existing pages (active="pos" etc.) still compile. The nav now reads the URL itself.
  active?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

interface Profile {
  name: string;
  email: string;
}

const CACHE_KEY = 'velrenta_buyer_profile';

export default function BuyerShell({ title, subtitle, children }: Props) {
  const router = useRouter();
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

  return (
  <div className="flex flex-col md:flex-row h-dvh w-full bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <BuyerNav name={profile?.name || ''} email={profile?.email || ''} onLogout={handleLogout} />

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