import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { check, haveGo, oracle, parseNdjson, type OracleCase } from './oracle-util.ts';

const fixture = (name: string): string => {
  const raw = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return (name.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
};

function expectClean(cases: OracleCase[]): void {
  const bad = check(cases);
  assert.equal(bad.length, 0, `${bad.length}/${cases.length} differ from Go, first: ${JSON.stringify(bad[0])}`);
}

test('golden cases match Go (recorded output)', () => {
  const cases = parseNdjson(fixture('golden.ndjson'));
  assert.ok(cases.length > 2000);
  expectClean(cases);
});

test('random fixture matches Go (recorded output)', () => {
  const cases = parseNdjson(fixture('random.ndjson.gz'));
  assert.ok(cases.length >= 5000);
  expectClean(cases);
});

test('negative control: the checker reports a wrong expectation', () => {
  const cases = parseNdjson(fixture('golden.ndjson')).slice(0, 5);
  cases[2]!.o = Buffer.from('not what Go printed').toString('base64');
  const bad = check(cases);
  assert.equal(bad.length, 1);
  assert.equal(bad[0]!.i, 2);
});

// Live differential run against the installed Go toolchain. Skipped loudly when Go is absent.
test('live: 30000 fresh random cases against the local Go toolchain', { skip: process.env.GO_PRINTF_LIVE ? false : 'set GO_PRINTF_LIVE=1 (needs `go` on PATH) to run the live differential' }, () => {
  assert.ok(haveGo(), 'go not found on PATH');
  const seed = String(Number(process.env.GO_PRINTF_SEED ?? Date.now() % 1e6));
  console.log(`# live seed ${seed}`);
  for (const [kind, n] of [['mixed', 15000], ['float', 6000], ['int', 3000], ['text', 6000]] as const) {
    expectClean(oracle(['gen', '-seed', seed, '-n', String(n), '-kind', kind]));
  }
});
