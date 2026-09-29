// Scores go-printf and the npm incumbents on the W47 scalar corpus (verb-valid cases only),
// regenerated from real Go by scripts/corpus. Incumbents are installed into .cache/ (not committed).
//   npm run bench:incumbents        (needs `go` and network access to the npm registry)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const cache = root + '.cache/incumbents';
mkdirSync(cache, { recursive: true });
writeFileSync(cache + '/package.json', '{"private":true}');
execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', 'gofmt@0.1.0', 'sprintf-js@1.1.3', 'printj@1.3.1', 'fast-printf@1.6.10'], { cwd: cache, stdio: 'inherit', timeout: 300000 });
const gen = execFileSync('go', ['run', '.'], { cwd: root + 'scripts/corpus', maxBuffer: 1 << 28, timeout: 300000 }).toString();
const rows = JSON.parse(gen).filter((x) => ['int', 'float', 'string', 'bool'].includes(x.type) && x.ok);

const req = createRequire(cache + '/x.js');
const { sprintf, int, float64 } = await import(root + 'dist/index.js');
const libs = {
  'gofmt@0.1.0': (f, a) => req('gofmt')()(f, a),
  'sprintf-js@1.1.3': (f, a) => req('sprintf-js').sprintf(f, a),
  'printj@1.3.1': (f, a) => req('printj').sprintf(f, a),
  'fast-printf@1.6.10': (f, a) => req('fast-printf').printf(f, a),
  'go-printf (bare JS values)': (f, a) => sprintf(f, a),
  'go-printf (int()/float64() wrappers)': (f, a, t) => sprintf(f, t === 'int' ? int(a) : t === 'float' ? float64(a) : a),
};
console.log(`corpus: ${rows.length} verb-valid scalar cases (Go output as truth)`);
for (const [name, fn] of Object.entries(libs)) {
  let ok = 0;
  for (const x of rows) {
    let o;
    try { o = fn(x.fmt, x.arg, x.type); } catch { o = 'ERR'; }
    if (o === x.out) ok++;
  }
  console.log(`${name.padEnd(38)} ${String(ok).padStart(5)}/${rows.length}  ${(100 * ok / rows.length).toFixed(1)}%`);
}
