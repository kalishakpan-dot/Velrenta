'use client';

// app/components/SupplierAccessModal.tsx
// One dialog for three jobs: add a supplier, give an existing supplier a login, reset a password.

import { useState } from 'react';
import { X, Copy, RefreshCw, Eye, EyeOff, Check } from 'lucide-react';

export interface SupplierLite {
  id: string;
  company_name: string | null;
  email: string | null;
}

type Act = (action: string, payload: Record<string, unknown>, success: string, key: string) => Promise<boolean>;

interface Props {
  mode: 'create' | 'login' | 'password';
  supplier?: SupplierLite;
  act: Act;
  busy: string | null;
  onClose: () => void;
}

const TERM_PRESETS = ['100% upfront', '70% upfront', '50% upfront, 50% on delivery', '30% upfront, 70% on delivery', 'Net 30 days'];
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // no look-alike characters

const genPassword = (len = 12) => {
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
};

const inputCls =
  'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';

export default function SupplierAccessModal({ mode, supplier, act, busy, onClose }: Props) {
  const [f, setF] = useState({
    company_name: '',
    contact_name: '',
    email: supplier?.email || '',
    phone: '',
    city: '',
    payment_terms: '',
    level: 'basic',
    verified: true,
    password: genPassword(),
  });
  const [showPw, setShowPw] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState<{ email: string; password: string } | null>(null);

  const key = mode === 'create' ? 'new-supplier' : `${mode}-${supplier?.id}`;
  const working = busy === key;
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

  const title =
    mode === 'create'
      ? 'Add supplier'
      : mode === 'login'
        ? `Create login for ${supplier?.company_name || 'supplier'}`
        : `Reset password for ${supplier?.company_name || 'supplier'}`;

  const submit = async () => {
    setError('');
    const email = f.email.trim();
    if (mode === 'create') {
      if (!f.company_name.trim()) return setError('Enter the company name.');
      if (!f.contact_name.trim()) return setError('Enter a contact name.');
    }
    if (mode !== 'password' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid email address.');
    if (f.password.length < 8) return setError('Password must be at least 8 characters.');

    let ok = false;
    if (mode === 'create') {
      ok = await act('create_supplier', { ...f, email }, 'Supplier created', key);
    } else if (mode === 'login') {
      ok = await act('create_supplier_login', { id: supplier!.id, email, password: f.password }, 'Login created', key);
    } else {
      ok = await act('reset_supplier_password', { id: supplier!.id, password: f.password }, 'Password reset', key);
    }
    if (ok) setDone({ email: mode === 'password' ? supplier?.email || '' : email, password: f.password });
  };

  const loginUrl = typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login';

  const copyDetails = async () => {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(`Velrenta supplier login\nWebsite: ${loginUrl}\nEmail: ${done.email}\nPassword: ${done.password}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: details are still on screen */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate">{done ? 'Share these login details' : title}</h2>
            <p className="text-xs text-slate-400 mt-1">
              {done
                ? 'The password is only shown now. Send it to the supplier securely.'
                : mode === 'create'
                  ? 'Creates the supplier and their login in one step.'
                  : mode === 'login'
                    ? 'This supplier has no way to sign in yet.'
                    : 'Sets a new password. The old one stops working immediately.'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200 p-1 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <>
            <dl className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 divide-y divide-slate-800 text-sm">
              <div className="px-3.5 py-2.5">
                <dt className="text-[11px] text-slate-500">Sign in at</dt>
                <dd className="text-slate-200 break-all">{loginUrl}</dd>
              </div>
              <div className="px-3.5 py-2.5">
                <dt className="text-[11px] text-slate-500">Email</dt>
                <dd className="text-slate-200 break-all">{done.email}</dd>
              </div>
              <div className="px-3.5 py-2.5">
                <dt className="text-[11px] text-slate-500">Password</dt>
                <dd className="font-mono text-emerald-400 tracking-wide break-all">{done.password}</dd>
              </div>
            </dl>
            <p className="text-[11px] text-slate-500 mt-3">
              Suppliers can change their password themselves under Settings after their first login.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={copyDetails}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold border border-slate-700 hover:border-slate-500 text-slate-300 transition"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy login details'}
              </button>
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              {mode === 'create' && (
                <>
                  <div className="sm:col-span-2">
                    <label htmlFor="sa-company" className="block text-xs text-slate-300 mb-1.5">Company name</label>
                    <input id="sa-company" value={f.company_name} onChange={(e) => set({ company_name: e.target.value })} placeholder="e.g. Global Pipe Traders" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="sa-contact" className="block text-xs text-slate-300 mb-1.5">Contact name</label>
                    <input id="sa-contact" value={f.contact_name} onChange={(e) => set({ contact_name: e.target.value })} placeholder="Who buyers speak to" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="sa-phone" className="block text-xs text-slate-300 mb-1.5">Phone / WhatsApp (optional)</label>
                    <input id="sa-phone" value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+2348012345678" className={inputCls} />
                  </div>
                </>
              )}

              {mode !== 'password' && (
                <div className={mode === 'create' ? '' : 'sm:col-span-2'}>
                  <label htmlFor="sa-email" className="block text-xs text-slate-300 mb-1.5">Login email</label>
                  <input id="sa-email" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="supplier@company.com" className={inputCls} />
                </div>
              )}

              {mode === 'create' && (
                <>
                  <div>
                    <label htmlFor="sa-city" className="block text-xs text-slate-300 mb-1.5">City (optional)</label>
                    <input id="sa-city" value={f.city} onChange={(e) => set({ city: e.target.value })} placeholder="e.g. Port Harcourt" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="sa-terms" className="block text-xs text-slate-300 mb-1.5">Payment terms (optional)</label>
                    <input id="sa-terms" list="sa-terms-list" value={f.payment_terms} onChange={(e) => set({ payment_terms: e.target.value })} placeholder="e.g. 30% upfront, 70% on delivery" className={inputCls} />
                    <datalist id="sa-terms-list">
                      {TERM_PRESETS.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label htmlFor="sa-level" className="block text-xs text-slate-300 mb-1.5">Trust level</label>
                    <select id="sa-level" value={f.level} onChange={(e) => set({ level: e.target.value })} className={`${inputCls} capitalize`}>
                      {['basic', 'verified', 'trusted'].map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2.5 text-xs text-slate-300 self-end pb-2.5 cursor-pointer">
                    <input type="checkbox" checked={f.verified} onChange={(e) => set({ verified: e.target.checked })} className="h-4 w-4 accent-emerald-500" />
                    Verified now (can receive orders)
                  </label>
                </>
              )}

              <div className="sm:col-span-2">
                <label htmlFor="sa-pw" className="block text-xs text-slate-300 mb-1.5">{mode === 'password' ? 'New password' : 'Password'}</label>
                <div className="flex gap-2">
                  <input
                    id="sa-pw"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={f.password}
                    onChange={(e) => set({ password: e.target.value })}
                    className={`${inputCls} font-mono`}
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'} className="px-3 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition shrink-0">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button type="button" onClick={() => { set({ password: genPassword() }); setShowPw(true); }} aria-label="Generate password" className="px-3 rounded-lg border border-slate-700 hover:border-emerald-500/50 text-slate-400 hover:text-emerald-400 transition shrink-0">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">At least 8 characters. A strong one is generated for you.</p>
              </div>
            </div>

            {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition">
                Cancel
              </button>
              <button onClick={submit} disabled={working} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 transition">
                {working ? 'Saving...' : mode === 'create' ? 'Create supplier' : mode === 'login' ? 'Create login' : 'Reset password'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}