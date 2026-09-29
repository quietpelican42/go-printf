// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE-go file.

// Port of Go's strconv.Quote family (quote.go).

import { isNotPrint16, isNotPrint32, isPrint16, isPrint32 } from './isprint.ts';
import { appendRune, decodeRune, RUNE_ERROR, validRune, type Bytes } from './utf8.ts';

const lowerhex = '0123456789abcdef';

/** Index of the first element >= v (sort.Search semantics). */
function bsearch(s: number[], v: number): number {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if ((s[m] as number) < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function inTable(s: number[], v: number): boolean {
  const i = bsearch(s, v);
  return i < s.length && s[i] === v;
}

/** strconv.IsPrint. */
export function isPrint(r: number): boolean {
  if (r <= 0xff) {
    if (r >= 0x20 && r <= 0x7e) return true;
    if (r >= 0xa1 && r <= 0xff) return r !== 0xad;
    return false;
  }
  if (r >= 0 && r < 1 << 16) {
    const i = bsearch(isPrint16, r);
    if (i >= isPrint16.length || r < (isPrint16[i & ~1] as number) || (isPrint16[i | 1] as number) < r) return false;
    return !inTable(isNotPrint16, r);
  }
  const i = bsearch(isPrint32, r);
  if (i >= isPrint32.length || r < (isPrint32[i & ~1] as number) || (isPrint32[i | 1] as number) < r) return false;
  if (r >= 0x20000) return true;
  return !inTable(isNotPrint32, r - 0x10000);
}

function appendEscapedRune(out: number[], r: number, quote: number, asciiOnly: boolean): void {
  if (r === quote || r === 0x5c) {
    out.push(0x5c, r);
    return;
  }
  if (asciiOnly) {
    if (r < 0x80 && isPrint(r)) {
      out.push(r);
      return;
    }
  } else if (isPrint(r)) {
    appendRune(out, r);
    return;
  }
  const push = (s: string): void => {
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  };
  switch (r) {
    case 7: push('\\a'); return;
    case 8: push('\\b'); return;
    case 12: push('\\f'); return;
    case 10: push('\\n'); return;
    case 13: push('\\r'); return;
    case 9: push('\\t'); return;
    case 11: push('\\v'); return;
  }
  if (r < 0x20 || r === 0x7f) {
    push('\\x' + lowerhex[(r >> 4) & 0xf] + lowerhex[r & 0xf]);
    return;
  }
  if (!validRune(r)) r = 0xfffd;
  if (r < 0x10000) {
    push('\\u' + r.toString(16).padStart(4, '0'));
  } else {
    push('\\U' + r.toString(16).padStart(8, '0'));
  }
}

/** strconv.Quote / QuoteToASCII over raw bytes (invalid UTF-8 becomes \xNN). */
export function quoteBytes(s: Bytes, asciiOnly: boolean): number[] {
  const out: number[] = [0x22];
  for (let i = 0; i < s.length; ) {
    const [r, w] = decodeRune(s, i);
    if (w === 1 && r === RUNE_ERROR) {
      const b = s[i] as number;
      out.push(0x5c, 0x78, lowerhex.charCodeAt(b >> 4), lowerhex.charCodeAt(b & 0xf));
      i++;
      continue;
    }
    appendEscapedRune(out, r, 0x22, asciiOnly);
    i += w;
  }
  out.push(0x22);
  return out;
}

/** strconv.QuoteRune / QuoteRuneToASCII. */
export function quoteRune(r: number, asciiOnly: boolean): number[] {
  const out: number[] = [0x27];
  if (!validRune(r)) r = RUNE_ERROR;
  appendEscapedRune(out, r, 0x27, asciiOnly);
  out.push(0x27);
  return out;
}

/** strconv.CanBackquote. */
export function canBackquote(s: Bytes): boolean {
  for (let i = 0; i < s.length; ) {
    const [r, w] = decodeRune(s, i);
    i += w;
    if (w > 1) {
      if (r === 0xfeff) return false;
      continue;
    }
    if (r === RUNE_ERROR) return false;
    if ((r < 0x20 && r !== 0x09) || r === 0x60 || r === 0x7f) return false;
  }
  return true;
}
