// app/api/admin/supplier-products/route.ts
// Returns the product catalog plus one supplier's priced listings. Admins only.

import { NextResponse } from 'next/server';
import { adminDb, requireAdmin } from '../../../lib/adminServer';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const supplierId = new URL(req.url).searchParams.get('supplier_id');
  if (!supplierId) return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 });

  const [catalog, items] = await Promise.all([
    adminDb.from('products').select('*').limit(500),
    adminDb.from('supplier_products').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: false }),
  ]);

  if (catalog.error || items.error) {
    console.error('supplier-products load error:', catalog.error || items.error);
    return NextResponse.json({ error: (catalog.error || items.error)!.message }, { status: 500 });
  }
  return NextResponse.json({ catalog: catalog.data || [], items: items.data || [] });
}