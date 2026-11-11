'use client';

// app/components/SupplierProductEditor.tsx
// Modal used on the supplier dashboard (Products tab) to:
//  - add a product listing, either picked from the shared catalog or as a brand-new product
//  - edit an existing listing: price, order quantities, stock, lead time, availability, specifications

import { useEffect, useMemo, useState } from 'react';
import { Search, X, Plus, Trash2, Check } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export interface EditorProduct {
  id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  unit: string | null;
  specifications: Record<string, unknown> | null;
}

export interface EditorTarget {
  listingId: string;
  product: EditorProduct;
  price: number | string | null;
  moq: number | string | null;
  qty: number | string | null;
  lead: number | null;
  status: string | null;
  specs: Record<string, unknown> | null;
}

interface Props {
  supplierId: string;
  mode: 'add' | 'edit';
  target?: EditorTarget;
  listedProductIds: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

const CATEGORY = 'Construction Materials';

const UNITS = ['piece', 'bag', 'length', 'roll', 'metre', 'tonne', 'carton', 'kg', 'litre', 'set', 'bundle', 'trip', 'sheet', 'pair'];

const SUBCATEGORIES = [
  'Pipes',
  'Pipe Fittings',
  'Cement',
  'Reinforcement Steel',
  'Blocks & Aggregates',
  'Roofing',
  'Electrical Cables',
  'Plumbing',
  'Tiles & Flooring',
  'Paint & Finishes',
  'Doors & Windows',
  'Timber & Boards',
  'Tools & Hardware',
  'Sanitary Ware',
];

const SPEC_KEYS = [
  'brand',
  'material',
  'size',
  'nominal size inch',
  'length m',
  'diameter mm',
  'thickness mm',
  'grade',
  'class',
  'standard',
  'pressure rating',
  'color',
  'finish',
  'weight kg',
  'origin',
];

const STATUSES = [
  { value: 'available', label: 'Available' },
  { value: 'limited', label: 'Limited stock' },
  { value: 'out_of_stock', label: 'Out of stock' },
];

const MAX_SPECS = 15;

const inputCls =
  'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 disabled:opacity-60';

interface SpecRow {
  k: string;
  v: string;
}

const uuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

const toNum = (v: string): number => {
  const t = v.replace(/,/g, '').trim();
  return t === '' ? NaN : Number(t);
};

const specKey = (k: string) =>
  k
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const specsToRows = (specs: Record<string, unknown> | null | undefined): SpecRow[] =>
  Object.entries(specs || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
    .map(([k, v]) => ({ k: k.replace(/_/g, ' '), v: String(v) }));

const rowsToSpecs = (rows: SpecRow[]): Record<string, string | number> => {
  const out: Record<string, string | number> = {};
  for (const r of rows) {
    const k = specKey(r.k);
    const v = r.v.trim();
    if (!k || !v) continue;
    out[k] = String(Number(v)) === v ? Number(v) : v;
  }
  return out;
};

const readOnlySpecs = (specs: Record<string, unknown> | null | undefined): [string, string][] =>
  Object.entries(specs || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
    .map(([k, v]) => [k.replace(/_/g, ' '), String(v)] as [string, string]);

export default function SupplierProductEditor({ supplierId, mode, target, listedProductIds, onClose, onSaved }: Props) {
  const isEdit = mode === 'edit' && !!target;

  const [source, setSource] = useState<'catalog' | 'new'>('catalog');
  const [catalog, setCatalog] = useState<EditorProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(!isEdit);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<EditorProduct | null>(null);
  const [np, setNp] = useState({ name: '', subcategory: '', unit: 'piece', description: '' });

  const [price, setPrice] = useState(target?.price != null && target.price !== '' ? String(Number(target.price)) : '');
  const [moq, setMoq] = useState(target?.moq != null && target.moq !== '' ? String(Number(target.moq)) : '1');
  const [qty, setQty] = useState(target?.qty != null && target.qty !== '' ? String(Number(target.qty)) : '');
  const [lead, setLead] = useState(target?.lead != null ? String(target.lead) : '3');
  const [status, setStatus] = useState((target?.status || 'available').toLowerCase());
  const [specRows, setSpecRows] = useState<SpecRow[]>(specsToRows(target?.specs));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load the shared product catalog (add mode only).
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('products')
        .select('id, name, category, subcategory, description, unit, specifications')
        .order('name', { ascending: true })
        .limit(2000);
      if (cancelled) return;
      if (err) {
        console.error('Product catalog fetch error:', err);
        setError('Could not load the product catalog. You can still add a new product.');
        setSource('new');
      } else if (data) {
        setCatalog(data as EditorProduct[]);
      }
      setCatalogLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit]);

  // Esc closes the dialog.
  useEffect(() => {
    const onKey = (e: { key: string }) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const available = useMemo(() => {
    const listed = new Set(listedProductIds);
    const q = search.trim().toLowerCase();
    return catalog
      .filter((p) => !listed.has(p.id))
      .filter((p) => !q || `${p.name} ${p.subcategory || ''} ${p.description || ''}`.toLowerCase().includes(q))
      .slice(0, 100);
  }, [catalog, listedProductIds, search]);

  const subcategoryOptions = useMemo(
    () => Array.from(new Set([...SUBCATEGORIES, ...catalog.map((p) => p.subcategory || '').filter(Boolean)])).sort(),
    [catalog]
  );

  const activeProduct: EditorProduct | null = isEdit ? target!.product : source === 'catalog' ? picked : null;
  const unitLabel = isEdit ? target!.product.unit || 'unit' : source === 'catalog' ? picked?.unit || 'unit' : np.unit.trim() || 'unit';
  const inheritedSpecs = readOnlySpecs(activeProduct?.specifications);

  const updateSpec = (i: number, patch: Partial<SpecRow>) =>
    setSpecRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (saving) return;
    setError('');

    let name = '';
    if (!isEdit) {
      if (source === 'catalog') {
        if (!picked) return setError('Choose a product from the catalog, or switch to "New product".');
      } else {
        name = np.name.trim().replace(/\s+/g, ' ');
        if (name.length < 3) return setError('Enter the product name, including its size or type.');
        if (!np.unit.trim()) return setError('Choose the unit the product is sold in.');
        if (catalog.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) {
          return setError('That product already exists in the catalog. Switch to "From catalog" and pick it instead.');
        }
      }
    }

    const priceN = toNum(price);
    const moqN = toNum(moq);
    const qtyN = toNum(qty);
    const leadN = toNum(lead);

    if (!Number.isFinite(priceN) || priceN <= 0) return setError('Enter your price per unit in naira.');
    if (priceN > 1_000_000_000) return setError('That price looks too high. Please check it.');
    if (!Number.isFinite(moqN) || moqN <= 0) return setError('Enter the minimum quantity a buyer can order.');
    if (!Number.isFinite(qtyN) || qtyN < 0) return setError('Enter how many units you have in stock (0 if none).');
    if (!Number.isInteger(leadN) || leadN < 0 || leadN > 365) return setError('Lead time must be a whole number of days, from 0 to 365.');
    if (!STATUSES.some((s) => s.value === status)) return setError('Choose an availability status.');
    if (specRows.some((r) => (r.k.trim() && !r.v.trim()) || (!r.k.trim() && r.v.trim()))) {
      return setError('Each specification needs both a name and a value. Fill in or remove the incomplete rows.');
    }

    const specs = rowsToSpecs(specRows);
    const now = new Date().toISOString();

    setSaving(true);
    try {
      if (isEdit) {
        const { data, error: err } = await supabase
          .from('supplier_products')
          .update({
            price: priceN,
            minimum_order_quantity: moqN,
            available_quantity: qtyN,
            lead_time_days: leadN,
            availability_status: status,
            specifications: specs,
            updated_at: now,
          })
          .eq('id', target!.listingId)
          .eq('supplier_id', supplierId)
          .select('id');
        if (err || !data || data.length === 0) {
          console.error('Listing update error:', err);
          setError('Could not save your changes. Please try again.');
          return;
        }
        onSaved(`${target!.product.name} updated`);
        return;
      }

      let productId = picked?.id || '';
      let label = picked?.name || name;

      if (source === 'new') {
        productId = uuid();
        const { error: perr } = await supabase.from('products').insert({
          id: productId,
          name,
          category: CATEGORY,
          subcategory: np.subcategory.trim() || null,
          description: np.description.trim() || null,
          unit: np.unit.trim().toLowerCase(),
          specifications: specs,
          created_at: now,
          updated_at: now,
        });
        if (perr) {
          console.error('Product create error:', perr);
          setError('Could not create the product. Please try again, or contact the Velrenta team if it keeps failing.');
          return;
        }
        label = name;
      }

      const { error: lerr } = await supabase.from('supplier_products').insert({
        id: uuid(),
        supplier_id: supplierId,
        product_id: productId,
        price: priceN,
        currency: 'NGN',
        minimum_order_quantity: moqN,
        available_quantity: qtyN,
        lead_time_days: leadN,
        // A brand-new product keeps its specs on the product itself; catalog picks keep their own on the listing.
        specifications: source === 'new' ? {} : specs,
        availability_status: status,
        created_at: now,
        updated_at: now,
      });
      if (lerr) {
        console.error('Listing create error:', lerr);
        setError(
          lerr.code === '23505'
            ? 'You already list this product. Edit the existing listing instead.'
            : 'Could not add the product to your list. Please try again.'
        );
        return;
      }
      onSaved(`${label} added to your products`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit product' : 'Add product'}
        className="w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-800 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate">{isEdit ? target!.product.name : 'Add a product'}</h2>
            <p className="text-xs text-slate-400 mt-1">
              {isEdit
                ? 'Update your price, stock and details. Buyers see these when they request quotes.'
                : 'List something you supply, with your price per unit.'}
            </p>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Close" className="text-slate-500 hover:text-slate-200 p-1 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">
          {error && (
            <div role="alert" className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3.5 py-2.5">
              {error}
            </div>
          )}

          {/* Product */}
          {!isEdit && (
            <section>
              <div className="inline-flex p-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold">
                {(
                  [
                    { key: 'catalog', label: 'From catalog' },
                    { key: 'new', label: 'New product' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSource(t.key)}
                    className={`px-3.5 py-1.5 rounded-md transition ${source === t.key ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {source === 'catalog' ? (
                <div className="mt-4">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search the Velrenta catalog"
                      aria-label="Search the catalog"
                      className={`${inputCls} pl-9`}
                    />
                  </div>
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/70">
                    {catalogLoading ? (
                      <p className="text-xs text-slate-500 p-4">Loading the catalog...</p>
                    ) : available.length === 0 ? (
                      <p className="text-xs text-slate-500 p-4">
                        {catalog.length > 0 && !search.trim()
                          ? 'You already list every product in the catalog. Use "New product" to add something else.'
                          : 'No matching products. Switch to "New product" to add it.'}
                      </p>
                    ) : (
                      available.map((p) => {
                        const on = picked?.id === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPicked(p)}
                            className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left transition ${on ? 'bg-emerald-500/10' : 'hover:bg-slate-800/50'}`}
                          >
                            <span className="min-w-0">
                              <span className="block text-sm text-white truncate">{p.name}</span>
                              <span className="block text-[11px] text-slate-500 truncate">
                                {p.subcategory || p.category || 'Other'} · per {p.unit || 'unit'}
                              </span>
                            </span>
                            {on && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="np-name" className="block text-xs text-slate-300 mb-1.5">Product name</label>
                    <input
                      id="np-name"
                      value={np.name}
                      onChange={(e) => setNp({ ...np, name: e.target.value })}
                      maxLength={120}
                      placeholder="e.g. PVC Drainage Pipe 4 inch (6m)"
                      className={inputCls}
                    />
                    <p className="text-[11px] text-slate-500 mt-1.5">Include the size or type so buyers can compare quotes.</p>
                  </div>
                  <div>
                    <label htmlFor="np-sub" className="block text-xs text-slate-300 mb-1.5">Type of product</label>
                    <input
                      id="np-sub"
                      list="np-sub-list"
                      value={np.subcategory}
                      onChange={(e) => setNp({ ...np, subcategory: e.target.value })}
                      maxLength={60}
                      placeholder="e.g. Pipes"
                      className={inputCls}
                    />
                    <datalist id="np-sub-list">
                      {subcategoryOptions.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label htmlFor="np-unit" className="block text-xs text-slate-300 mb-1.5">Sold per</label>
                    <input
                      id="np-unit"
                      list="np-unit-list"
                      value={np.unit}
                      onChange={(e) => setNp({ ...np, unit: e.target.value })}
                      maxLength={20}
                      placeholder="e.g. piece, bag, tonne"
                      className={inputCls}
                    />
                    <datalist id="np-unit-list">
                      {UNITS.map((u) => (
                        <option key={u} value={u} />
                      ))}
                    </datalist>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="np-desc" className="block text-xs text-slate-300 mb-1.5">Description (optional)</label>
                    <textarea
                      id="np-desc"
                      value={np.description}
                      onChange={(e) => setNp({ ...np, description: e.target.value })}
                      maxLength={200}
                      rows={2}
                      placeholder="What it is and what it is used for"
                      className={inputCls}
                    />
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Pricing and stock */}
          <section>
            <h3 className="text-sm font-semibold text-white">Price and stock</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              <div>
                <label htmlFor="ed-price" className="block text-xs text-slate-300 mb-1.5">Your price (₦ per {unitLabel})</label>
                <input
                  id="ed-price"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="e.g. 21000"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="ed-moq" className="block text-xs text-slate-300 mb-1.5">Minimum order ({unitLabel})</label>
                <input
                  id="ed-moq"
                  inputMode="decimal"
                  value={moq}
                  onChange={(e) => setMoq(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="e.g. 50"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="ed-qty" className="block text-xs text-slate-300 mb-1.5">In stock ({unitLabel})</label>
                <input
                  id="ed-qty"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="e.g. 2000"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="ed-lead" className="block text-xs text-slate-300 mb-1.5">Lead time (days to deliver)</label>
                <input
                  id="ed-lead"
                  inputMode="numeric"
                  value={lead}
                  onChange={(e) => setLead(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  placeholder="e.g. 3"
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="ed-status" className="block text-xs text-slate-300 mb-1.5">Availability</label>
                <select id="ed-status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Specifications */}
          <section>
            <h3 className="text-sm font-semibold text-white">Specifications</h3>
            <p className="text-xs text-slate-400 mt-1">
              {!isEdit && source === 'new'
                ? 'Details buyers see for this product, such as size, material, grade or standard.'
                : 'Add details specific to your product, such as brand, grade or standard. Buyers see these with your price.'}
            </p>

            {inheritedSpecs.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] text-slate-500 mb-1.5">Already on this product</p>
                <div className="flex flex-wrap gap-1.5">
                  {inheritedSpecs.map(([k, v]) => (
                    <span key={k} className="px-2.5 py-1 rounded-full text-[11px] border border-slate-700 text-slate-300">
                      <span className="text-slate-500 capitalize">{k}:</span> {v}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <datalist id="spec-key-list">
              {SPEC_KEYS.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>

            <div className="space-y-2 mt-3">
              {specRows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    list="spec-key-list"
                    value={r.k}
                    onChange={(e) => updateSpec(i, { k: e.target.value })}
                    maxLength={40}
                    placeholder="Name, e.g. brand"
                    aria-label="Specification name"
                    className={`${inputCls} w-2/5`}
                  />
                  <input
                    value={r.v}
                    onChange={(e) => updateSpec(i, { v: e.target.value })}
                    maxLength={100}
                    placeholder="Value, e.g. Dangote"
                    aria-label="Specification value"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => setSpecRows((rows) => rows.filter((_, idx) => idx !== i))}
                    aria-label="Remove specification"
                    className="text-slate-500 hover:text-red-400 p-2 shrink-0 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            {specRows.length < MAX_SPECS && (
              <button
                type="button"
                onClick={() => setSpecRows((rows) => [...rows, { k: '', v: '' }])}
                className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition"
              >
                <Plus className="w-3.5 h-3.5" /> Add a specification
              </button>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-slate-800 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 transition"
          >
            {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Add product'}
          </button>
        </div>
      </div>
    </div>
  );
}