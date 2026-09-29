// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE-go file.

// UTF-8 helpers with Go's semantics (invalid input decodes to U+FFFD, width 1).

export const RUNE_ERROR = 0xfffd;
export const MAX_RUNE = 0x10ffff;

export type Bytes = ArrayLike<number>;

/** Decodes the rune at b[i]. Returns [rune, width]. Mirrors utf8.DecodeRune. */
export function decodeRune(b: Bytes, i: number, end: number = b.length): [number, number] {
  const b0 = b[i] as number;
  if (b0 < 0x80) return [b0, 1];
  const n = end - i;
  if (b0 >= 0xc2 && b0 <= 0xdf) {
    if (n < 2) return [RUNE_ERROR, 1];
    const b1 = b[i + 1] as number;
    if ((b1 & 0xc0) !== 0x80) return [RUNE_ERROR, 1];
    return [((b0 & 0x1f) << 6) | (b1 & 0x3f), 2];
  }
  if (b0 >= 0xe0 && b0 <= 0xef) {
    if (n < 3) return [RUNE_ERROR, 1];
    const b1 = b[i + 1] as number;
    const b2 = b[i + 2] as number;
    const lo = b0 === 0xe0 ? 0xa0 : 0x80;
    const hi = b0 === 0xed ? 0x9f : 0xbf;
    if (b1 < lo || b1 > hi || (b2 & 0xc0) !== 0x80) return [RUNE_ERROR, 1];
    return [((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f), 3];
  }
  if (b0 >= 0xf0 && b0 <= 0xf4) {
    if (n < 4) return [RUNE_ERROR, 1];
    const b1 = b[i + 1] as number;
    const b2 = b[i + 2] as number;
    const b3 = b[i + 3] as number;
    const lo = b0 === 0xf0 ? 0x90 : 0x80;
    const hi = b0 === 0xf4 ? 0x8f : 0xbf;
    if (b1 < lo || b1 > hi || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return [RUNE_ERROR, 1];
    return [((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f), 4];
  }
  return [RUNE_ERROR, 1];
}

export function validRune(r: number): boolean {
  return (r >= 0 && r < 0xd800) || (r > 0xdfff && r <= MAX_RUNE);
}

/** Appends the UTF-8 encoding of r to out; invalid runes encode as U+FFFD. */
export function appendRune(out: number[], r: number): void {
  if (!validRune(r)) r = RUNE_ERROR;
  if (r < 0x80) out.push(r);
  else if (r < 0x800) out.push(0xc0 | (r >> 6), 0x80 | (r & 0x3f));
  else if (r < 0x10000) out.push(0xe0 | (r >> 12), 0x80 | ((r >> 6) & 0x3f), 0x80 | (r & 0x3f));
  else out.push(0xf0 | (r >> 18), 0x80 | ((r >> 12) & 0x3f), 0x80 | ((r >> 6) & 0x3f), 0x80 | (r & 0x3f));
}

/** Number of runes in b, counting each invalid byte as one. */
export function runeCount(b: Bytes): number {
  let n = 0;
  for (let i = 0; i < b.length; ) {
    i += decodeRune(b, i)[1];
    n++;
  }
  return n;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });

/** JS string to UTF-8 bytes. Lone surrogates become U+FFFD. */
export function encodeString(s: string): Uint8Array {
  return enc.encode(s);
}

/** UTF-8 bytes to a JS string. Invalid sequences become U+FFFD. */
export function decodeBytes(b: Uint8Array): string {
  return dec.decode(b);
}

export function asciiBytes(s: string): number[] {
  const out: number[] = new Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
