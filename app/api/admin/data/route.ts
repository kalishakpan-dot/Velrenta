// app/api/admin/data/route.ts
// Returns everything the admin dashboard needs. Admins only.

import { NextResponse } from 'next/server';
import { adminDb, requireAdmin } from '../../../lib/adminServer';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  // Lightweight check used by the login page (?me=1)
  if (new URL(req.url).searchParams.get('me')) {
    return NextResponse.json({ ok: true, email: admin.email });
  }

  const [buyers, suppliers, pos, disputes] = await Promise.all([
    adminDb.from('buyers').select('*').order('created_at', { ascending: false }),
    adminDb.from('suppliers').select('*').order('created_at', { ascending: false }),
    adminDb.from('purchase_orders').select('*').order('created_at', { ascending: false }),
    adminDb.from('disputes').select('*').order('created_at', { ascending: false }),
  ]);

  if (buyers.error) console.error('Admin buyers error:', buyers.error);
  if (suppliers.error) console.error('Admin suppliers error:', suppliers.error);
  if (pos.error) console.error('Admin purchase_orders error:', pos.error);
  if (disputes.error) console.error('Admin disputes error (run admin-setup.sql?):', disputes.error);

  return NextResponse.json({
    buyers: buyers.data ?? [],
    suppliers: suppliers.data ?? [],
    pos: pos.data ?? [],
    disputes: disputes.data ?? [],
    disputesReady: !disputes.error,
  });
}