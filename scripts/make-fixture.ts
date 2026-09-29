// Builds test/fixtures/random.ndjson.gz: a compact, fixed sample of random cases with Go's output.
//   node scripts/make-fixture.ts       (needs `go` on PATH)
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { oracle } from '../test/oracle-util.ts';

const plan: [string, number, number][] = [
  ['mixed', 7001, 3000],
  ['float', 7002, 1200],
  ['int', 7003, 600],
  ['text', 7004, 900],
];
const lines: string[] = [];
for (const [kind, seed, n] of plan) {
  for (const c of oracle(['gen', '-seed', String(seed), '-n', String(n), '-kind', kind])) lines.push(JSON.stringify(c));
}
const buf = gzipSync(Buffer.from(lines.join('\n') + '\n'), { level: 9 });
writeFileSync(new URL('../test/fixtures/random.ndjson.gz', import.meta.url), buf);
console.log(`wrote ${lines.length} cases, ${buf.length} bytes gzipped`);
