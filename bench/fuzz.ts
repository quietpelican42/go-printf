// Fuzz run. Two phases:
//   1. crash fuzz: random garbage formats and arguments; sprintfBytes must never throw or hang.
//   2. differential fuzz: fresh random cases from scripts/oracle compared with real Go.
//
//   node bench/fuzz.ts [--seconds 60] [--seed 1]
import { check, haveGo, oracle } from '../test/oracle-util.ts';
import * as g from '../src/index.ts';

const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const seconds = arg('seconds', 60);
let seed = arg('seed', 1);

// small deterministic PRNG (mulberry32)
function rng(s: number): () => number {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- phase 1: crash fuzz ----
{
  const rand = rng(seed);
  const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)] as T;
  const alphabet = '%%%%%[]*.-+# 0123456789vdsqxXobcUeEfFgGtpTwzé\xff'.split('');
  const pool: unknown[] = [
    0, 1, -1, 42, 2 ** 31, 2 ** 53, 1.5, -0, NaN, Infinity, 1e21, 5e-324, 1e300, 'a', '', 'héllo', '\ud800', '日本語', true, false, null, undefined,
    10n, -10n, 2n ** 62n, g.int8(-5), g.uint8(200), g.uint64(2n ** 64n - 1n), g.rune(0x1f600), g.float32(0.1), g.float64(3),
    g.gostring(new Uint8Array([0xff, 0xc3])), new Uint8Array([1, 2, 255]), [1, 2, 3], ['a', 'b'], [], [[1], [2]], [1, 'a', null],
  ];
  const end = Date.now() + (seconds * 1000) / 3;
  let n = 0;
  let thrown = 0;
  while (Date.now() < end) {
    let f = '';
    for (let i = 1 + Math.floor(rand() * 14); i > 0; i--) f += pick(alphabet);
    const args = Array.from({ length: Math.floor(rand() * 4) }, () => pick(pool));
    const t0 = performance.now();
    try {
      g.sprintfBytes(f, ...args);
    } catch (e) {
      thrown++;
      console.log('THROW', JSON.stringify(f), e);
      process.exitCode = 1;
    }
    if (performance.now() - t0 > 2000) {
      console.log('SLOW', JSON.stringify(f));
      process.exitCode = 1;
    }
    n++;
  }
  console.log(`crash fuzz: ${n} formats, ${thrown} exceptions`);
}

// ---- phase 3 is defined below phase 2 ----
// ---- phase 2: differential fuzz ----
if (!haveGo()) {
  console.log('SKIP differential fuzz: `go` not found on PATH');
} else {
  const end = Date.now() + (seconds * 1000 * 2) / 3;
  let total = 0;
  let bad = 0;
  const kinds = ['mixed', 'float', 'int', 'text'];
  for (let round = 0; Date.now() < end; round++) {
    const kind = kinds[round % kinds.length] as string;
    seed += 1000;
    const cases = oracle(['gen', '-seed', String(seed), '-n', '20000', '-kind', kind]);
    const m = check(cases);
    total += cases.length;
    bad += m.length;
    for (const x of m.slice(0, 3)) console.log('MISMATCH', kind, seed, JSON.stringify(x));
  }
  console.log(`differential fuzz: ${total} cases vs real Go, ${bad} mismatches`);
  if (bad > 0) process.exitCode = 1;
}

// ---- phase 3: every code point through %q %+q %U %#U ----
if (haveGo()) {
  const lines: string[] = [];
  for (let r = 0; r <= 0x110010; r++) {
    const a = { t: 'int32', v: String(r) };
    lines.push(JSON.stringify({ f: '%q %+q %U %#U', a: [a, a, a, a] }));
  }
  const cases = oracle(['run'], lines.join('\n') + '\n');
  const bad = check(cases);
  console.log(`all code points (0..0x110010) x 4 verbs: ${cases.length - bad.length}/${cases.length} match Go`);
  if (bad.length > 0) process.exitCode = 1;
}
