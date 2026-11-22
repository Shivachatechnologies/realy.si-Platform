// Finds load-time circular-import hazards in packages/backend: a module that uses an imported binding at module scope
// while both modules sit in the same import cycle ("Cannot access X before initialization" at runtime).
// Usage: node scripts/check-import-cycles.cjs  (exits 1 on any risk)
const ts = require(require.resolve('typescript', { paths: [process.cwd()] }));
const fs = require('fs'), path = require('path');
const ROOT = 'packages/backend/src';
const files = [];
(function walk(d){ for (const f of fs.readdirSync(d)) { const p = path.join(d,f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !f.endsWith('.d.ts')) files.push(path.normalize(p)); } })(ROOT + '/server');
const set = new Set(files);
function resolve(src, spec){ let base; if (spec.startsWith('@/server/')) base = path.join(ROOT, spec.slice(2)); else if (spec.startsWith('.')) base = path.join(path.dirname(src), spec); else return null; for (const c of [base+'.ts', base+'.tsx', path.join(base,'index.ts')]) if (set.has(path.normalize(c))) return path.normalize(c); return null; }
const G = new Map(), topUse = new Map();
for (const f of files) {
  const sf = ts.createSourceFile(f, fs.readFileSync(f,'utf8'), ts.ScriptTarget.Latest, true);
  const deps = new Map(); // local name -> module
  const edges = new Set();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && !st.importClause?.isTypeOnly) {
      const r = resolve(f, st.moduleSpecifier.text); if (!r) continue; edges.add(r);
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) if (!e.isTypeOnly) deps.set(e.name.text, r);
      if (nb && ts.isNamespaceImport(nb)) deps.set(nb.name.text, r);
      if (st.importClause?.name) deps.set(st.importClause.name.text, r);
    }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && !st.isTypeOnly) { const r = resolve(f, st.moduleSpecifier.text); if (r) edges.add(r); }
  }
  G.set(f, edges);
  // top-level references (outside functions/classes methods)
  const used = new Set();
  function visit(n){ if (ts.isFunctionLike(n) && n.body) { return; } if (ts.isIdentifier(n) && deps.has(n.text)) { const p = n.parent; if (!(p && ts.isPropertyAccessExpression(p) && p.name === n) && !(p && (ts.isImportSpecifier(p)||ts.isTypeReferenceNode(p)||ts.isTypeQueryNode(p)))) used.add(n.text); } ts.forEachChild(n, c => visit(c)); }
  for (const st of sf.statements) { if (ts.isImportDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) continue; if (ts.isFunctionDeclaration(st)) continue; visit(st); }
  topUse.set(f, [...used].map(u => [u, deps.get(u)]));
}
// SCCs
let idx=0; const I=new Map(), L=new Map(), S=[], on=new Set(), comps=[];
function sc(v){ I.set(v,idx); L.set(v,idx); idx++; S.push(v); on.add(v); for (const w of G.get(v)||[]) { if (!I.has(w)) { sc(w); L.set(v, Math.min(L.get(v), L.get(w))); } else if (on.has(w)) L.set(v, Math.min(L.get(v), I.get(w))); } if (L.get(v)===I.get(v)) { const c=[]; let w; do { w=S.pop(); on.delete(w); c.push(w);} while(w!==v); if (c.length>1) comps.push(c);} }
for (const v of G.keys()) if (!I.has(v)) sc(v);
let risks = 0;
for (const c of comps) { const cs = new Set(c); for (const f of c) for (const [u, m] of topUse.get(f)) if (cs.has(m)) { risks++; console.log('RISK', f, 'uses', u, 'from', m, `(cycle of ${c.length})`); } }
console.log(`import cycles: ${comps.length}, load-time risks: ${risks}`);
process.exit(risks ? 1 : 0);
