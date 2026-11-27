'use client';

// app/waitlist/page.tsx
// Public page. No sign-in needed. Saves to the "waitlist" table.

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, AlertCircle, CheckCircle2, Users, Building2, Wrench, Bike, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import Image from 'next/image';


type Role = 'buyer' | 'supplier' | 'provider' | 'rider';

const ROLES: { key: Role; label: string; hint: string; Icon: typeof Users }[] = [
    { key: 'buyer', label: 'Buyer', hint: 'Order materials', Icon: Users },
    { key: 'supplier', label: 'Supplier', hint: 'Sell materials', Icon: Building2 },
    { key: 'provider', label: 'Service provider', hint: 'Get hired on My Plug', Icon: Wrench },
    { key: 'rider', label: 'Rider', hint: 'Run errands', Icon: Bike },
];

export default function WaitlistPage() {
    const [role, setRole] = useState<Role>('buyer');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [city, setCity] = useState('');
    const [note, setNote] = useState('');
    const [website, setWebsite] = useState(''); // honeypot: real people never fill this
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState<null | 'new' | 'existing'>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Bots fill hidden fields. Pretend it worked and save nothing.
        if (website) {
            setDone('new');
            return;
        }

        const cleanEmail = email.trim().toLowerCase();
        if (!name.trim() || !cleanEmail) {
            setError('Please add your name and email.');
            return;
        }

        setLoading(true);
        const { error: err } = await supabase.from('waitlist').insert({
            name: name.trim(),
            email: cleanEmail,
            phone: phone.trim() || null,
            role,
            city: city.trim() || null,
            note: note.trim() || null,
        });
        setLoading(false);

        if (err) {
            // 23505 = this email is already on the list
            if (err.code === '23505') {
                setDone('existing');
                return;
            }
            console.error('Waitlist error:', err);
            setError('Something went wrong. Please try again in a moment.');
            return;
        }
        setDone('new');
    };

    const field =
        'w-full mt-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition';
    const label = 'block text-xs font-medium text-slate-300';

    return (
        <div className="min-h-screen w-full bg-slate-950 text-white flex items-center justify-center p-5 sm:p-8">
            <div className="w-full max-w-md">
                <div className="flex items-center gap-3 mb-8">
                    <Image
                        src="/logoo.png"
                        alt="Velrenta Logo"
                        width={56}
                        height={56}
                        priority
                        className="h-14 w-14 object-contain"
                    />
                    <span className="text-xl font-bold tracking-wide">Velrenta</span>
                </div>

                {done ? (
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
                        <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                        <h1 className="text-xl font-bold mt-4">
                            {done === 'existing' ? "You're already on the list" : "You're on the list!"}
                        </h1>
                        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                            {done === 'existing'
                                ? 'This email is already registered. We will contact you as soon as Velrenta opens.'
                                : 'Thank you for your interest. We will email you as soon as Velrenta opens.'}
                        </p>
                        <Link
                            href="/login"
                            className="inline-flex items-center gap-1.5 mt-5 text-xs font-medium text-slate-300 hover:text-emerald-400 transition"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                        </Link>
                    </div>
                ) : (
                    <>
                        <h1 className="text-2xl sm:text-3xl font-bold leading-tight">Be first in line for Velrenta</h1>
                        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                            We are putting the finishing touches on the platform. Join the waitlist and we will let you know the
                            moment it opens.
                        </p>

                        <form onSubmit={submit} className="mt-6 space-y-4">
                            {error && (
                                <div
                                    role="alert"
                                    className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-xs text-red-300"
                                >
                                    <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <fieldset>
                                <legend className={label}>I am a</legend>
                                <div className="grid grid-cols-2 gap-2 mt-1.5">
                                    {ROLES.map(({ key, label: l, hint, Icon }) => {
                                        const on = role === key;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                aria-pressed={on}
                                                onClick={() => setRole(key)}
                                                className={`text-left rounded-xl border px-3 py-2.5 transition ${on
                                                    ? 'border-emerald-500 bg-emerald-500/10'
                                                    : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                                                    }`}
                                            >
                                                <span className="flex items-center gap-2 text-sm font-semibold">
                                                    <Icon className={`w-4 h-4 ${on ? 'text-emerald-400' : 'text-slate-400'}`} />
                                                    {l}
                                                </span>
                                                <span className="block text-[11px] text-slate-500 mt-0.5">{hint}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </fieldset>

                            <div>
                                <label htmlFor="wl-name" className={label}>Full name</label>
                                <input
                                    id="wl-name"
                                    type="text"
                                    required
                                    maxLength={100}
                                    autoComplete="name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className={field}
                                />
                            </div>

                            <div>
                                <label htmlFor="wl-email" className={label}>Email</label>
                                <input
                                    id="wl-email"
                                    type="email"
                                    required
                                    maxLength={200}
                                    autoComplete="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className={field}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="wl-phone" className={label}>WhatsApp (optional)</label>
                                    <input
                                        id="wl-phone"
                                        type="tel"
                                        inputMode="tel"
                                        maxLength={30}
                                        autoComplete="tel"
                                        placeholder="2348012345678"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        className={field}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="wl-city" className={label}>City (optional)</label>
                                    <input
                                        id="wl-city"
                                        type="text"
                                        maxLength={80}
                                        placeholder="Port Harcourt"
                                        value={city}
                                        onChange={(e) => setCity(e.target.value)}
                                        className={field}
                                    />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="wl-note" className={label}>
                                    {role === 'supplier'
                                        ? 'What do you sell? (optional)'
                                        : role === 'provider'
                                            ? 'What service do you offer? (optional)'
                                            : 'Anything you want us to know? (optional)'}
                                </label>
                                <textarea
                                    id="wl-note"
                                    rows={2}
                                    maxLength={500}
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    className={`${field} resize-none`}
                                />
                            </div>

                            {/* Honeypot: hidden from people and screen readers */}
                            <div className="absolute left-[-9999px]" aria-hidden="true">
                                <label htmlFor="wl-website">Website</label>
                                <input
                                    id="wl-website"
                                    type="text"
                                    tabIndex={-1}
                                    autoComplete="off"
                                    value={website}
                                    onChange={(e) => setWebsite(e.target.value)}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold py-2.5 rounded-xl text-sm transition"
                            >
                                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                                {loading ? 'Joining...' : 'Join the waitlist'}
                            </button>

                            <p className="text-[11px] text-slate-500 text-center">
                                We only use your details to tell you when Velrenta opens.{' '}
                                <Link href="/login" className="text-slate-400 hover:text-emerald-400 underline underline-offset-2">
                                    Already have an account?
                                </Link>
                            </p>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}