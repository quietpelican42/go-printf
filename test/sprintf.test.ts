import assert from 'node:assert/strict';
import test from 'node:test';
import {
  byte, float32, float64, formatFloat, gostring, int, int16, int32, int64, int8, rune, sprintf, sprintfBytes,
  uint, uint16, uint32, uint64, uint8, uintptr,
} from '../src/index.ts';

const eq = (got: string | number, want: string | number): void => assert.equal(got, want);

test('basic verbs on bare values', () => {
  eq(sprintf('%d|%s|%v|%t', 42, 'hi', 1.5, true), '42|hi|1.5|true');
  eq(sprintf('%06d|%+d|%x|%X|%#x|%o|%#o|%O|%b|%c|%U', 42, 42, 255, 255, 255, 8, 8, 8, 5, 65, 0x1f600), '000042|+42|ff|FF|0xff|10|010|0o10|101|A|U+1F600');
  eq(sprintf('%8.3f|%-8.2f|%e|%E|%g|%G', 3.14159, 2.5, 123456.789, 0.000123, 1e21, 1e-7), '   3.142|2.50    |1.234568e+05|1.230000E-04|1e+21|1E-07');
  eq(sprintf('%q|%+q|%#q|%x|% X', 'a\tb', '日本', 'raw', 'hi', 'hi'), '"a\\tb"|"\\u65e5\\u672c"|`raw`|6869|68 69');
  eq(sprintf('100%%'), '100%');
});

test('bare value mapping: integer -> int, non-integer -> float64, bigint -> int64', () => {
  eq(sprintf('%T %T %T %T %T %T', 1, 1.5, 10n, 'a', true, null), 'int float64 int64 string bool <nil>');
  eq(sprintf('%T %T %T', -0, 1e21, NaN), 'float64 float64 float64');
  eq(sprintf('%v %v %v', 1e6, float64(1e6), float64(1e5)), '1000000 1e+06 100000');
  eq(sprintf('%v', 2 ** 53), '9007199254740992');
  eq(sprintf('%d', 9223372036854775807n), '9223372036854775807');
  eq(sprintf('%v', -0), '-0');
  eq(sprintf('%v %v %v', NaN, Infinity, -Infinity), 'NaN +Inf -Inf');
});

test('explicit wrappers carry type, width and signedness', () => {
  eq(sprintf('%T %T %T %T', int(1), uint8(1), rune(1), byte(1)), 'int uint8 int32 uint8');
  eq(sprintf('%d %d', uint8(300), int8(200)), '44 -56');
  eq(sprintf('%d %d', int16(-32769), uint16(65537)), '32767 1');
  eq(sprintf('%d %d', int32(2 ** 31), uint32(-1)), '-2147483648 4294967295');
  eq(sprintf('%d %d', int64(2n ** 63n), uint64(-1n)), '-9223372036854775808 18446744073709551615');
  eq(sprintf('%x', int64(-1n)), '-1');
  eq(sprintf('%x', uint64(-1n)), 'ffffffffffffffff');
  eq(sprintf('%#v %v', uint(255), uint(255)), '0xff 255');
  eq(sprintf('%c|%q|%U', rune(0x65e5), rune(0x65e5), rune(0x65e5)), '日|\'日\'|U+65E5');
  eq(sprintf('%v', uintptr(5)), '5');
  assert.throws(() => int(1.5), TypeError);
  assert.throws(() => int(NaN), TypeError);
  assert.throws(() => sprintf('%d', 2n ** 63n), RangeError);
});

test('float64 forces float formatting of an integral value', () => {
  eq(sprintf('%v %v', 100, float64(100)), '100 100');
  eq(sprintf('%T', float64(100)), 'float64');
  eq(sprintf('%d', float64(100)), '%!d(float64=100)');
  eq(sprintf('%.2f', float64(100)), '100.00');
});

test('float32 rounds with Math.fround and prints Go shortest for 32 bits', () => {
  eq(sprintf('%v', float32(0.1)), '0.1');
  eq(sprintf('%v', float64(Math.fround(0.1))), '0.10000000149011612');
  eq(sprintf('%v', float32(16777216)), '1.6777216e+07');
  eq(sprintf('%v', float32(3.4028235e38)), '3.4028235e+38');
  eq(sprintf('%v', float32(1e-45)), '1e-45');
  eq(sprintf('%T', float32(1)), 'float32');
  eq(sprintf('%.10f', float32(0.1)), '0.1000000015');
});

test('exact float rounding beyond what toFixed gives', () => {
  eq(sprintf('%.0f %.0f %.0f %.0f', 0.5, 1.5, 2.5, 3.5), '0 2 2 4');
  eq(sprintf('%.2f', 1.005), '1.00');
  eq(sprintf('%.30f', 0.1), '0.100000000000000005551115123126');
  eq(sprintf('%.3e', 9.9995), '9.999e+00');
  eq(sprintf('%.20g', 0.1), '0.10000000000000000555');
  eq(sprintf('%.400f', 5e-324).length, 402);
  eq(sprintf('%f', 1e300).length, 308);
  eq((1e21).toFixed(2), '1e+21'); // the JS behavior this library avoids
  eq(sprintf('%.2f', 1e21), '1000000000000000000000.00');
});

test('formatFloat is strconv.FormatFloat', () => {
  eq(formatFloat(1234.5678, 'f', -1, 64), '1234.5678');
  eq(formatFloat(1234.5678, 'e', 3, 64), '1.235e+03');
  eq(formatFloat(0.1, 'g', -1, 32), '0.1');
  eq(formatFloat(1, 'b', -1, 64), '4503599627370496p-52');
  eq(formatFloat(1, 'x', -1, 64), '0x1p+00');
});

test('byte slices format as []byte', () => {
  const b = new Uint8Array([104, 105, 0xff]);
  eq(sprintf('%v|%d|%x|%X|% x|%#x', b, b, b, b, b, b), '[104 105 255]|[104 105 255]|6869ff|6869FF|68 69 ff|0x6869ff');
  eq(sprintf('%s', new Uint8Array([104, 105])), 'hi');
  eq(sprintf('%q', b), '"hi\\xff"');
  eq(sprintf('%+q', new Uint8Array([0xc3, 0xa9])), '"\\u00e9"');
  eq(sprintf('%T', b), '[]uint8');
  eq(sprintf('%#v', new Uint8Array([1, 2])), '[]byte{0x1, 0x2}');
});

test('strconv.Quote details: escapes, invalid UTF-8, backquote forms', () => {
  eq(sprintf('%q', '\u007f­﻿ \u{1f600}\0'), '"\\x7f\\u00ad\\ufeff\\u2028😀\\x00"');
  eq(sprintf('%+q', '\u{1f600}é'), '"\\U0001f600\\u00e9"');
  eq(sprintf('%q', gostring(new Uint8Array([0x61, 0xff, 0xc3]))), '"a\\xff\\xc3"');
  eq(sprintf('%#q', 'has`tick'), '"has`tick"');
  eq(sprintf('%#q', 'tab\tok'), '`tab\tok`');
  eq(sprintf('%#q', 'nl\n'), '"nl\\n"');
  eq(sprintf('%q', 0x1f600), "'😀'");
  eq(sprintf('%q', 0x110000), "'�'");
  eq(sprintf('%+q', rune(0xd800)), "'\\ufffd'");
  eq(sprintf('%q', "'"), '"\'"');
  eq(sprintf('%q', rune(39)), "'\\''");
});

test('error forms', () => {
  eq(sprintf('%d', 'x'), '%!d(string=x)');
  eq(sprintf('%s', 5), '%!s(int=5)');
  eq(sprintf('%d %d', 1), '1 %!d(MISSING)');
  eq(sprintf('%d', 1, 'a', 2.5), '1%!(EXTRA string=a, float64=2.5)');
  eq(sprintf('%[3]d', 1, 2), '%!d(BADINDEX)');
  eq(sprintf('%'), '%!(NOVERB)');
  eq(sprintf('%z', 1), '%!z(int=1)');
  eq(sprintf('%*d', 'x', 1), '%!(BADWIDTH)1');
  eq(sprintf('%.*d', 'x', 1), '%!(BADPREC)1');
  eq(sprintf('%d', null), '%!d(<nil>)');
  eq(sprintf('%v', undefined), '<nil>');
  eq(sprintf('%10d|', 'x'), '%!d(string=         x)|');
});

test('argument indexes and star width/precision', () => {
  eq(sprintf('%[2]d %[1]d', 1, 2), '2 1');
  eq(sprintf('%[1]d %[1]d', 7), '7 7');
  eq(sprintf('%[1]*d', 5, 42), '   42');
  eq(sprintf('%*d|%-*d|', 5, 42, 5, 42), '   42|42   |');
  eq(sprintf('%*d', -5, 42), '42   ');
  eq(sprintf('%.*f', 2, 3.14159), '3.14');
  eq(sprintf('%[3]*.[2]*[1]f', float64(12), 2, 6), ' 12.00');
  eq(sprintf('%d %d', 1, 2, 3), '1 2%!(EXTRA int=3)');
  eq(sprintf('%[1]d', 1, 2), '1');
});

test('zero and minus flag interplay follows Go', () => {
  eq(sprintf('%-05d|', 42), '42   |');
  eq(sprintf('%05s', 'ab'), '000ab');
  eq(sprintf('%08.3f|%+08.3f|%08v', -3.14159, 3.14159, 1.5), '-003.142|+003.142|000001.5');
  eq(sprintf('%06.2f', NaN), '   NaN');
  eq(sprintf('%+.1f|% .1f', Infinity, 1.25), '+Inf| 1.2');
});

test('arrays of scalars print as [a b c]', () => {
  eq(sprintf('%v', [1, 2, 3]), '[1 2 3]');
  eq(sprintf('%v', ['a', 'b c']), '[a b c]');
  eq(sprintf('%q', ['a', 'b c']), '["a" "b c"]');
  eq(sprintf('%d', [1, 2]), '[1 2]');
  eq(sprintf('%5.1f|', [1.25, 2]), '[  1.2 %!f(int=    2)]|');
  eq(sprintf('%v', []), '[]');
  eq(sprintf('%v', [[1], [2, 3]]), '[[1] [2 3]]');
  eq(sprintf('%#v', [1, 2]), '[]int{1, 2}');
  eq(sprintf('%T', ['a']), '[]string');
  eq(sprintf('%T', [1, 'a']), '[]interface {}');
});

test('%p is meaningless in JS and prints a fixed placeholder for slices', () => {
  eq(sprintf('%p', 1), '%!p(int=1)');
  eq(sprintf('%p', null), '%!p(<nil>)');
  assert.match(sprintf('%p', [1]), /^0x[0-9a-f]+$/);
});

test('unsupported values throw TypeError', () => {
  assert.throws(() => sprintf('%v', {}), TypeError);
  assert.throws(() => sprintf('%v', () => 1), TypeError);
  assert.throws(() => sprintf('%v', Symbol('x')), TypeError);
  assert.throws(() => sprintf('%v', new Map()), TypeError);
});

test('sprintfBytes keeps bytes that are not valid UTF-8', () => {
  const out = sprintfBytes('%s|%c', gostring(new Uint8Array([0xff, 0x41])), 65);
  assert.deepEqual(Array.from(out), [0xff, 0x41, 0x7c, 0x41]);
  eq(sprintf('%s', gostring(new Uint8Array([0xff]))), '�');
  assert.deepEqual(Array.from(sprintfBytes(new Uint8Array([0x25, 0x64, 0xff]), 7)), [0x37, 0xff]);
});

test('large and boundary widths', () => {
  eq(sprintf('%5d', 1).length, 5);
  eq(sprintf('%1000000d', 1).length, 1000000);
  eq(sprintf('%*d', 1000001, 4), '%!(BADWIDTH)4');
  eq(sprintf('%.*d', 1000001, 4), '%!(BADPREC)4');
});

test('unicode width counts runes', () => {
  eq(sprintf('%5s|%-5s|', '日本', '日本'), '   日本|日本   |');
  eq(sprintf('%.1s', '日本'), '日');
});

test('formats not touching arguments pass through', () => {
  eq(sprintf('plain'), 'plain');
  eq(sprintf('日本 %s', 'é'), '日本 é');
  eq(sprintf(''), '');
});
