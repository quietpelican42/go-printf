// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE-go file.

// Port of Go's fmt/format.go: the raw formatter behind Printf.

import { formatFloat } from './ftoa.ts';
import { canBackquote, isPrint, quoteBytes, quoteRune } from './quote.ts';
import { appendRune, asciiBytes, decodeRune, MAX_RUNE, RUNE_ERROR, runeCount, type Bytes } from './utf8.ts';

export class Buf {
  a: number[] = [];
  byte(b: number): void {
    this.a.push(b);
  }
  bytes(b: Bytes): void {
    const a = this.a;
    for (let i = 0; i < b.length; i++) a.push(b[i] as number);
  }
  ascii(s: string): void {
    const a = this.a;
    for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i));
  }
  rune(r: number): void {
    appendRune(this.a, r);
  }
}

const ldigits = '0123456789abcdefx';
const udigits = '0123456789ABCDEFX';

export class Fmt {
  buf: Buf;
  widPresent = false;
  precPresent = false;
  minus = false;
  plus = false;
  sharp = false;
  space = false;
  zero = false;
  plusV = false;
  sharpV = false;
  wid = 0;
  prec = 0;

  constructor(buf: Buf) {
    this.buf = buf;
  }

  clearflags(): void {
    this.widPresent = this.precPresent = this.minus = this.plus = this.sharp = false;
    this.space = this.zero = this.plusV = this.sharpV = false;
    this.wid = 0;
    this.prec = 0;
  }

  writePadding(n: number): void {
    if (n <= 0) return;
    const c = this.zero && !this.minus ? 48 : 32;
    const a = this.buf.a;
    for (let i = 0; i < n; i++) a.push(c);
  }

  pad(b: Bytes): void {
    if (!this.widPresent || this.wid === 0) {
      this.buf.bytes(b);
      return;
    }
    const width = this.wid - runeCount(b);
    if (!this.minus) {
      this.writePadding(width);
      this.buf.bytes(b);
    } else {
      this.buf.bytes(b);
      this.writePadding(width);
    }
  }

  padAscii(s: string): void {
    this.pad(asciiBytes(s));
  }

  fmtBoolean(v: boolean): void {
    this.padAscii(v ? 'true' : 'false');
  }

  fmtUnicode(u: bigint): void {
    let prec = 4;
    if (this.precPresent && this.prec > 4) prec = this.prec;
    const out: number[] = asciiBytes('U+' + u.toString(16).toUpperCase().padStart(prec, '0'));
    if (this.sharp && u <= BigInt(MAX_RUNE) && isPrint(Number(u))) {
      out.push(0x20, 0x27);
      appendRune(out, Number(u));
      out.push(0x27);
    }
    const oldZero = this.zero;
    this.zero = false;
    this.pad(out);
    this.zero = oldZero;
  }

  /** u is the value as a uint64 bit pattern. */
  fmtInteger(u: bigint, base: number, isSigned: boolean, verb: number, upper: boolean): void {
    const negative = isSigned && BigInt.asIntN(64, u) < 0n;
    if (negative) u = BigInt.asUintN(64, -u);

    let prec = 0;
    if (this.precPresent) {
      prec = this.prec;
      if (prec === 0 && u === 0n) {
        const oldZero = this.zero;
        this.zero = false;
        this.writePadding(this.wid);
        this.zero = oldZero;
        return;
      }
    } else if (this.zero && !this.minus && this.widPresent) {
      prec = this.wid;
      if (negative || this.plus || this.space) prec--;
    }

    let digits = u.toString(base);
    if (upper) digits = digits.toUpperCase();
    if (prec > digits.length) digits = '0'.repeat(prec - digits.length) + digits;

    if (this.sharp) {
      switch (base) {
        case 2:
          digits = '0b' + digits;
          break;
        case 8:
          if (digits[0] !== '0') digits = '0' + digits;
          break;
        case 16:
          digits = '0' + (upper ? udigits : ldigits)[16] + digits;
          break;
      }
    }
    if (verb === 0x4f) digits = '0o' + digits; // 'O'
    if (negative) digits = '-' + digits;
    else if (this.plus) digits = '+' + digits;
    else if (this.space) digits = ' ' + digits;

    const oldZero = this.zero;
    this.zero = false;
    this.padAscii(digits);
    this.zero = oldZero;
  }

  truncate(b: Bytes): Bytes {
    if (this.precPresent) {
      let n = this.prec;
      for (let i = 0; i < b.length; ) {
        n--;
        if (n < 0) return Array.prototype.slice.call(b, 0, i) as number[];
        i += decodeRune(b, i)[1];
      }
    }
    return b;
  }

  fmtS(s: Bytes): void {
    this.pad(this.truncate(s));
  }

  fmtSbx(s: Bytes, upper: boolean): void {
    const digits = upper ? udigits : ldigits;
    let length = s.length;
    if (this.precPresent && this.prec < length) length = this.prec;
    let width = 2 * length;
    if (width > 0) {
      if (this.space) {
        if (this.sharp) width *= 2;
        width += length - 1;
      } else if (this.sharp) {
        width += 2;
      }
    } else {
      if (this.widPresent) this.writePadding(this.wid);
      return;
    }
    if (this.widPresent && this.wid > width && !this.minus) this.writePadding(this.wid - width);
    const a = this.buf.a;
    const x = (digits[16] as string).charCodeAt(0);
    if (this.sharp) a.push(48, x);
    for (let i = 0; i < length; i++) {
      if (this.space && i > 0) {
        a.push(32);
        if (this.sharp) a.push(48, x);
      }
      const c = s[i] as number;
      a.push(digits.charCodeAt(c >> 4), digits.charCodeAt(c & 0xf));
    }
    if (this.widPresent && this.wid > width && this.minus) this.writePadding(this.wid - width);
  }

  fmtQ(s: Bytes): void {
    s = this.truncate(s);
    if (this.sharp && canBackquote(s)) {
      this.pad([0x60, ...Array.from(s), 0x60]);
      return;
    }
    this.pad(quoteBytes(s, this.plus));
  }

  fmtC(c: bigint): void {
    const r = c > BigInt(MAX_RUNE) ? RUNE_ERROR : Number(c);
    const out: number[] = [];
    appendRune(out, r);
    this.pad(out);
  }

  fmtQc(c: bigint): void {
    const r = c > BigInt(MAX_RUNE) ? RUNE_ERROR : Number(c);
    this.pad(quoteRune(r, this.plus));
  }

  fmtFloat(v: number, size: 32 | 64, verb: string, prec: number): void {
    if (this.precPresent) prec = this.prec;
    let num = formatFloat(v, verb, prec, size);
    if (num[0] === '-' || num[0] === '+') {
      /* keep */
    } else {
      num = '+' + num;
    }
    if (this.space && num[0] === '+' && !this.plus) num = ' ' + num.slice(1);
    if (num[1] === 'I' || num[1] === 'N') {
      const oldZero = this.zero;
      this.zero = false;
      if (num[1] === 'N' && !this.space && !this.plus) num = num.slice(1);
      this.padAscii(num);
      this.zero = oldZero;
      return;
    }
    if (this.sharp && verb !== 'b') {
      let digits = 0;
      switch (verb) {
        case 'v':
        case 'g':
        case 'G':
        case 'x':
          digits = prec;
          if (digits === -1) digits = 6;
      }
      let tail = '';
      let hasDecimalPoint = false;
      let sawNonzeroDigit = false;
      for (let i = 1; i < num.length; i++) {
        const c = num[i] as string;
        if (c === '.') {
          hasDecimalPoint = true;
        } else if (c === 'p' || c === 'P') {
          tail += num.slice(i);
          num = num.slice(0, i);
        } else if ((c === 'e' || c === 'E') && verb !== 'x' && verb !== 'X') {
          tail += num.slice(i);
          num = num.slice(0, i);
        } else {
          if (c !== '0') sawNonzeroDigit = true;
          if (sawNonzeroDigit) digits--;
        }
      }
      if (!hasDecimalPoint) {
        if (num.length === 2 && num[1] === '0') digits--;
        num += '.';
      }
      while (digits > 0) {
        num += '0';
        digits--;
      }
      num += tail;
    }
    if (this.plus || num[0] !== '+') {
      if (this.zero && !this.minus && this.widPresent && this.wid > num.length) {
        this.buf.byte(num.charCodeAt(0));
        this.writePadding(this.wid - num.length);
        this.buf.ascii(num.slice(1));
        return;
      }
      this.padAscii(num);
      return;
    }
    this.padAscii(num.slice(1));
  }
}
