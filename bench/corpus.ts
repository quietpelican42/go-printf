// Scores go-printf on the W47 research corpus, regenerated from real Go by scripts/corpus.
//   node bench/corpus.ts            (needs `go` on PATH)
import { spawnSync } from 'node:child_process';
import { float64, gostring, int, sprintf } from '../src/index.ts';

const r = spawnSync('go', ['run', '.'], {
  cwd: new URL('../scripts/corpus/', import.meta.url),
  encoding: 'utf8',
  maxBuffer: 1 << 28,
  timeout: 300000,
});
if (r.status !== 0) {
  console.error('go run failed:', r.stderr);
  process.exit(2);
}
interface Row { fmt: string; type: string; arg: unknown; out: string; ok: boolean }
const rows = JSON.parse(r.stdout) as Row[];

function arg(t: string, v: unknown): unknown {
  switch (t) {
    case 'int': return int(v as number);
    case 'float': return float64(v as number);
    default: return v;
  }
}

const stat: Record<string, [number, number]> = {};
const misses: string[] = [];
for (const c of rows) {
  if (!['int', 'float', 'string', 'bool', '[]int', '[]string'].includes(c.type)) continue;
  const a = c.type === '[]int' ? (c.arg as number[]).map((n) => int(n)) : c.type === '[]string' ? c.arg : arg(c.type, c.arg);
  const got = sprintf(c.fmt, a);
  const s = (stat[c.type] ??= [0, 0]);
  s[1]++;
  if (got === c.out) s[0]++;
  else misses.push(`${c.fmt} ${JSON.stringify(c.arg)} want ${JSON.stringify(c.out)} got ${JSON.stringify(got)}`);
}
let ok = 0;
let total = 0;
for (const [t, [a, b]] of Object.entries(stat)) {
  console.log(`${t.padEnd(10)} ${a}/${b}`);
  if (['int', 'float', 'string', 'bool'].includes(t)) { ok += a; total += b; }
}
const valid = rows.filter((c) => c.ok && ['int', 'float', 'string', 'bool'].includes(c.type));
console.log(`scalar total ${ok}/${total}; of which verb-valid cases: ${valid.length}`);
for (const m of misses.slice(0, 10)) console.log('MISS', m);
void gostring;
process.exit(misses.length === 0 ? 0 : 1);
