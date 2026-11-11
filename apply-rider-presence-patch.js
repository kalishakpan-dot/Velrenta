// Run from your project root:  node apply-rider-presence-patch.js
// Adds the heartbeat, the "customers can see you" status line, and an offline notice to app/rider/page.tsx.
const fs = require('fs');
const file = 'app/rider/page.tsx';
const sub = (find, replace) => ({ find, replace });

const edits = [
  sub('const [soundOn, setSoundOn] = useState(true);', String.raw`const [soundOn, setSoundOn] = useState(true);
  const [presence, setPresence] = useState<{ ok: boolean; visible?: boolean; busy?: boolean } | null>(null);
  const wantOnline = useRef(false); // the rider chose to be online
  const wasOnline = useRef(false);  // last state the server told us`),

  // tell the rider if the server set them offline (lost connection)
  sub('if (me.data) setRider(me.data as Rider);', String.raw`if (me.data) {
      const m = me.data as Rider;
      if (wantOnline.current && wasOnline.current && !m.is_online) {
        wantOnline.current = false;
        showToast('You were set offline because the app lost connection. Tap Go online to start again.', false);
      }
      wasOnline.current = m.is_online;
      setRider(m);
    }`),
  sub('}, [alertNew]);', '}, [alertNew, showToast]);'),

  sub('const next = !rider.is_online;', String.raw`const next = !rider.is_online;
    wantOnline.current = next;`),

  // heartbeat: tells the server we are still here, and whether customers can see us
  sub('const toggleOnline = async () => {', String.raw`// Check in every 20s while online. Riders who stop checking in are taken off the customer's list.
  const online = !!rider?.is_online;
  useEffect(() => {
    if (!ready || !online) {
      setPresence(null);
      return;
    }
    let alive = true;
    const beat = async () => {
      const { data, error } = await supabase.rpc('rider_heartbeat');
      if (alive) setPresence(error || !data ? { ok: false } : { ok: true, visible: !!(data as any).visible, busy: !!(data as any).busy });
    };
    beat();
    const t = setInterval(beat, 20000);
    const onVisible = () => {
      if (!document.hidden) beat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, online]);

  const toggleOnline = async () => {`),

  sub("{notifPerm === 'default' && (", String.raw`{on && presence && (
              <div
                className={
                  'rounded-xl border px-4 py-2.5 text-xs flex items-center gap-2 ' +
                  (!presence.ok
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : presence.visible
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-700 bg-slate-900 text-slate-300')
                }
              >
                <span className={'h-2 w-2 rounded-full shrink-0 ' + (!presence.ok ? 'bg-amber-400' : presence.visible ? 'bg-emerald-400' : 'bg-slate-500')} />
                {!presence.ok
                  ? 'Connection problem. Customers may not see you until it is back.'
                  : presence.visible
                    ? 'Customers can see you and can send you requests.'
                    : presence.busy
                      ? 'You are on an errand, so new requests are paused.'
                      : 'You are online but hidden from customers. Contact Velrenta.'}
              </div>
            )}

            {notifPerm === 'default' && (`),
];

const pos = (s, t) => { const a = []; let i = -1; while ((i = s.indexOf(t, i + 1)) !== -1) a.push(i); return a; };
if (!fs.existsSync(file)) { console.log('MISSING  ' + file + ' (run this from the project root)'); process.exit(1); }
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let src = raw.replace(/\r\n/g, '\n');
if (src.includes('rider_heartbeat')) { console.log('SKIP     ' + file + ' (already patched)'); process.exit(0); }

let failed = false;
edits.forEach((e, n) => {
  const p = pos(src, e.find);
  if (p.length !== 1) { console.log('FAILED   edit #' + (n + 1) + ': found ' + p.length + ' matches for: ' + e.find.split('\n')[0]); failed = true; return; }
  src = src.slice(0, p[0]) + e.replace + src.slice(p[0] + e.find.length);
});
if (failed) { console.log('\nNothing was changed. Send me the FAILED lines.'); process.exit(1); }
if (!fs.existsSync(file + '.presence.bak')) fs.copyFileSync(file, file + '.presence.bak');
fs.writeFileSync(file, crlf ? src.replace(/\n/g, '\r\n') : src);
console.log('PATCHED  ' + file + '\nDone. Backup saved as page.tsx.presence.bak');