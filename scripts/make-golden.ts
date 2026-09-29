// Builds test/fixtures/golden.ndjson: a hand-written list of format/argument pairs, run through
// real Go (scripts/oracle) so each expected output is Go's own.
//   node scripts/make-golden.ts        (needs `go` on PATH)
import { writeFileSync } from 'node:fs';
import { oracle, type OracleCase } from '../test/oracle-util.ts';

type A = { t: string; v?: unknown };
const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64');
const I = (n: number | bigint, t = 'int'): A => ({ t, v: String(n) });
const f64 = (x: number): A => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return { t: 'float64', v: dv.getBigUint64(0).toString(16).padStart(16, '0') };
};
const f32 = (x: number): A => {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, x);
  return { t: 'float32', v: dv.getUint32(0).toString(16).padStart(8, '0') };
};
const S = (s: string | Buffer): A => ({ t: 'string', v: b64(s) });
const B = (s: string | Buffer): A => ({ t: 'bytes', v: b64(s) });
const T = (b: boolean): A => ({ t: 'bool', v: b });
const NIL: A = { t: 'nil' };
const L = (t: string, v: unknown[]): A => ({ t: '[]' + t, v });

const cases: [string, ...A[]][] = [];
const add = (f: string, ...a: A[]): void => {
  cases.push([f, ...a]);
};

// every verb on every scalar kind
for (const v of 'vdsqxXobcUeEfFgGtpT%wz') {
  for (const a of [I(42), I(-7, 'int8'), I(255, 'uint8'), I(1n << 63n, 'uint64'), f64(1.5), f32(0.1), S('héllo'), B('hi'), T(true), NIL]) if (!(v === 'p' && a.t === 'bytes')) add('%' + v, a); // %p of a slice prints a heap address
}
// flags, width, precision
for (const f of ['%+d', '% d', '%05d', '%-5d|', '%+05d', '% 05d', '%#x', '%#X', '%#o', '%#O', '%O', '%#b', '%.3d', '%8.3d', '%-8.3d|', '%08.3d', '%.0d', '%5.0d|', '%x', '%X', '%#08x', '%+x', '% x'])
  for (const a of [I(42), I(-42), I(0)]) add(f, a);
for (const f of ['%f', '%.0f', '%.1f', '%.2f', '%10.3f', '%-10.3f|', '%010.3f', '%+.2f', '% .2f', '%e', '%E', '%.0e', '%.10e', '%g', '%G', '%.3g', '%.10g', '%#g', '%#.3g', '%#.0f', '%#.0e', '%v', '%+v', '%#v', '%b', '%x', '%X', '%.3x', '%#x', '%08.3f', '%+08.3f'])
  for (const x of [0, -0, 1, -1.5, 0.5, 2.5, 3.5, 100, 1e6, 1e20, 1e21, 123456789.123, 1e-7, 0.000123, 5e-324, 1.7976931348623157e308, NaN, Infinity, -Infinity, 0.1, 2.675, 1.005, 999999.5, 99.5, 9.5])
    add(f, f64(x));
for (const x of [0.1, 16777216, 3.4028235e38, 1e-45, 0.3, 1 / 3, 1e10, 123456.789]) for (const f of ['%v', '%g', '%e', '%f', '%.3f', '%.10g']) add(f, f32(x));
// strings, runes, quoting
for (const f of ['%s', '%q', '%+q', '%#q', '%x', '%X', '% x', '%#x', '% #x', '%10s|', '%-10s|', '%.2s', '%10.2s|', '%.2q', '%10q|', '%v', '%#v', '%+v', '%5.1s|'])
  for (const s of ['', 'hi', 'héllo', 'a"b', '日本語', 'tab\there', 'x\ny', '\x00', "Go's", 'a`b', '\u007f', '­', '﻿', ' ', '\u{1f600}', '́', 'end\\']) add(f, S(s));
for (const raw of ['\xff', 'a\xffb', '\xc3', '\xe6\x97', '\xf0\x9f\x98', '\xed\xa0\x80', '\xc0\x80', 'ok\x80\x81'])
  for (const f of ['%q', '%+q', '%#q', '%s', '%x', '%.2q', '%v'])
    add(f, S(Buffer.from(raw, 'latin1')));
for (const f of ['%s', '%q', '%+q', '%#q', '%x', '%X', '% x', '%#x', '%v', '%d', '%#v', '%c', '%08b'])
  for (const raw of ['', 'abc', '\xff\xfe', 'hé']) add(f, B(Buffer.from(raw, 'latin1')));
for (const f of ['%c', '%q', '%+q', '%U', '%#U', '%#q', '%5c|', '%-5c|', '%.6U', '%08U', '%x', '%d', '%v'])
  for (const r of [65, 233, 0x65e5, 0x1f600, 0x10ffff, 0x110000, 0xd800, -1, 0, 7, 0x7f, 0xa0, 0xad, 0xfeff, 0x2028, 0xe000, 0xffff, 0x378, 0x1f000, 0xe0001, 0x1000c, 0x1000b, 0x10ffff, 0x2ffff, 0x2a6df, 0xe0100])
    add(f, I(r, 'int32'));
add('%c', I(-1)); add('%c', I(1n << 40n)); add('%U', I(-1)); add('%#U', I(-1)); add('%q', I(1n << 40n)); add('%c', I(1n << 64n - 1n, 'uint64'));
// bools, nil
for (const f of ['%t', '%v', '%5t|', '%-7v|', '%s', '%d', '%q', '%08v']) for (const b of [true, false]) add(f, T(b));
for (const f of ['%v', '%s', '%d', '%5v|', '%-5v|', '%T', '%+v', '%#v']) add(f, NIL);
// argument handling and error forms
add('%d'); add('%d %d', I(1)); add('%s', S('a'), S('b')); add('x', I(1)); add('x', I(1), S('a'), NIL, f64(1.5), T(true));
add('%'); add('abc%'); add('%5'); add('%.'); add('%5.'); add('%-'); add('%!'); add('100%%'); add('%5%'); add('%-5%|');
add('%[2]d %[1]d', I(1), I(2)); add('%[1]d %[1]d %d', I(7), I(8)); add('%[3]d', I(1), I(2)); add('%[0]d', I(1)); add('%[x]d', I(1)); add('%[1', I(1)); add('%[]d', I(1)); add('%[2]d', I(1));
add('%[1]*d', I(5), I(42)); add('%[2]*[1]d', I(42), I(5)); add('%*d', I(5), I(42)); add('%-*d|', I(5), I(42)); add('%*d', I(-5), I(42)); add('%0*d', I(-5), I(42)); add('%.*f', I(2), f64(3.14159)); add('%.*f', I(-2), f64(3.14159));
add('%*d', S('x'), I(42)); add('%.*f', S('x'), f64(1)); add('%*d', f64(3), I(42)); add('%*d', I(1000001), I(4)); add('%.*d', I(1000001), I(4));
add('%*d', I(5)); add('%[3]*.[2]*[1]f', f64(12.0), I(2), I(6)); add('%[1]3d', I(5)); add('%[1].3d', I(5)); add('%3[1]d', I(5)); add('%.[1]3d', I(5)); add('%[1]d %d', I(5), I(6));
add('%d %s %v', I(1), S('a')); add('%s %d', I(5), S('x')); add('%d', S('x')); add('%s', I(5)); add('%s', f64(2.5)); add('%d', f64(2.5)); add('%s', T(true)); add('%d', T(true)); add('%z', I(1)); add('%10z|', S('a')); add('%+d', S('a')); add('%10d|', S('a')); add('%-10d|', S('a')); add('%010d', S('a'));
add('%s %s', S('é'), I(3)); add('%é', I(1)); add('%日', I(1)); add('%\xff', I(1)); add('%w', I(1)); add('%+w', S('a')); add('%#w', I(5)); add('%3.2w', I(5));
add('%v %v %v', I(1), f64(1.5), S('a')); add('%d%%', I(50)); add('%%%d', I(5)); add('%d%', I(5));
// wrappers: sizes and signedness
for (const t of ['int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr']) for (const f of ['%v', '%d', '%x', '%#v', '%T', '%b', '%o', '%08d'])
  add(f, I(t.startsWith('u') ? 200 : -100, t));
add('%v %d', I(-1, 'int64'), I(9223372036854775807n, 'int64')); add('%x', I(-9223372036854775808n, 'int64')); add('%d', I(18446744073709551615n, 'uint64')); add('%#v', I(18446744073709551615n, 'uint64')); add('%#x', I(18446744073709551615n, 'uint64'));
// slices of scalars
for (const f of ['%v', '%d', '%s', '%q', '%x', '%5v|', '%-5v|', '%05d', '%#v', '%+v', '%T', '%.1f', '%t', '%08.3f'])
  for (const a of [L('int', ['1', '-2', '30']), L('string', [b64('a'), b64('b c'), b64('')]), L('float64', ['3ff8000000000000', 'c004000000000000']), L('bool', [true, false]), L('int32', ['65', '233'])]) add(f, a);
add('%v', B('')); add('%v', B('ab')); add('%d', B('ab')); add('%s', B('ab')); add('%c', B('ab')); add('%t', B('a')); add('%5d', B('ab')); add('%#v', B('ab')); add('%#v', B('')); add('%T', B('ab')); add('%p', I(1)); add('%p', S('a')); add('%p', NIL);
// Go's own doc examples
add('%6.2f', f64(3.14159)); add('%-8s|', S('go')); add('%08.3f', f64(-3.14159)); add('%x', S('hello')); add('% x', S('hello')); add('%#x', S('hello')); add('%+q', S('日本語')); add('%U', I(0x1F600, 'int32')); add('%#U', I(0x1F600, 'int32')); add('%e', f64(123456.789)); add('%g', f64(100000)); add('%g', f64(1000000)); add('%v', f64(1e6)); add('%v', f64(123456789)); add('%v', f64(0.000001)); add('%v', f64(0.0001));
add('%.3v', f64(3.14159)); add('%10.3v|', f64(3.14159)); add('%.3v', S('abcdef')); add('%.0f %.0f %.0f %.0f', f64(0.5), f64(1.5), f64(2.5), f64(3.5)); add('%.1f %.1f', f64(0.25), f64(0.35)); add('%.2f', f64(1.005)); add('%.15f', f64(0.1)); add('%.30f', f64(0.1)); add('%.60f', f64(1e-30)); add('%.400f', f64(5e-324)); add('%f', f64(1e300)); add('%.3e', f64(9.9995)); add('%.0e', f64(9.5)); add('%g', f64(1e-5)); add('%G', f64(1e-5)); add('%.20g', f64(0.1)); add('%.100g', f64(0.1));

const outCases = oracle(['run'], cases.map(([f, ...a]) => JSON.stringify(f.includes('\xff') ? { fb: b64(Buffer.from(f, 'latin1')), a } : { f, a })).join('\n') + '\n');
writeFileSync(new URL('../test/fixtures/golden.ndjson', import.meta.url), outCases.map((c: OracleCase) => JSON.stringify(c)).join('\n') + '\n');
console.log(`wrote ${outCases.length} golden cases`);
