// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE-go file.

// Port of Go's fmt/print.go (Sprintf path) for scalar values.

import { Buf, Fmt } from './format.ts';
import { GoFloat, GoInt, GoString } from './values.ts';
import { asciiBytes, decodeBytes, decodeRune, encodeString } from './utf8.ts';

type Arg =
  | { k: 'nil' }
  | { k: 'bool'; v: boolean }
  | { k: 'int'; v: GoInt }
  | { k: 'float'; v: GoFloat }
  | { k: 'string'; b: Uint8Array }
  | { k: 'bytes'; b: Uint8Array }
  | { k: 'list'; v: Arg[] };

const NIL: Arg = { k: 'nil' };
const FAKE_POINTER = 0xc000000000n;

function normalize(x: unknown): Arg {
  if (x === null || x === undefined) return NIL;
  switch (typeof x) {
    case 'boolean':
      return { k: 'bool', v: x };
    case 'string':
      return { k: 'string', b: encodeString(x) };
    case 'number':
      if (Number.isInteger(x) && Math.abs(x) < 2 ** 63 && !Object.is(x, -0)) return { k: 'int', v: new GoInt('int', x) };
      return { k: 'float', v: new GoFloat(64, x) };
    case 'bigint':
      if (x < -(1n << 63n) || x >= 1n << 63n) throw new RangeError(`bigint ${x} overflows int64; wrap it with uint64()`);
      return { k: 'int', v: new GoInt('int64', x) };
  }
  if (x instanceof GoInt) return { k: 'int', v: x };
  if (x instanceof GoFloat) return { k: 'float', v: x };
  if (x instanceof GoString) return { k: 'string', b: x.bytes };
  if (x instanceof Uint8Array) return { k: 'bytes', b: x };
  if (Array.isArray(x)) return { k: 'list', v: x.map(normalize) };
  throw new TypeError(`sprintf: unsupported argument of type ${Object.prototype.toString.call(x)}`);
}

function typeName(a: Arg): string {
  switch (a.k) {
    case 'nil': return '<nil>';
    case 'bool': return 'bool';
    case 'int': return a.v.kind;
    case 'float': return a.v.bits === 32 ? 'float32' : 'float64';
    case 'string': return 'string';
    case 'bytes': return '[]uint8';
    case 'list': {
      if (a.v.length === 0) return '[]interface {}';
      const first = a.v[0] as Arg;
      if (first.k === 'nil') return '[]interface {}';
      const n = typeName(first);
      for (const e of a.v) if (e.k === 'nil' || typeName(e) !== n) return '[]interface {}';
      return '[]' + n;
    }
  }
}

const rune = (c: string): number => c.charCodeAt(0);
const isVerb = (verb: number, chars: string): boolean => verb < 128 && chars.includes(String.fromCharCode(verb));

// tooLarge reports whether the magnitude is too large for a width or precision.
const tooLarge = (x: number): boolean => x > 1e6 || x < -1e6;

function parsenum(s: Uint8Array, start: number, end: number): [number, boolean, number] {
  if (start >= end) return [0, false, end];
  let num = 0;
  let isnum = false;
  let i = start;
  for (; i < end && s[i]! >= 48 && s[i]! <= 57; i++) {
    if (tooLarge(num)) return [0, false, end];
    num = num * 10 + (s[i]! - 48);
    isnum = true;
  }
  return [num, isnum, i];
}

class Printer {
  buf = new Buf();
  f = new Fmt(this.buf);
  reordered = false;
  goodArgNum = true;

  private badVerb(arg: Arg, verb: number): void {
    const b = this.buf;
    b.ascii('%!');
    b.rune(verb);
    b.byte(40);
    if (arg.k === 'nil') {
      b.ascii('<nil>');
    } else {
      b.ascii(typeName(arg));
      b.byte(61);
      this.printArg(arg, rune('v'));
    }
    b.byte(41);
  }

  private fmt0x64(v: bigint, leading0x: boolean): void {
    const sharp = this.f.sharp;
    this.f.sharp = leading0x;
    this.f.fmtInteger(v, 16, false, rune('v'), false);
    this.f.sharp = sharp;
  }

  private fmtInteger(arg: Arg, gi: GoInt, verb: number): void {
    const f = this.f;
    const u = BigInt.asUintN(64, gi.value);
    const signed = gi.signed;
    switch (String.fromCharCode(verb)) {
      case 'v':
        if (f.sharpV && !signed) this.fmt0x64(u, true);
        else f.fmtInteger(u, 10, signed, verb, false);
        break;
      case 'd': f.fmtInteger(u, 10, signed, verb, false); break;
      case 'b': f.fmtInteger(u, 2, signed, verb, false); break;
      case 'o':
      case 'O': f.fmtInteger(u, 8, signed, verb, false); break;
      case 'x': f.fmtInteger(u, 16, signed, verb, false); break;
      case 'X': f.fmtInteger(u, 16, signed, verb, true); break;
      case 'c': f.fmtC(u); break;
      case 'q': f.fmtQc(u); break;
      case 'U': f.fmtUnicode(u); break;
      default: this.badVerb(arg, verb);
    }
  }

  private fmtFloat(arg: Arg, gf: GoFloat, verb: number): void {
    const f = this.f;
    const v = gf.value;
    switch (String.fromCharCode(verb)) {
      case 'v': f.fmtFloat(v, gf.bits, 'g', -1); break;
      case 'b': case 'g': case 'G': case 'x': case 'X':
        f.fmtFloat(v, gf.bits, String.fromCharCode(verb), -1);
        break;
      case 'f': case 'e': case 'E':
        f.fmtFloat(v, gf.bits, String.fromCharCode(verb), 6);
        break;
      case 'F': f.fmtFloat(v, gf.bits, 'f', 6); break;
      default: this.badVerb(arg, verb);
    }
  }

  private fmtString(arg: Arg, s: Uint8Array, verb: number): void {
    const f = this.f;
    switch (String.fromCharCode(verb)) {
      case 'v':
        if (f.sharpV) f.fmtQ(s);
        else f.fmtS(s);
        break;
      case 's': f.fmtS(s); break;
      case 'x': f.fmtSbx(s, false); break;
      case 'X': f.fmtSbx(s, true); break;
      case 'q': f.fmtQ(s); break;
      default: this.badVerb(arg, verb);
    }
  }

  private fmtBytes(arg: Arg, v: Uint8Array, verb: number, typeString: string): void {
    const f = this.f;
    const b = this.buf;
    switch (String.fromCharCode(verb)) {
      case 'v':
      case 'd':
        if (f.sharpV) {
          b.ascii(typeString);
          b.byte(123);
          for (let i = 0; i < v.length; i++) {
            if (i > 0) b.ascii(', ');
            this.fmt0x64(BigInt(v[i]!), true);
          }
          b.byte(125);
        } else {
          b.byte(91);
          for (let i = 0; i < v.length; i++) {
            if (i > 0) b.byte(32);
            f.fmtInteger(BigInt(v[i]!), 10, false, verb, false);
          }
          b.byte(93);
        }
        break;
      case 's': f.fmtS(v); break;
      case 'x': f.fmtSbx(v, false); break;
      case 'X': f.fmtSbx(v, true); break;
      case 'q': f.fmtQ(v); break;
      default: {
        // Go falls back to element-wise printing of the []uint8.
        if (f.sharpV) b.ascii('[]uint8{');
        else b.byte(91);
        for (let i = 0; i < v.length; i++) {
          if (i > 0) b.ascii(f.sharpV ? ', ' : ' ');
          this.printArg({ k: 'int', v: new GoInt('uint8', v[i]!) }, verb);
        }
        b.byte(f.sharpV ? 125 : 93);
      }
    }
    void arg;
  }

  private fmtList(arg: Arg & { k: 'list' }, verb: number): void {
    const b = this.buf;
    if (this.f.sharpV) {
      b.ascii(typeName(arg));
      b.byte(123);
      arg.v.forEach((e, i) => {
        if (i > 0) b.ascii(', ');
        this.printArg(e, verb);
      });
      b.byte(125);
    } else {
      b.byte(91);
      arg.v.forEach((e, i) => {
        if (i > 0) b.byte(32);
        this.printArg(e, verb);
      });
      b.byte(93);
    }
  }

  printArg(arg: Arg, verb: number): void {
    if (arg.k === 'nil') {
      if (verb === rune('T') || verb === rune('v')) this.f.padAscii('<nil>');
      else this.badVerb(arg, verb);
      return;
    }
    if (verb === rune('w') && arg.k === 'list') {
      // Sprintf cannot wrap errors, so %w is always a bad verb.
      this.badVerb(arg, verb);
      return;
    }
    if (verb === rune('T')) {
      this.f.fmtS(asciiBytes(typeName(arg)));
      return;
    }
    if (verb === rune('p')) {
      // JS has no pointers; slices (arrays, Uint8Array) print a fixed fake address.
      if (arg.k === 'list' || arg.k === 'bytes') this.fmt0x64(FAKE_POINTER, !this.f.sharp);
      else this.badVerb(arg, verb);
      return;
    }
    switch (arg.k) {
      case 'bool':
        if (verb === rune('t') || verb === rune('v')) this.f.fmtBoolean(arg.v);
        else this.badVerb(arg, verb);
        break;
      case 'int': this.fmtInteger(arg, arg.v, verb); break;
      case 'float': this.fmtFloat(arg, arg.v, verb); break;
      case 'string': this.fmtString(arg, arg.b, verb); break;
      case 'bytes': this.fmtBytes(arg, arg.b, verb, '[]byte'); break;
      case 'list': this.fmtList(arg, verb); break;
    }
  }

  // parseArgNumber returns [index, bytes to consume, ok].
  private parseArgNumber(format: Uint8Array, at: number): [number, number, boolean] {
    const len = format.length - at;
    if (len < 3) return [0, 1, false];
    for (let i = 1; i < len; i++) {
      if (format[at + i] === 93) {
        // parsenum on the substring format[at+1 .. at+i]
        const [width, ok, newi] = parsenum(format, at + 1, at + i);
        if (!ok || newi !== at + i) return [0, i + 1, false];
        return [width - 1, i + 1, true];
      }
    }
    return [0, 1, false];
  }

  private argNumber(argNum: number, format: Uint8Array, i: number, numArgs: number): [number, number, boolean] {
    if (format.length <= i || format[i] !== 91) return [argNum, i, false];
    this.reordered = true;
    const [index, wid, ok] = this.parseArgNumber(format, i);
    if (ok && index >= 0 && index < numArgs) return [index, i + wid, true];
    this.goodArgNum = false;
    return [argNum, i + wid, ok];
  }

  private intFromArg(a: Arg[], argNum: number): [number, boolean, number] {
    let num = 0;
    let isInt = false;
    let newArgNum = argNum;
    if (argNum < a.length) {
      const x = a[argNum]!;
      if (x.k === 'int') {
        const v = x.v.value;
        if (v >= -(1n << 63n) && v < 1n << 63n) {
          num = Number(v);
          isInt = true;
        }
      }
      newArgNum = argNum + 1;
      if (tooLarge(num)) {
        num = 0;
        isInt = false;
      }
    }
    return [num, isInt, newArgNum];
  }

  doPrintf(format: Uint8Array, a: Arg[]): void {
    const end = format.length;
    const p = this;
    const f = this.f;
    let argNum = 0;
    let afterIndex = false;
    this.reordered = false;
    formatLoop: for (let i = 0; i < end; ) {
      this.goodArgNum = true;
      const lasti = i;
      while (i < end && format[i] !== 37) i++;
      if (i > lasti) this.buf.bytes(format.subarray(lasti, i));
      if (i >= end) break;
      i++;
      f.clearflags();
      simple: for (; i < end; i++) {
        const c = format[i]!;
        switch (c) {
          case 35: f.sharp = true; break;
          case 48: f.zero = true; break;
          case 43: f.plus = true; break;
          case 45: f.minus = true; break;
          case 32: f.space = true; break;
          default:
            if (c >= 97 && c <= 122 && argNum < a.length) {
              if (c === 119 || c === 118) {
                f.sharpV = f.sharp;
                f.sharp = false;
                f.plusV = f.plus;
                f.plus = false;
              }
              this.printArg(a[argNum]!, c);
              argNum++;
              i++;
              continue formatLoop;
            }
            break simple;
        }
      }

      [argNum, i, afterIndex] = this.argNumber(argNum, format, i, a.length);

      if (i < end && format[i] === 42) {
        i++;
        [f.wid, f.widPresent, argNum] = this.intFromArg(a, argNum);
        if (!f.widPresent) this.buf.ascii('%!(BADWIDTH)');
        if (f.wid < 0) {
          f.wid = -f.wid;
          f.minus = true;
          f.zero = false;
        }
        afterIndex = false;
      } else {
        [f.wid, f.widPresent, i] = parsenum(format, i, end);
        if (afterIndex && f.widPresent) this.goodArgNum = false;
      }

      if (i + 1 < end && format[i] === 46) {
        i++;
        if (afterIndex) this.goodArgNum = false;
        [argNum, i, afterIndex] = this.argNumber(argNum, format, i, a.length);
        if (i < end && format[i] === 42) {
          i++;
          [f.prec, f.precPresent, argNum] = this.intFromArg(a, argNum);
          if (f.prec < 0) {
            f.prec = 0;
            f.precPresent = false;
          }
          if (!f.precPresent) this.buf.ascii('%!(BADPREC)');
          afterIndex = false;
        } else {
          [f.prec, f.precPresent, i] = parsenum(format, i, end);
          if (!f.precPresent) {
            f.prec = 0;
            f.precPresent = true;
          }
        }
      }

      if (!afterIndex) [argNum, i, afterIndex] = this.argNumber(argNum, format, i, a.length);

      if (i >= end) {
        this.buf.ascii('%!(NOVERB)');
        break;
      }

      const [verb, size] = decodeRune(format, i);
      i += size;

      if (verb === 37) {
        this.buf.byte(37);
      } else if (!this.goodArgNum) {
        this.buf.ascii('%!');
        this.buf.rune(verb);
        this.buf.ascii('(BADINDEX)');
      } else if (argNum >= a.length) {
        this.buf.ascii('%!');
        this.buf.rune(verb);
        this.buf.ascii('(MISSING)');
      } else {
        if (verb === 119 || verb === 118) {
          f.sharpV = f.sharp;
          f.sharp = false;
          f.plusV = f.plus;
          f.plus = false;
        }
        this.printArg(a[argNum]!, verb);
        argNum++;
      }
    }

    if (!this.reordered && argNum < a.length) {
      f.clearflags();
      this.buf.ascii('%!(EXTRA ');
      for (let k = argNum; k < a.length; k++) {
        if (k > argNum) this.buf.ascii(', ');
        const arg = a[k]!;
        if (arg.k === 'nil') {
          this.buf.ascii('<nil>');
        } else {
          this.buf.ascii(typeName(arg));
          this.buf.byte(61);
          this.printArg(arg, rune('v'));
        }
      }
      this.buf.byte(41);
    }
    void p;
    void isVerb;
  }
}

/** Like sprintf but returns the exact bytes Go would produce (which may be invalid UTF-8). */
export function sprintfBytes(format: string | Uint8Array, ...args: unknown[]): Uint8Array {
  const p = new Printer();
  const fmt = typeof format === 'string' ? encodeString(format) : format;
  p.doPrintf(fmt, args.map(normalize));
  return Uint8Array.from(p.buf.a);
}

/**
 * Go's fmt.Sprintf. The result is decoded as UTF-8, so bytes that Go would emit as
 * invalid UTF-8 come back as U+FFFD; use sprintfBytes to see them.
 */
export function sprintf(format: string, ...args: unknown[]): string {
  return decodeBytes(sprintfBytes(format, ...args));
}
