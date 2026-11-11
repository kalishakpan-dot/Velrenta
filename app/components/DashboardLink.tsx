'use client';

// app/components/DashboardLink.tsx
// "Back to dashboard" button for the public pages. Only renders for signed-in users
// (buyers go to /, suppliers go to /supplier). Guests see nothing.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default function DashboardLink() {
  const [dest, setDest] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!alive || !user) return;

      const { data: supplier } = await supabase
        .from('suppliers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (alive) setDest(supplier ? '/supplier' : '/');
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!dest) return null;

  return (
    <Link
      href={dest}
      aria-label="Back to dashboard"
      className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium text-slate-300 border border-slate-700 hover:border-emerald-500/50 hover:text-emerald-400 transition shrink-0"
    >
      <ArrowLeft className="w-4 h-4" />
      <span className="hidden sm:inline">Dashboard</span>
    </Link>
  );
}