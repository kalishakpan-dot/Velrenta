'use client';

// app/components/SupplierProductsModal.tsx
// Admin: choose which catalog products a supplier sells, and set their price, stock and lead time.
// These rows (supplier_products) are what the quoting assistant uses to find and price suppliers.

import { useCallback, useEffect, useState } from 'react';
import { X, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import type { SupplierLite } from './SupplierAccessModal';

type Act = (action: string, payload: Record<string, unknown>, success: string, key: string) => Promise<boolean>;

interface Props {
  supplier: SupplierLite;
  act: Act;
  busy: string | null;
  onClose: () => void;
}

interface CatalogProduct {
  id: string;
  [key: string]: any;
}

interface Listing {
  id: string;
  product_id: string;
  price: number | string;
  currency: string | null;
  minimum_order_quantity: number | string | null;
  available_quantity: number | string | null;
  lead_time_days: number | null;
  availability_status: string | null;
}

const STATUSES = ['available', 'limited', 'unavailable'];

const STATUS_BADGE: Record<string, string> = {
  available: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  limited: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  unavailable: 'bg-slate-800 text-slate-400 border-slate-700',
};

const productLabel = (p?: CatalogProduct) =>
  !p ? 'Unknown product' : p.name || p.product_name || p.title || p.description || `Product ${String(p.id).slice(0, 8)}`;

const inputCls =
  'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';

const emptyForm = { id: '', product_id: '', price: '', minimum_order_quantity: '1', available_quantity: '', lead_time_days: '', availability_status: 'available' };

export default function SupplierProductsModal({ supplier, act, busy, onClose }: Props) {
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [f, setF] = useState(emptyForm);
  const [error, setError] = useState('');

  const key = `sp-${supplier.id}`;
  const saving = busy === key;
  const editing = !!f.id;
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

  const load = useCallback(async () => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token || '';
      const res = await fetch(`/api/admin/supplier-products?supplier_id=${encodeURIComponent(supplier.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCatalog(json.catalog || []);
      setItems(json.items || []);
      setLoadErr('');
    } catch (err) {
      console.error('Supplier products load error:', err);
      setLoadErr('Could not load products. Close this and try again.');
    } finally {
      setLoading(false);
    }
  }, [supplier.id]);

  useEffect(() => {
    load();
  }, [load]);

  const byId = new Map(catalog.map((p) => [p.id, p]));
  const listed = new Set(items.map((i) => i.product_id));
  const available = catalog.filter((p) => !listed.has(p.id));

  const save = async () => {
    setError('');
    if (!f.product_id) return setError('Choose a product.');
    const price = Number(f.price);
    if (!Number.isFinite(price) || price <= 0) return setError('Enter a price greater than 0.');
    if (f.available_quantity === '' || Number(f.available_quantity) < 0) return setError('Enter the available quantity.');
    if (f.lead_time_days === '' || !Number.isInteger(Number(f.lead_time_days)) || Number(f.lead_time_days) < 0) {
      return setError('Enter the lead time as a whole number of days.');
    }
    const ok = await act(
      'save_supplier_product',
      { ...f, id: f.id || undefined, supplier_id: supplier.id },
      editing ? 'Product updated' : 'Product added',
      key
    );
    if (ok) {
      setF(emptyForm);
      await load();
    }
  };

  const remove = async (item: Listing) => {
    if (!window.confirm(`Remove ${productLabel(byId.get(item.product_id))} from ${supplier.company_name}?`)) return;
    const ok = await act('delete_supplier_product', { id: item.id }, 'Product removed', `sp-del-${item.id}`);
    if (ok) {
      if (f.id === item.id) setF(emptyForm);
      await load();
    }
  };

  const startEdit = (item: Listing) => {
    setError('');
    setF({
      id: item.id,
      product_id: item.product_id,
      price: String(item.price ?? ''),
      minimum_order_quantity: String(item.minimum_order_quantity ?? '1'),
      available_quantity: String(item.available_quantity ?? ''),
      lead_time_days: String(item.lead_time_days ?? ''),
      availability_status: item.availability_status || 'available',
    });
  };

  const money = (n: number | string, cur: string | null) => `${cur || 'NGN'} ${Number(n).toLocaleString('en-NG')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate">Products &amp; prices</h2>
            <p className="text-xs text-slate-400 mt-1 truncate">
              {supplier.company_name}. Buyers only get quotes from this supplier for the products listed here.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-200 p-1 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current listings */}
        <div className="mt-4 space-y-2">
          {loading ? (
            <div className="h-14 rounded-lg bg-slate-800 animate-pulse" />
          ) : loadErr ? (
            <p className="text-xs text-red-400">{loadErr}</p>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-800 p-5 text-center">
              <p className="text-sm text-slate-300">No products listed yet</p>
              <p className="text-xs text-slate-500 mt-1">Add one below so this supplier can receive quote requests.</p>
            </div>
          ) : (
            items.map((it) => {
              const st = it.availability_status || 'available';
              return (
                <div key={it.id} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-white truncate">{productLabel(byId.get(it.product_id))}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${STATUS_BADGE[st] || STATUS_BADGE.available}`}>
                          {st}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        <span className="text-emerald-400 font-semibold">{money(it.price, it.currency)}</span> · MOQ{' '}
                        {Number(it.minimum_order_quantity ?? 0).toLocaleString('en-NG')} · {Number(it.available_quantity ?? 0).toLocaleString('en-NG')} in stock ·{' '}
                        {it.lead_time_days ?? '—'} day lead time
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => startEdit(it)}
                        aria-label="Edit listing"
                        className="p-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(it)}
                        disabled={busy === `sp-del-${it.id}`}
                        aria-label="Remove listing"
                        className="p-1.5 rounded-lg border border-slate-700 hover:border-red-500/40 text-slate-400 hover:text-red-400 transition disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Add / edit form */}
        {!loading && !loadErr && (
          <div className="mt-5 pt-4 border-t border-slate-800">
            <h3 className="text-sm font-semibold text-white">{editing ? 'Edit listing' : 'Add a product'}</h3>

            {!editing && available.length === 0 ? (
              <p className="text-xs text-slate-500 mt-2">
                {catalog.length === 0
                  ? 'The product catalog is empty, so there is nothing to list yet.'
                  : 'This supplier already lists every product in the catalog.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                  <div className="sm:col-span-2">
                    <label htmlFor="sp-product" className="block text-xs text-slate-300 mb-1.5">Product</label>
                    <select
                      id="sp-product"
                      value={f.product_id}
                      disabled={editing}
                      onChange={(e) => set({ product_id: e.target.value })}
                      className={`${inputCls} ${editing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <option value="">Choose a product</option>
                      {(editing ? catalog.filter((p) => p.id === f.product_id) : available).map((p) => (
                        <option key={p.id} value={p.id}>{productLabel(p)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sp-price" className="block text-xs text-slate-300 mb-1.5">Price per unit (NGN)</label>
                    <input id="sp-price" inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value.replace(/[^\d.]/g, '') })} placeholder="e.g. 12000" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="sp-moq" className="block text-xs text-slate-300 mb-1.5">Minimum order quantity</label>
                    <input id="sp-moq" inputMode="numeric" value={f.minimum_order_quantity} onChange={(e) => set({ minimum_order_quantity: e.target.value.replace(/[^\d.]/g, '') })} placeholder="e.g. 50" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="sp-qty" className="block text-xs text-slate-300 mb-1.5">Available quantity</label>
                    <input id="sp-qty" inputMode="numeric" value={f.available_quantity} onChange={(e) => set({ available_quantity: e.target.value.replace(/[^\d.]/g, '') })} placeholder="e.g. 2000" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="sp-lead" className="block text-xs text-slate-300 mb-1.5">Lead time (days)</label>
                    <input id="sp-lead" inputMode="numeric" value={f.lead_time_days} onChange={(e) => set({ lead_time_days: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 3" className={inputCls} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="sp-status" className="block text-xs text-slate-300 mb-1.5">Availability</label>
                    <select id="sp-status" value={f.availability_status} onChange={(e) => set({ availability_status: e.target.value })} className={`${inputCls} capitalize`}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

                <div className="flex justify-end gap-2 mt-4">
                  {editing && (
                    <button onClick={() => { setF(emptyForm); setError(''); }} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition">
                      Cancel edit
                    </button>
                  )}
                  <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 transition">
                    {saving ? 'Saving...' : editing ? 'Save changes' : 'Add product'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end mt-5 pt-4 border-t border-slate-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}