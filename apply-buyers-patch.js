// Run from your project root:  node apply-buyers-patch.js
// 1) admin page: swaps the old Buyers view for the new AdminBuyers component
// 2) buyer dashboard (app/page.tsx): riders are sent to /rider instead of getting a buyer profile
const fs = require('fs');
const sub = (find, replace) => ({ find, replace });
const between = (from, to, replace) => ({ from, to, replace });

const FILES = {
  'app/admin/page.tsx': {
    done: 'AdminBuyers',
    edits: [
      sub("import AdminRiders from '../components/AdminRiders';", String.raw`import AdminRiders from '../components/AdminRiders';
import AdminBuyers from '../components/AdminBuyers';`),
      between("{view === 'buyers' && (", "{view === 'suppliers' && (", String.raw`{view === 'buyers' && <AdminBuyers getToken={getToken} toast={showToast} />}

          {/* Suppliers */}
          `),
    ],
  },
  'app/page.tsx': {
    done: 'rider_me',
    edits: [
      sub('// Suppliers belong on their own dashboard.', String.raw`// Riders belong on the rider portal and must not get a buyer profile.
      const { data: riderMe } = await supabase.rpc('rider_me');
      if (riderMe) {
        router.replace('/rider');
        return;
      }

      // Suppliers belong on their own dashboard.`),
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
      if (p.length !== 1) { console.log('FAILED   ' + file + ' edit #' + (n + 1) + ': found ' + p.length + ' matches for: ' + e.find); failed = true; return; }
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
console.log('\nDone.');