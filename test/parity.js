// Express (server/) and the Supabase edge function (supabase/functions/api/)
// are hand-kept twins. Fail when routes or SQL templates drift apart.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Express-only catch-all that serves public/index.html. The edge function has no static files.
const EXPRESS_ONLY = new Set(['GET *']);

const norm = (p) => p.replace(/:[A-Za-z]+/g, ':p');
const expressRoutes = new Set(
  [...read('server/app.js').matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)]
    .map((m) => `${m[1].toUpperCase()} ${norm(m[2])}`));
const edgeRoutes = new Set(
  [...read('supabase/functions/api/index.ts').matchAll(/\bon\(\s*'([A-Z]+)',\s*'([^']+)'/g)]
    .map((m) => `${m[1]} ${norm(m[2])}`));

const onlyExpress = [...expressRoutes].filter((r) => !edgeRoutes.has(r) && !EXPRESS_ONLY.has(r));
const onlyEdge = [...edgeRoutes].filter((r) => !expressRoutes.has(r));
assert.deepStrictEqual({ onlyExpress, onlyEdge }, { onlyExpress: [], onlyEdge: [] }, 'route drift between server/app.js and supabase/functions/api/index.ts');

// SQL templates: every backtick literal that holds a statement, whitespace collapsed.
function sqlTemplates(file) {
  const out = [];
  for (const m of read(file).matchAll(/`([^`]*)`/g)) {
    if (/\bSELECT\b[\s\S]*\bFROM\b|^\s*WITH\b/i.test(m[1])) out.push(m[1].replace(/\s+/g, ' ').trim());
  }
  return out.sort();
}
const js = sqlTemplates('server/queries.js');
const ts = sqlTemplates('supabase/functions/api/queries.ts');
const count = (a) => a.reduce((m, s) => m.set(s, (m.get(s) || 0) + 1), new Map());
const jc = count(js), tc = count(ts);
const drift = [...new Set([...jc.keys(), ...tc.keys()])]
  .filter((s) => jc.get(s) !== tc.get(s))
  .map((s) => `js=${jc.get(s) || 0} ts=${tc.get(s) || 0}: ${s.slice(0, 110)}`);
assert.strictEqual(drift.length, 0, `SQL drift between server/queries.js and queries.ts:\n${drift.join('\n')}`);

console.log(`parity ok (${edgeRoutes.size} routes, ${js.length} SQL templates)`);
