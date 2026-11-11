// app/api/admin/buyers/route.ts
// Admin: enriched buyer list (roles, activity, last sign-in) + edit / status / password / delete.

import { NextResponse } from 'next/server';
import { adminDb, requireAdmin } from '../../../lib/adminServer';

export const dynamic = 'force-dynamic';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const clean = (v: unknown, max = 120) => String(v ?? '').trim().slice(0, max) || null;
const phoneNorm = (raw: unknown) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (/^0\d{10}$/.test(d)) return `234${d.slice(1)}`;
  if (/^234\d{10}$/.test(d)) return d;
  return null;
};

// The admins table layout is not fixed, so collect every text value and match the buyer's id or email against it.
async function adminKeys() {
  const { data } = await adminDb.from('admins').select('*');
  return new Set(
    (data ?? []).flatMap((r: any) => Object.values(r)).filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase())
  );
}

export async function GET(req: Request) {
  if (!(await requireAdmin(req))) return bad('Not authorized', 401);

  const [buyers, riders, suppliers, pos, rfqs, errands, users, admins] = await Promise.all([
    adminDb.from('buyers').select('*').order('created_at', { ascending: false }),
    adminDb.from('riders').select('user_id'),
    adminDb.from('suppliers').select('user_id'),
    adminDb.from('purchase_orders').select('buyer_id, total_amount').limit(5000),
    adminDb.from('rfqs').select('buyer_id').limit(5000),
    adminDb.from('dispatch_errands').select('buyer_id').limit(5000),
    adminDb.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    adminKeys(),
  ]);
  if (buyers.error) return bad(buyers.error.message, 500);

  const ids = (r: any) => new Set<string>((r.data ?? []).map((x: any) => x.user_id).filter(Boolean));
  const riderIds = ids(riders), supplierIds = ids(suppliers);
  const count = (r: any) => { const m = new Map<string, number>(); (r.data ?? []).forEach((x: any) => m.set(x.buyer_id, (m.get(x.buyer_id) || 0) + 1)); return m; };
  const poCount = count(pos), rfqCount = count(rfqs), errandCount = count(errands);
  const poValue = new Map<string, number>();
  (pos.data ?? []).forEach((x: any) => poValue.set(x.buyer_id, (poValue.get(x.buyer_id) || 0) + Number(x.total_amount || 0)));
  const auth = new Map<string, any>((users.data?.users ?? []).map((u: any) => [u.id, u]));

  const rows = (buyers.data ?? []).map((b: any) => {
    const roles: string[] = [];
    if (riderIds.has(b.id)) roles.push('rider');
    if (supplierIds.has(b.id)) roles.push('supplier');
    if (admins.has(b.id) || (b.email && admins.has(String(b.email).toLowerCase()))) roles.push('admin');
    const u = auth.get(b.id);
    return {
      ...b, roles,
      orders: poCount.get(b.id) || 0, order_value: poValue.get(b.id) || 0,
      rfqs: rfqCount.get(b.id) || 0, errands: errandCount.get(b.id) || 0,
      last_sign_in: u?.last_sign_in_at || null,
      banned: !!u?.banned_until && new Date(u.banned_until) > new Date(),
    };
  });
  return NextResponse.json({ buyers: rows });
}

export async function POST(req: Request) {
  if (!(await requireAdmin(req))) return bad('Not authorized', 401);
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || '');
  const { data: row } = await adminDb.from('buyers').select('id, email').eq('id', id).maybeSingle();
  if (!row) return bad('Buyer not found.', 404);

  const roles = async () => {
    const [r, s, a] = await Promise.all([
      adminDb.from('riders').select('id').eq('user_id', id).limit(1),
      adminDb.from('suppliers').select('id').eq('user_id', id).limit(1),
      adminKeys(),
    ]);
    return { rider: !!r.data?.length, supplier: !!s.data?.length, admin: a.has(id) || (!!row.email && a.has(String(row.email).toLowerCase())) };
  };
  const ok = () => NextResponse.json({ ok: true });

  switch (b.action) {
    case 'set_status': {
      if (!['verified', 'unverified', 'suspended'].includes(b.status)) return bad('Invalid status.');
      const { error } = await adminDb.from('buyers').update({ verification_status: b.status, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) return bad(error.message, 500);
      // Only block the login for plain buyers: a rider/supplier/admin login must keep working for its other role.
      const r = await roles();
      if (!r.rider && !r.supplier && !r.admin) await adminDb.auth.admin.updateUserById(id, { ban_duration: b.status === 'suspended' ? '876000h' : 'none' });
      return ok();
    }

    case 'update': {
      const phone = b.phone ? phoneNorm(b.phone) : null;
      if (b.phone && !phone) return bad('Enter a valid Nigerian phone number.');
      const email = String(b.email || '').trim().toLowerCase();
      if (email && !/^\S+@\S+\.\S+$/.test(email)) return bad('Enter a valid email.');
      if (email && email !== String(row.email || '').toLowerCase()) {
        const { error: ae } = await adminDb.auth.admin.updateUserById(id, { email, email_confirm: true });
        if (ae) return bad(ae.message);
      }
      const { error } = await adminDb.from('buyers').update({
        contact_name: clean(b.contact_name), company_name: clean(b.company_name), phone,
        city: clean(b.city, 60), country: clean(b.country, 60), ...(email ? { email } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      return error ? bad(error.message, 500) : ok();
    }

    case 'set_password': {
      const password = String(b.password || '');
      if (password.length < 8) return bad('Password must be at least 8 characters.');
      const { error } = await adminDb.auth.admin.updateUserById(id, { password });
      return error ? bad(error.message) : ok();
    }

    case 'delete': {
      const r = await roles();
      if (r.admin) return bad('Admin accounts cannot be deleted here.');
      const { error } = await adminDb.from('buyers').delete().eq('id', id);
      if (error) {
        return error.code === '23503'
          ? bad('This buyer has orders, requests or errands on record. Suspend them instead.', 409)
          : bad(error.message, 500);
      }
      // The login is only deleted for plain buyers; a rider/supplier keeps theirs.
      if (b.delete_login && !r.rider && !r.supplier) await adminDb.auth.admin.deleteUser(id);
      return ok();
    }

    default:
      return bad('Unknown action.');
  }
}