// app/api/admin/riders/route.ts
// Admin: list riders + payouts, create a rider (login + profile), verify/suspend, reset password, settle payouts.

import { NextResponse } from 'next/server';
import { adminDb, requireAdmin } from '../../../lib/adminServer';

export const dynamic = 'force-dynamic';

const phoneNorm = (raw: unknown) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (/^0\d{10}$/.test(d)) return `234${d.slice(1)}`;
  if (/^234\d{10}$/.test(d)) return d;
  return null;
};
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

// True if this login is also used as a supplier, or has buyer-side records (orders, RFQs, errands).
async function loginInUse(uid: string) {
  const { data: sup } = await adminDb.from('suppliers').select('id').eq('user_id', uid).limit(1);
  if (sup?.length) return true;
  for (const t of ['purchase_orders', 'rfqs', 'dispatch_errands']) {
    const { count } = await adminDb.from(t).select('*', { count: 'exact', head: true }).eq('buyer_id', uid);
    if (count) return true;
  }
  return false;
}

export async function GET(req: Request) {
  if (!(await requireAdmin(req))) return bad('Not authorized', 401);
  const [riders, payouts] = await Promise.all([
    adminDb.from('riders').select('id, user_id, full_name, phone, email, vehicle_type, plate_number, area, is_online, is_verified, suspended, rating, review_count, total_errands, bank_name, account_name, account_number, created_at').order('created_at', { ascending: false }),
    adminDb.from('rider_payouts').select('*').order('requested_at', { ascending: false }).limit(100),
  ]);
  if (riders.error) return bad(riders.error.message, 500);
  return NextResponse.json({ riders: riders.data ?? [], payouts: payouts.data ?? [] });
}

export async function POST(req: Request) {
  if (!(await requireAdmin(req))) return bad('Not authorized', 401);
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || '');

  const rider = async () => (await adminDb.from('riders').select('id, user_id').eq('id', id).maybeSingle()).data;

  switch (b.action) {
    case 'create': {
      const name = String(b.full_name || '').trim();
      const email = String(b.email || '').trim().toLowerCase();
      const phone = phoneNorm(b.phone);
      const password = String(b.password || '');
      if (name.length < 3) return bad("Enter the rider's full name.");
      if (!/^\S+@\S+\.\S+$/.test(email)) return bad('Enter a valid email.');
      if (!phone) return bad('Enter a valid Nigerian phone number.');
      if (password.length < 8) return bad('Password must be at least 8 characters.');
      const vehicle = ['bike', 'tricycle', 'car', 'van'].includes(b.vehicle_type) ? b.vehicle_type : 'bike';

      const { data: u, error: ue } = await adminDb.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { role: 'rider', full_name: name },
      });
      if (ue || !u?.user) return bad(ue?.message || 'Could not create the login.');

      const { error: re } = await adminDb.from('riders').insert({
        user_id: u.user.id, full_name: name, email, phone, vehicle_type: vehicle,
        plate_number: String(b.plate_number || '').trim().toUpperCase() || null,
        area: String(b.area || '').trim() || null,
        is_verified: true, is_online: false, rating: 5, base_rating: 5,
      });
      if (re) {
        await adminDb.auth.admin.deleteUser(u.user.id); // no orphan logins
        return bad(re.message, 500);
      }
      return NextResponse.json({ ok: true });
    }

    case 'set_verified': {
      const { error } = await adminDb.from('riders').update({ is_verified: !!b.verified, ...(b.verified ? {} : { is_online: false }) }).eq('id', id);
      return error ? bad(error.message, 500) : NextResponse.json({ ok: true });
    }

    case 'set_suspended': {
      const r = await rider();
      if (!r) return bad('Rider not found.', 404);
      const suspended = !!b.suspended;
      // Suspending also unverifies + offlines the rider (so they leave the dispatch queue) and bans the login.
      const { error } = await adminDb.from('riders').update(suspended
        ? { suspended: true, is_verified: false, is_online: false }
        : { suspended: false, is_verified: true }).eq('id', id);
      if (error) return bad(error.message, 500);
      if (r.user_id) await adminDb.auth.admin.updateUserById(r.user_id, { ban_duration: suspended ? '876000h' : 'none' });
      return NextResponse.json({ ok: true });
    }

    case 'set_password': {
      const r = await rider();
      const password = String(b.password || '');
      if (!r?.user_id) return bad('This rider has no login.');
      if (password.length < 8) return bad('Password must be at least 8 characters.');
      const { error } = await adminDb.auth.admin.updateUserById(r.user_id, { password });
      return error ? bad(error.message) : NextResponse.json({ ok: true });
    }

    case 'delete': {
      const r = await rider();
      if (!r) return bad('Rider not found.', 404);
      const count = async (table: string, f: (q: any) => any) => (await f(adminDb.from(table).select('*', { count: 'exact', head: true }).eq('rider_id', id))).count || 0;

      if (await count('dispatch_errands', (q) => q.in('status', ['accepted', 'in_progress']))) {
        return bad('This rider has an errand in progress. Wait until it is finished or released.', 409);
      }
      if (await count('rider_payouts', (q) => q.eq('status', 'pending'))) {
        return bad("Pay or reject this rider's pending withdrawal first.", 409);
      }
      if (!b.force) {
        const [errands, payouts] = await Promise.all([count('dispatch_errands', (q) => q), count('rider_payouts', (q) => q)]);
        if (errands || payouts) {
          return NextResponse.json({
            error: `This rider has ${errands} errand(s) and ${payouts} payout(s) on record. Deleting removes their payout history and ratings. The errands stay, but lose the rider link.`,
            needs_force: true,
          }, { status: 409 });
        }
      }

      await adminDb.from('dispatch_errands').update({ rider_id: null }).eq('rider_id', id); // keep errand history
      const { error } = await adminDb.from('riders').delete().eq('id', id);                  // offers, reviews, payouts cascade
      if (error) return bad(error.message, 500);

      let loginKept = false;
      if (r.user_id && b.delete_login) {
        if (await loginInUse(r.user_id)) loginKept = true;
        else loginKept = !!(await adminDb.auth.admin.deleteUser(r.user_id)).error;
      }
      return NextResponse.json({ ok: true, login_kept: loginKept });
    }

    case 'payout': {
      if (!['paid', 'rejected'].includes(b.status)) return bad('Invalid status.');
      const { data, error } = await adminDb.from('rider_payouts')
        .update({ status: b.status, processed_at: new Date().toISOString(), note: String(b.note || '').slice(0, 200) || null })
        .eq('id', id).eq('status', 'pending').select('id');
      if (error) return bad(error.message, 500);
      return data?.length ? NextResponse.json({ ok: true }) : bad('That payout was already processed.');
    }

    default:
      return bad('Unknown action.');
  }
}