'use client';

// app/login/page.tsx
// The ONLY place where users sign in or register.
// After sign-in we check which role the auth user has and route:
//   - has a row in suppliers (user_id = auth id) -> /supplier
//   - anyone else                                 -> / (buyer dashboard)

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, FileText, Wallet, Package, Clock } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // Sends a signed-in user to the right dashboard.
  const routeByRole = async (userId: string) => {
    const { data: supplierRow, error: supplierError } = await supabase
      .from('suppliers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (supplierError) console.error('Supplier lookup error:', supplierError);

    router.replace(supplierRow ? '/supplier' : '/');
  };

  // If someone is already signed in, skip the form.
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) await routeByRole(user.id);
      else setChecking(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      if (isSignUp) {
        // Public sign-up only creates BUYER accounts. Suppliers are
        // provisioned by an admin and linked through suppliers.user_id.
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { contact_name: contactName, phone } },
        });
        if (error) throw error;

        if (data.session && data.user) {
          await supabase.from('buyers').upsert(
            {
              id: data.user.id,
              email: data.user.email,
              contact_name: contactName,
              phone,
              company_name: email.split('@')[0],
            },
            { onConflict: 'id' }
          );
          router.replace('/');
        } else {
          // Email confirmation is on: no session until they confirm.
          setIsSignUp(false);
          setInfo('Account created. Check your email to confirm it, then sign in.');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) await routeByRole(data.user.id);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (signUp: boolean) => {
    setIsSignUp(signUp);
    setError('');
    setInfo('');
  };

  if (checking) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
        <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
      </div>
    );
  }

  const inputClass =
    'w-full mt-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition';
  const labelClass = 'block text-xs font-medium text-slate-300';

  const points = [
    { Icon: FileText, text: 'Request quotes from verified suppliers' },
    { Icon: Package, text: 'Issue purchase orders in one step' },
    { Icon: Wallet, text: 'Track acceptance, delivery and payment' },
  ];

  return (
    <div className="min-h-screen w-screen grid lg:grid-cols-[1.05fr_1fr] bg-slate-950 text-white">
      {/* Brand panel (desktop) */}
      <aside className="hidden lg:flex flex-col justify-between bg-slate-900 border-r border-slate-800 p-12 xl:p-16">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-2xl">
            V
          </div>
          <span className="text-xl font-bold tracking-wide">Velrenta</span>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl xl:text-4xl font-bold leading-tight">
            Buy materials without the back-and-forth.
          </h2>
          <p className="text-slate-400 mt-4 text-sm leading-relaxed">
            Velrenta connects buyers and suppliers in one place, from the first quote to the final payment.
          </p>

          <ul className="mt-8 space-y-4">
            {points.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-slate-300">
                <span className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-emerald-400" />
                </span>
                {text}
              </li>
            ))}
          </ul>

          {/* Example of what a supplier sees */}
          <div className="mt-10 rounded-xl border border-slate-800 bg-slate-950/60 p-4 relative overflow-hidden before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-amber-400">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-white">PO-20260930120000</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-500/10 text-amber-400 border-amber-500/30">
                    Pending
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1.5">200 x 6-inch steel pipes, Schedule 40</p>
              </div>
              <p className="text-sm font-bold text-emerald-400 shrink-0">₦6,000,000</p>
            </div>
            <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> Example of an order waiting for a supplier's response
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-600">© {new Date().getFullYear()} Velrenta</p>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="h-9 w-9 rounded-xl bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-xl">
              V
            </div>
            <span className="text-xl font-bold tracking-wide">Velrenta</span>
          </div>

          <h1 className="text-2xl font-bold">{isSignUp ? 'Create your buyer account' : 'Welcome back'}</h1>
          <p className="text-sm text-slate-400 mt-1.5">
            {isSignUp ? 'Register to request quotes and place orders.' : 'Sign in to continue to your dashboard.'}
          </p>

          {/* Mode switch */}
          <div role="tablist" className="grid grid-cols-2 gap-1 p-1 mt-6 rounded-xl bg-slate-900 border border-slate-800">
            {[
              { key: false, label: 'Sign in' },
              { key: true, label: 'Register' },
            ].map((t) => (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={isSignUp === t.key}
                onClick={() => switchMode(t.key)}
                className={`py-2 rounded-lg text-sm font-medium transition ${
                  isSignUp === t.key ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleAuth} className="mt-6 space-y-4">
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <span>{error}</span>
              </div>
            )}
            {info && (
              <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
                <span>{info}</span>
              </div>
            )}

            {isSignUp && (
              <>
                <div>
                  <label htmlFor="contact-name" className={labelClass}>Contact name</label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="phone" className={labelClass}>WhatsApp number</label>
                  <input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    required
                    autoComplete="tel"
                    placeholder="2348012345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={inputClass}
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5">Include the country code. We send order updates here.</p>
                </div>
              </>
            )}

            <div>
              <label htmlFor="email" className={labelClass}>Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="password" className={labelClass}>Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={isSignUp ? 6 : undefined}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 mt-[3px] p-2 text-slate-500 hover:text-slate-200 transition"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {isSignUp && <p className="text-[11px] text-slate-500 mt-1.5">Use at least 6 characters.</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? (isSignUp ? 'Creating account...' : 'Signing in...') : isSignUp ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
            <p className="text-xs font-medium text-slate-200">Are you a supplier?</p>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Sign in with the credentials our team gave you. You'll go straight to your supplier dashboard.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}