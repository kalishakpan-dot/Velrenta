// app/api/admin/action/route.ts
// Every admin change goes through here. Admins only.

import { NextResponse } from 'next/server';
import { adminDb, requireAdmin, isAdminUser } from '../../../lib/adminServer';
import { handleSupplierAction } from '../../../lib/adminSuppliers';

export const dynamic = 'force-dynamic';

const ACCOUNT_STATUSES = ['unverified', 'verified', 'suspended'];
const SUPPLIER_LEVELS = ['basic', 'verified', 'trusted'];
const PO_STATUSES = ['pending', 'confirmed', 'declined', 'cancelled'];
const DISPUTE_STATUSES = ['open', 'in_review', 'resolved', 'dismissed'];
const RAISED_BY = ['buyer', 'supplier', 'admin'];

const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const ok = () => NextResponse.json({ ok: true });

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return fail('Not authorized', 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid request.');
  }

  // Supplier creation, supplier logins and password resets live in adminSuppliers.ts.
  const handled = await handleSupplierAction(body);
  if (handled) return handled;

  // Suspending blocks the person from signing in; reinstating lets them back in.
  const setBan = async (userId: string | null | undefined, banned: boolean): Promise<string | null> => {
    if (!userId) return null;
    if (banned) {
      if (userId === admin.id) return 'You cannot suspend your own account.';
      if (await isAdminUser(userId)) return 'You cannot suspend another admin.';
    }
    const { error } = await adminDb.auth.admin.updateUserById(userId, {
      ban_duration: banned ? '876000h' : 'none',
    });
    return error ? error.message : null;
  };

  try {
    switch (body.action) {
      case 'set_buyer_status': {
        const { id, status } = body;
        if (!id || !ACCOUNT_STATUSES.includes(status)) return fail('Invalid buyer or status.');
        const banErr = await setBan(id, status === 'suspended');
        if (banErr) return fail(banErr);
        const { error } = await adminDb.from('buyers').update({ verification_status: status }).eq('id', id);
        if (error) return fail(error.message);
        return ok();
      }

      case 'set_supplier_status': {
        const { id, status } = body;
        if (!id || !ACCOUNT_STATUSES.includes(status)) return fail('Invalid supplier or status.');
        const { data: sup, error: findErr } = await adminDb.from('suppliers').select('user_id').eq('id', id).maybeSingle();
        if (findErr || !sup) return fail('Supplier not found.');
        const banErr = await setBan(sup.user_id, status === 'suspended');
        if (banErr) return fail(banErr);
        const { error } = await adminDb.from('suppliers').update({ verification_status: status }).eq('id', id);
        if (error) return fail(error.message);
        return ok();
      }

      case 'set_supplier_level': {
        const { id, level } = body;
        if (!id || !SUPPLIER_LEVELS.includes(level)) return fail('Invalid supplier or level.');
        const { error } = await adminDb.from('suppliers').update({ verification_level: level }).eq('id', id);
        if (error) return fail(error.message);
        return ok();
      }

      case 'set_po_status': {
        const { id, status } = body;
        if (!id || !PO_STATUSES.includes(status)) return fail('Invalid order or status.');
        const { error } = await adminDb.from('purchase_orders').update({ status }).eq('id', id);
        if (error) return fail(error.message);
        return ok();
      }

      case 'create_dispute': {
        const subject = String(body.subject || '').trim();
        if (!subject) return fail('Add a short subject for the issue.');
        const raisedBy = RAISED_BY.includes(body.raised_by_role) ? body.raised_by_role : 'admin';

        let buyer_id: string | null = null;
        let supplier_id: string | null = null;
        const po_id: string | null = body.po_id || null;
        if (po_id) {
          const { data: po } = await adminDb.from('purchase_orders').select('buyer_id, supplier_id').eq('id', po_id).maybeSingle();
          buyer_id = po?.buyer_id ?? null;
          supplier_id = po?.supplier_id ?? null;
        }

        const { error } = await adminDb.from('disputes').insert({
          po_id,
          buyer_id,
          supplier_id,
          raised_by_role: raisedBy,
          subject,
          description: String(body.description || '').trim() || null,
        });
        if (error) return fail(error.message);
        return ok();
      }

      case 'update_dispute': {
        const { id, status } = body;
        if (!id || !DISPUTE_STATUSES.includes(status)) return fail('Invalid issue or status.');
        const closing = status === 'resolved' || status === 'dismissed';
        const update: Record<string, unknown> = {
          status,
          updated_at: new Date().toISOString(),
          resolved_at: closing ? new Date().toISOString() : null,
          resolved_by: closing ? admin.id : null,
        };
        if (typeof body.resolution === 'string') update.resolution = body.resolution.trim() || null;
        if (status === 'open') update.resolution = null;
        const { error } = await adminDb.from('disputes').update(update).eq('id', id);
        if (error) return fail(error.message);
        return ok();
      }

      default:
        return fail('Unknown action.');
    }
  } catch (err: any) {
    console.error('Admin action error:', err);
    return fail(err?.message || 'Something went wrong.', 500);
  }
}