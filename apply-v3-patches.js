// Run from your project root:  node apply-v3-patches.js
// Patches app/rider/page.tsx, app/dispatch/page.tsx and app/admin/page.tsx.
// Checks every change can be applied BEFORE writing anything, and saves a .bak copy of each file.
const fs = require('fs');

const sub = (find, replace) => ({ find, replace });
const between = (from, to, replace) => ({ from, to, replace });

const FILES = {
  'app/rider/page.tsx': {
    done: 'DeliveryFlow',
    edits: [
      sub("import RiderEarnings from '../components/RiderEarnings';", String.raw`import RiderEarnings from '../components/RiderEarnings';
import RiderWallet from '../components/RiderWallet';
import DeliveryFlow from '../components/DeliveryFlow';`),
      sub('buyer_name: string | null;', String.raw`buyer_name: string | null;
  actual_item_cost: number | null;
  receipt_note: string | null;`),
      between("const advance = async (j: Job, next: 'in_progress' | 'delivered') => {", 'const openCancel = (j: Job) => {', String.raw`const advance = async (j: Job, next: 'in_progress' | 'delivered', code?: string): Promise<boolean> => {
    setBusy(j.id);
    const { data, error } = await supabase.rpc('rider_update_job', { p_errand_id: j.id, p_status: next, p_code: code ?? null });
    setBusy(null);
    const problems: Record<string, string> = {
      bad_code: 'Wrong code. Ask the customer to check the code in their app.',
      locked: 'Too many wrong codes. Contact Velrenta support.',
      receipt_required: 'Save what you spent on the items first.',
      invalid: 'Could not update this errand. Refresh and try again.',
      missing: 'Could not update this errand. Refresh and try again.',
    };
    const problem = error ? 'Could not update this errand. Refresh and try again.' : problems[data as string];
    if (problem) {
      console.error('Update job error:', error, data);
      showToast(problem, false);
    } else {
      setConfirmId(null);
      showToast(next === 'delivered' ? 'Delivered. Well done!' : 'Errand started. The customer can see you are on the way.');
    }
    refresh();
    return !problem;
  };

  `),
      sub("{view === 'earnings' && <RiderEarnings refreshKey={rider.total_errands} />}", String.raw`{view === 'earnings' && (
          <>
            <RiderEarnings refreshKey={rider.total_errands} />
            <RiderWallet toast={showToast} refreshKey={rider.total_errands} />
          </>
        )}`),
      between(') : confirmId === j.id ? (', 'onClick={() => setConfirmId(j.id)}', String.raw`) : confirmId === j.id ? (
                    <DeliveryFlow
                      key={j.id}
                      budget={j.item_budget || 0}
                      savedCost={j.actual_item_cost}
                      savedNote={j.receipt_note}
                      busy={busy === j.id}
                      onSaveReceipt={async (cost, note) => {
                        const { data } = await supabase.rpc('rider_set_receipt', { p_errand_id: j.id, p_cost: cost, p_note: note });
                        if (data === 'saved') {
                          showToast('Receipt saved. The customer can see it.');
                          refresh();
                          return true;
                        }
                        showToast('Could not save the receipt. Try again.', false);
                        return false;
                      }}
                      onDeliver={(code) => advance(j, 'delivered', code)}
                    />
                  ) : (
                    <button
                      `),
      // Share live location while the rider has an active errand
      sub('const toggleOnline = async () => {', String.raw`// Share live location with the customer only while an errand is active.
  const hasJob = jobs.length > 0;
  useEffect(() => {
    if (!hasJob || !navigator.geolocation) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last < 10000) return;
        last = Date.now();
        supabase.rpc('rider_update_location', { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [hasJob]);

  const toggleOnline = async () => {`),
    ],
  },

  'app/dispatch/page.tsx': {
    done: 'ErrandExtras',
    edits: [
      sub('  released_rider_name: string | null;', String.raw`  released_rider_name: string | null;
  delivery_code: string | null;
  actual_item_cost: number | null;
  receipt_note: string | null;
  rider_stars: number | null;`),
      sub("rider_release_reason, released_rider_name')", "rider_release_reason, released_rider_name, delivery_code, actual_item_cost, receipt_note, rider_stars')"),
      // unique channel name per mount (fixes "cannot add postgres_changes callbacks after subscribe()")
      sub(".channel('dispatch-errands')", ".channel('dispatch-errands-' + Math.random().toString(36).slice(2))"),
      sub('const [now, setNow] = useState(Date.now());', String.raw`const [now, setNow] = useState(Date.now());
  const [locs, setLocs] = useState<Record<string, Loc>>({});`),
      sub("const { data: av } = await supabase.rpc('get_available_riders');", String.raw`const moving = errandsRef.current.filter((e) => e.status === 'accepted' || e.status === 'in_progress');
    const locRes = await Promise.all(
      moving.map(async (e) => [e.id, (await supabase.rpc('get_errand_location', { p_errand_id: e.id })).data] as const)
    );
    setLocs(Object.fromEntries(locRes.filter(([, d]) => d)) as Record<string, Loc>);
    const { data: av } = await supabase.rpc('get_available_riders');`),
      sub('const field =', String.raw`interface Loc { lat: number; lng: number; seconds_ago: number }

function RiderMap({ loc }: { loc: Loc }) {
  const d = 0.008;
  const bbox = [loc.lng - d, loc.lat - d, loc.lng + d, loc.lat + d].join(',');
  const src = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik&marker=' + loc.lat + '%2C' + loc.lng;
  return (
    <div className="mt-3">
      <iframe title="Rider location" src={src} loading="lazy" className="w-full h-40 rounded-lg border border-slate-800" />
      <p className="text-[11px] text-slate-500 mt-1.5">Live rider location · updated {loc.seconds_ago}s ago</p>
    </div>
  );
}

function RateRider({ e, onRated }: { e: Errand; onRated: () => void }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  if (e.rider_stars) return <p className="mt-3 text-xs text-slate-400">You rated this rider {e.rider_stars} out of 5.</p>;
  const send = async () => {
    if (!stars) return;
    setBusy(true);
    await supabase.rpc('rate_rider', { p_errand_id: e.id, p_stars: stars, p_comment: comment });
    setBusy(false);
    onRated();
  };
  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-xs font-medium text-slate-300">How was your rider?</p>
      <div className="flex gap-1 mt-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setStars(n)} aria-label={n + ' stars'} aria-pressed={stars === n}>
            <Star className={'w-7 h-7 ' + (n <= stars ? 'text-amber-400 fill-amber-400' : 'text-slate-600')} />
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={300} placeholder="Add a comment (optional)" className="w-full mt-2.5 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500" />
          <button onClick={send} disabled={busy} className="mt-2.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 rounded-lg px-4 py-2 transition">{busy ? 'Sending...' : 'Submit rating'}</button>
        </>
      )}
    </div>
  );
}

function ErrandExtras({ e, loc, onRated }: { e: Errand; loc?: Loc; onRated: () => void }) {
  const live = e.status === 'accepted' || e.status === 'in_progress';
  const diff = e.actual_item_cost != null ? (e.item_budget || 0) - e.actual_item_cost : 0;
  return (
    <>
      {live && e.delivery_code && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">Your delivery code. Tell the rider only when you have your order.</p>
          <span className="text-2xl font-bold tracking-[0.3em] text-emerald-400 tabular-nums">{e.delivery_code}</span>
        </div>
      )}
      {live && loc && <RiderMap loc={loc} />}
      {e.actual_item_cost != null && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
          <p>Rider spent <b className="text-white">{naira(e.actual_item_cost)}</b> on items (you gave {naira(e.item_budget)}).</p>
          {diff > 0 && <p className="text-emerald-400 mt-1">The rider should hand back {naira(diff)} change.</p>}
          {diff < 0 && <p className="text-amber-400 mt-1">That is {naira(-diff)} more than your budget.</p>}
          {e.receipt_note && <p className="text-slate-500 mt-1">Note: {e.receipt_note}</p>}
        </div>
      )}
      {e.status === 'delivered' && <RateRider e={e} onRated={onRated} />}
    </>
  );
}

const field =`),
      sub('onRetry={() => retry(e.id)} />', String.raw`onRetry={() => retry(e.id)} />
                  <ErrandExtras e={e} loc={locs[e.id]} onRated={() => buyerId && loadErrands(buyerId)} />`),
    ],
  },

  'app/admin/page.tsx': {
    done: 'AdminRiders',
    edits: [
      sub("type View = 'overview' | 'buyers' | 'suppliers' | 'orders' | 'issues';", "type View = 'overview' | 'buyers' | 'suppliers' | 'orders' | 'issues' | 'riders';"),
      sub("import SupplierProductsModal from '../components/SupplierProductsModal';", String.raw`import SupplierProductsModal from '../components/SupplierProductsModal';
import AdminRiders from '../components/AdminRiders';`),
      sub('  Plus,\n} from', '  Plus,\n  Bike,\n} from'),
      sub("{ key: 'orders', label: 'Orders', Icon: Package, badge: 0 },", String.raw`{ key: 'orders', label: 'Orders', Icon: Package, badge: 0 },
    { key: 'riders', label: 'Riders', Icon: Bike, badge: 0 },`),
      sub('<div className="max-w-6xl mx-auto p-4 md:p-8">', String.raw`<div className="max-w-6xl mx-auto p-4 md:p-8">
          {view === 'riders' && <AdminRiders getToken={getToken} toast={showToast} />}`),
    ],
  },
};

const pos = (s, t) => { const a = []; let i = -1; while ((i = s.indexOf(t, i + 1)) !== -1) a.push(i); return a; };
const out = {};
let failed = false;

for (const [file, { done, edits }] of Object.entries(FILES)) {
  if (!fs.existsSync(file)) { console.log('MISSING  ' + file + ' (run this from the project root)'); failed = true; continue; }
  const raw = fs.readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  let src = raw.replace(/\r\n/g, '\n');
  if (src.includes(done)) { console.log('SKIP     ' + file + ' (already patched)'); continue; }
  edits.forEach((e, n) => {
    if (e.find !== undefined) {
      const p = pos(src, e.find);
      if (p.length !== 1) { console.log('FAILED   ' + file + ' edit #' + (n + 1) + ': found ' + p.length + ' matches for: ' + e.find.split('\n')[0]); failed = true; return; }
      src = src.slice(0, p[0]) + e.replace + src.slice(p[0] + e.find.length);
    } else {
      const a = pos(src, e.from);
      const j = a.length === 1 ? src.indexOf(e.to, a[0]) : -1;
      if (a.length !== 1 || j < 0) { console.log('FAILED   ' + file + ' edit #' + (n + 1) + ': markers not found: ' + e.from); failed = true; return; }
      src = src.slice(0, a[0]) + e.replace + src.slice(j);
    }
  });
  out[file] = crlf ? src.replace(/\n/g, '\r\n') : src;
}

if (failed) { console.log('\nNothing was changed. Send me the FAILED lines.'); process.exit(1); }
for (const [file, text] of Object.entries(out)) {
  if (!fs.existsSync(file + '.bak')) fs.copyFileSync(file, file + '.bak');
  fs.writeFileSync(file, text);
  console.log('PATCHED  ' + file);
}
console.log('\nDone. Backups saved as *.bak');