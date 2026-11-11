'use client';

// app/components/RiderSettings.tsx
// Rider settings: contact details, alert sound, and password change.
// We never show the current password (it is stored as a one-way hash and cannot be read).
// To change it, the rider confirms the current password, then picks a new one.

import { useState } from 'react';
import { Eye, EyeOff, Star, Lock } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export interface RiderProfile {
  id: string;
  full_name: string;
  phone: string | null;
  vehicle_type: string;
  plate_number: string | null;
  area: string | null;
  is_online: boolean;
  is_verified: boolean;
  rating: number;
  total_errands: number;
}

interface Props {
  rider: RiderProfile;
  email: string;
  soundOn: boolean;
  onSound: (on: boolean) => void;
  onSaved: (rider: RiderProfile) => void;
  toast: (text: string, ok?: boolean) => void;
}

const VEHICLE_LABEL: Record<string, string> = { bike: 'Motorbike', tricycle: 'Keke', car: 'Car', van: 'Van' };

// 0803 123 4567 or +234 803 123 4567 -> 2348031234567
const normalizePhone = (raw: string): string | null => {
  const d = raw.replace(/\D/g, '');
  if (/^0\d{10}$/.test(d)) return `234${d.slice(1)}`;
  if (/^234\d{10}$/.test(d)) return d;
  return null;
};

const inputCls =
  'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';

export default function RiderSettings({ rider, email, soundOn, onSound, onSaved, toast }: Props) {
  const [phone, setPhone] = useState(rider.phone || '');
  const [area, setArea] = useState(rider.area || '');
  const [saving, setSaving] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  const dirty = phone.trim() !== (rider.phone || '') || area.trim() !== (rider.area || '');

  const saveProfile = async () => {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      toast('Enter a valid Nigerian phone number, for example 0803 123 4567.', false);
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc('rider_update_profile', { p_phone: normalized, p_area: area.trim() });
    setSaving(false);
    if (error || !data) {
      console.error('Profile save error:', error);
      toast('Could not save your details. Try again.', false);
      return;
    }
    const updated = data as RiderProfile;
    setPhone(updated.phone || '');
    setArea(updated.area || '');
    onSaved(updated);
    toast('Details saved');
  };

  const changePassword = async () => {
    if (!pw.current) return toast('Enter your current password.', false);
    if (pw.next.length < 8) return toast('Use at least 8 characters for the new password.', false);
    if (pw.next !== pw.confirm) return toast('The two new passwords do not match.', false);
    if (pw.next === pw.current) return toast('Choose a password different from the current one.', false);

    setSavingPw(true);
    // Confirm it is really the rider before changing anything.
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: pw.current });
    if (authErr) {
      setSavingPw(false);
      return toast('Your current password is not correct.', false);
    }
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setSavingPw(false);
    if (error) {
      console.error('Password update error:', error);
      return toast(error.message || 'Could not update your password.', false);
    }
    setPw({ current: '', next: '', confirm: '' });
    toast('Password updated. Use it the next time you sign in.');
  };

  const locked = [
    { label: 'Full name', value: rider.full_name },
    { label: 'Vehicle', value: VEHICLE_LABEL[rider.vehicle_type] || rider.vehicle_type },
    { label: 'Plate number', value: rider.plate_number || '—' },
  ];

  return (
    <div className="space-y-4">
      {/* Account */}
      <section className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <div className="flex items-center gap-3">
          <span className="h-12 w-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-base font-bold flex items-center justify-center shrink-0">
            {rider.full_name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-base font-bold text-white truncate">{rider.full_name}</p>
            <p className="text-xs text-slate-400 truncate">{email}</p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2.5 mt-4">
          <div className="rounded-lg bg-slate-950/50 border border-slate-800 px-3 py-2.5">
            <dt className="text-[11px] text-slate-500">Status</dt>
            <dd className={`text-sm font-semibold mt-0.5 ${rider.is_verified ? 'text-emerald-400' : 'text-amber-400'}`}>
              {rider.is_verified ? 'Verified' : 'Pending'}
            </dd>
          </div>
          <div className="rounded-lg bg-slate-950/50 border border-slate-800 px-3 py-2.5">
            <dt className="text-[11px] text-slate-500">Rating</dt>
            <dd className="text-sm font-semibold text-white mt-0.5 flex items-center gap-1">
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              {Number(rider.rating).toFixed(1)}
            </dd>
          </div>
          <div className="rounded-lg bg-slate-950/50 border border-slate-800 px-3 py-2.5">
            <dt className="text-[11px] text-slate-500">Errands</dt>
            <dd className="text-sm font-semibold text-white mt-0.5">{rider.total_errands}</dd>
          </div>
        </dl>
      </section>

      {/* Details */}
      <section className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <h2 className="text-sm font-semibold text-white">Your details</h2>
        <p className="text-xs text-slate-400 mt-1">Customers call this number once you accept their errand.</p>

        <div className="space-y-4 mt-4">
          <div>
            <label htmlFor="rs-phone" className="block text-xs text-slate-300 mb-1.5">Phone number</label>
            <input
              id="rs-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0803 123 4567"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="rs-area" className="block text-xs text-slate-300 mb-1.5">Area you work in</label>
            <input
              id="rs-area"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              maxLength={60}
              placeholder="e.g. Rumuola, GRA, Trans-Amadi"
              className={inputCls}
            />
          </div>

          {locked.map((f) => (
            <div key={f.label}>
              <label className="flex items-center gap-1.5 text-xs text-slate-300 mb-1.5">
                {f.label} <Lock className="w-3 h-3 text-slate-600" />
              </label>
              <input value={f.value} disabled className={`${inputCls} opacity-60 cursor-not-allowed`} />
            </div>
          ))}
          <p className="text-[11px] text-slate-500 -mt-2">Name, vehicle and plate were verified by Velrenta. Contact the team to change them.</p>
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={saveProfile}
            disabled={!dirty || saving}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold px-5 py-2.5 rounded-lg text-xs transition"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </section>

      {/* Alerts */}
      <section className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Alert sound</h2>
            <p className="text-xs text-slate-400 mt-1">Play a beep when a new errand request comes in. Your phone still vibrates.</p>
          </div>
          <button
            role="switch"
            aria-checked={soundOn}
            aria-label="Alert sound"
            onClick={() => onSound(!soundOn)}
            className={`relative w-11 h-6 rounded-full transition shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${soundOn ? 'bg-emerald-500' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${soundOn ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </section>

      {/* Password */}
      <section className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <h2 className="text-sm font-semibold text-white">Change password</h2>
        <p className="text-xs text-slate-400 mt-1">
          For your security we cannot show your current password. Enter it to confirm it is you, then choose a new one (at least 8 characters).
        </p>

        <div className="space-y-4 mt-4">
          <div>
            <label htmlFor="rs-cur" className="block text-xs text-slate-300 mb-1.5">Current password</label>
            <input
              id="rs-cur"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="rs-new" className="block text-xs text-slate-300 mb-1.5">New password</label>
            <input
              id="rs-new"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="rs-conf" className="block text-xs text-slate-300 mb-1.5">Confirm new password</label>
            <input
              id="rs-conf"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
          >
            {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showPw ? 'Hide' : 'Show'} passwords
          </button>
          <button
            onClick={changePassword}
            disabled={savingPw || !pw.current || !pw.next}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold px-5 py-2.5 rounded-lg text-xs transition"
          >
            {savingPw ? 'Updating...' : 'Update password'}
          </button>
        </div>
      </section>
    </div>
  );
}