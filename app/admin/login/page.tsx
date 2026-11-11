'use client';

// app/admin/login/page.tsx
// Admin sign-in. Signs in with Supabase, then asks the server to confirm
// this account is in the admins table. Non-admins are signed straight back out.

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');

    const { data, error: authErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authErr || !data.session) {
      setError(authErr?.message || 'Could not sign in.');
      setBusy(false);
      return;
    }

    const res = await fetch('/api/admin/data?me=1', {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      await supabase.auth.signOut();
      setError('This account does not have admin access.');
      setBusy(false);
      return;
    }

    router.replace('/admin');
  };

  const inputCls =
    'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 font-sans flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500 flex items-center justify-center text-slate-950">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">Velrenta admin</h1>
            <p className="text-xs text-slate-400">Sign in to the admin console</p>
          </div>
        </div>

        <label htmlFor="admin-email" className="block text-xs text-slate-300 mt-6 mb-1.5">
          Email
        </label>
        <input
          id="admin-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />

        <label htmlFor="admin-password" className="block text-xs text-slate-300 mt-4 mb-1.5">
          Password
        </label>
        <div className="relative">
          <input
            id="admin-password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputCls} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-200 transition"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="w-full mt-5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold py-2.5 rounded-lg text-sm transition"
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}