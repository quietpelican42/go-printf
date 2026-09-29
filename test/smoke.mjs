/**
 * Plain-JS checks against the built package, so they run on every Node version in
 * `engines` (the TypeScript suite needs type stripping, which is Node 24+).
 *
 *   npm run build && node --test test/smoke.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const g = await import('../dist/index.js');
const { sprintf, sprintfBytes, int, int64, uint64, uint8, float32, float64, rune, gostring, formatFloat } = g;

test('verbs, flags, width and precision', () => {
  assert.equal(sprintf('%06d|%+d|%x|%#o|%08.3f|%-6s|', 42, 42, 255, 8, -3.14159, 'go'), '000042|+42|ff|010|-003.142|go    |');
  assert.equal(sprintf('%e|%g|%v', 123456.789, 1e21, float64(1e6)), '1.234568e+05|1e+21|1e+06');
  assert.equal(sprintf('%q|%+q|%#q|%U', 'a\tb', '日本', 'raw', 0x1f600), '"a\\tb"|"\\u65e5\\u672c"|`raw`|U+1F600');
});

test('wrappers and defaults', () => {
  assert.equal(sprintf('%T %T %T %T', 1, 1.5, 10n, float32(1)), 'int float64 int64 float32');
  assert.equal(sprintf('%d %d %x', uint8(300), int64(2n ** 63n), uint64(-1n)), '44 -9223372036854775808 ffffffffffffffff');
  assert.equal(sprintf('%v %v', float32(0.1), float64(Math.fround(0.1))), '0.1 0.10000000149011612');
  assert.equal(sprintf('%c|%q', rune(0x65e5), rune(0x65e5)), "日|'日'");
  assert.equal(sprintf('%d', int(7)), '7');
});

test('error forms', () => {
  assert.equal(sprintf('%d', 'x'), '%!d(string=x)');
  assert.equal(sprintf('%d %d', 1), '1 %!d(MISSING)');
  assert.equal(sprintf('%d', 1, 2), '1%!(EXTRA int=2)');
  assert.equal(sprintf('%[3]d', 1), '%!d(BADINDEX)');
  assert.equal(sprintf('%'), '%!(NOVERB)');
  assert.equal(sprintf('%[2]d %[1]d', 1, 2), '2 1');
  assert.equal(sprintf('%[1]*d', 5, 42), '   42');
});

test('exact float rounding and byte handling', () => {
  assert.equal(sprintf('%.30f', 0.1), '0.100000000000000005551115123126');
  assert.equal(sprintf('%.2f', 1e21), '1000000000000000000000.00');
  assert.equal(formatFloat(0.1, 'g', -1, 32), '0.1');
  assert.equal(sprintf('%q', new Uint8Array([0x61, 0xff])), '"a\\xff"');
  assert.deepEqual(Array.from(sprintfBytes('%s', gostring(new Uint8Array([0xff])))), [0xff]);
});
