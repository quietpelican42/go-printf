// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE-go file.

// Port of Go's strconv.FormatFloat (formatting rules and rounding), using exact
// BigInt arithmetic for every non-shortest conversion.

const lowerhex = '0123456789abcdef';
const upperhex = '0123456789ABCDEF';

const scratch = new DataView(new ArrayBuffer(8));

interface Digits {
  d: string; // decimal digits, no trailing zeros, empty for zero
  dp: number; // decimal point position: value = 0.d * 10^dp
}

interface Parts {
  neg: boolean;
  mant: bigint;
  exp: number; // unbiased, Go convention: value = mant * 2^(exp - mantBits)
  mantBits: number;
  special: string | null;
}

function decompose(v: number, bits: 32 | 64): Parts {
  let neg: boolean;
  let exp: number;
  let mant: bigint;
  let expBits: number;
  let mantBits: number;
  let bias: number;
  if (bits === 32) {
    scratch.setFloat32(0, v);
    const b = scratch.getUint32(0);
    neg = b >>> 31 !== 0;
    exp = (b >>> 23) & 0xff;
    mant = BigInt(b & 0x7fffff);
    expBits = 8;
    mantBits = 23;
    bias = -127;
  } else {
    scratch.setFloat64(0, v);
    const b = scratch.getBigUint64(0);
    neg = b >> 63n !== 0n;
    exp = Number((b >> 52n) & 0x7ffn);
    mant = b & ((1n << 52n) - 1n);
    expBits = 11;
    mantBits = 52;
    bias = -1023;
  }
  if (exp === (1 << expBits) - 1) {
    return { neg, mant, exp, mantBits, special: mant !== 0n ? 'NaN' : neg ? '-Inf' : '+Inf' };
  }
  if (exp === 0) exp++;
  else mant |= 1n << BigInt(mantBits);
  exp += bias;
  return { neg, mant, exp, mantBits, special: null };
}

function trimZeros(d: string): string {
  let n = d.length;
  while (n > 0 && d.charCodeAt(n - 1) === 48) n--;
  return n === d.length ? d : d.slice(0, n);
}

/** Exact decimal expansion of mant * 2^e2. */
function exactDigits(mant: bigint, e2: number): Digits {
  if (mant === 0n) return { d: '', dp: 0 };
  let s: string;
  let dp: number;
  if (e2 >= 0) {
    s = (mant << BigInt(e2)).toString();
    dp = s.length;
  } else {
    const k = -e2;
    s = (mant * 5n ** BigInt(k)).toString();
    dp = s.length - k;
  }
  return { d: trimZeros(s), dp };
}

/** Go's decimal.Round(nd): round half to even on the exact digits. */
function roundDigits(x: Digits, nd: number): Digits {
  const { d, dp } = x;
  if (nd < 0 || nd >= d.length) return x;
  const c = d.charCodeAt(nd);
  let up: boolean;
  if (c === 53 && nd + 1 === d.length) {
    up = nd > 0 && (d.charCodeAt(nd - 1) - 48) % 2 !== 0;
  } else {
    up = c >= 53;
  }
  if (!up) {
    const t = trimZeros(d.slice(0, nd));
    return { d: t, dp: t.length === 0 ? 0 : dp };
  }
  for (let i = nd - 1; i >= 0; i--) {
    if (d.charCodeAt(i) < 57) {
      return { d: d.slice(0, i) + String.fromCharCode(d.charCodeAt(i) + 1), dp };
    }
  }
  return { d: '1', dp: dp + 1 };
}

function shortest64(v: number): Digits {
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(v.toExponential());
  if (!m) throw new Error('unreachable');
  return { d: trimZeros((m[1] as string) + (m[2] ?? '')), dp: Number(m[3]) + 1 };
}

function shortest32(v: number, p: Parts): Digits {
  const exact = exactDigits(p.mant, p.exp - p.mantBits);
  for (let n = 1; n <= 9; n++) {
    const r = roundDigits(exact, n);
    const cands = [r];
    // The rounding interval is asymmetric at powers of two, so a neighbour of the
    // correctly rounded n-digit value can be the only one that round-trips.
    if (r.d.length > 0) {
      const base = BigInt(r.d.padEnd(n, '0'));
      for (const delta of [1n, -1n]) {
        const nb = base + delta;
        if (nb <= 0n) continue;
        let s = nb.toString();
        let dp = r.dp;
        if (s.length > n) dp += s.length - n;
        else if (s.length < n) dp -= n - s.length;
        s = trimZeros(s);
        cands.push({ d: s, dp });
      }
    }
    let best: Digits | null = null;
    let bestDist = 0n;
    for (const c of cands) {
      if (c.d.length === 0) continue;
      const back = Math.fround(Number(`0.${c.d}e${c.dp}`));
      if (back !== Math.abs(v)) continue;
      // distance to the exact value, scaled
      const dist = digitsDistance(c, exact);
      if (best === null || dist < bestDist) {
        best = c;
        bestDist = dist;
      }
    }
    if (best !== null) return best;
  }
  return roundDigits(exact, 9);
}

function digitsDistance(a: Digits, b: Digits): bigint {
  const ea = a.dp - a.d.length;
  const eb = b.dp - b.d.length;
  const e = Math.min(ea, eb);
  const av = BigInt(a.d) * 10n ** BigInt(ea - e);
  const bv = BigInt(b.d) * 10n ** BigInt(eb - e);
  return av > bv ? av - bv : bv - av;
}

function fmtEFG(neg: boolean, s: string, dp: number, prec: number, fmt: string, shortest: boolean): string {
  const nd = s.length;
  if (fmt === 'g' || fmt === 'G') {
    let eprec = prec;
    if (eprec > nd && nd >= dp) eprec = nd;
    if (shortest) eprec = 6;
    const exp = dp - 1;
    if (exp < -4 || exp >= eprec) {
      if (prec > nd) prec = nd;
      prec--;
      fmt = fmt === 'g' ? 'e' : 'E';
    } else {
      if (prec > dp) prec = nd;
      prec = Math.max(prec - dp, 0);
      fmt = 'f';
    }
  }
  let out = neg ? '-' : '';
  if (fmt === 'e' || fmt === 'E') {
    out += nd !== 0 ? s[0] : '0';
    if (prec > 0) {
      out += '.';
      let i = 1;
      const m = Math.min(nd, prec + 1);
      if (i < m) {
        out += s.slice(i, m);
        i = m;
      }
      out += '0'.repeat(prec + 1 - i);
    }
    out += fmt;
    let exp = dp - 1;
    if (nd === 0) exp = 0;
    let sign = '+';
    if (exp < 0) {
      sign = '-';
      exp = -exp;
    }
    out += sign + (exp < 10 ? '0' + exp : String(exp));
    return out;
  }
  if (fmt === 'f') {
    if (dp > 0) {
      const m = Math.min(nd, dp);
      out += s.slice(0, m) + '0'.repeat(dp - m);
    } else {
      out += '0';
    }
    if (prec > 0) {
      out += '.';
      const lz = Math.min(prec, Math.max(0, -dp));
      const off = dp + lz;
      const m = Math.min(prec - lz, Math.max(0, nd - off));
      const tz = Math.max(0, prec - lz - m);
      out += '0'.repeat(lz) + s.slice(off, off + m) + '0'.repeat(tz);
    }
    return out;
  }
  return '%' + fmt;
}

function fmtB(neg: boolean, mant: bigint, exp: number): string {
  return (neg ? '-' : '') + mant.toString() + 'p' + (exp >= 0 ? '+' : '') + exp;
}

const M64 = (1n << 64n) - 1n;

function fmtX(prec: number, fmt: string, neg: boolean, mant: bigint, exp: number, mantBits: number): string {
  if (mant === 0n) exp = 0;
  mant = (mant << BigInt(60 - mantBits)) & M64;
  while (mant !== 0n && (mant & (1n << 60n)) === 0n) {
    mant = (mant << 1n) & M64;
    exp--;
  }
  if (prec >= 0 && prec < 15) {
    const shift = BigInt(prec * 4);
    const extra = (mant << shift) & ((1n << 60n) - 1n);
    mant >>= 60n - shift;
    if ((extra | (mant & 1n)) > 1n << 59n) mant++;
    mant = (mant << (60n - shift)) & M64;
    if ((mant & (1n << 61n)) !== 0n) {
      mant >>= 1n;
      exp++;
    }
  }
  const hex = fmt === 'X' ? upperhex : lowerhex;
  let out = (neg ? '-' : '') + '0' + fmt + String((mant >> 60n) & 1n);
  mant = (mant << 4n) & M64;
  if (prec < 0 && mant !== 0n) {
    out += '.';
    while (mant !== 0n) {
      out += hex[Number((mant >> 60n) & 15n)];
      mant = (mant << 4n) & M64;
    }
  } else if (prec > 0) {
    out += '.';
    for (let i = 0; i < prec; i++) {
      out += hex[Number((mant >> 60n) & 15n)];
      mant = (mant << 4n) & M64;
    }
  }
  out += fmt === 'X' ? 'P' : 'p';
  let sign = '+';
  if (exp < 0) {
    sign = '-';
    exp = -exp;
  }
  out += sign + (exp < 100 ? String(exp).padStart(2, '0') : String(exp));
  return out;
}

/**
 * strconv.FormatFloat(v, fmt, prec, bits) for fmt in b, e, E, f, g, G, x, X.
 * For bits 32 the value is first rounded to float32.
 */
export function formatFloat(v: number, fmt: string, prec: number, bits: 32 | 64): string {
  if (bits === 32) v = Math.fround(v);
  const p = decompose(v, bits);
  if (p.special !== null) return p.special;
  const { neg, mant, exp, mantBits } = p;
  if (fmt === 'b') return fmtB(neg, mant, exp - mantBits);
  if (fmt === 'x' || fmt === 'X') return fmtX(prec, fmt, neg, mant, exp, mantBits);
  if (mant === 0n) return fmtEFG(neg, '', 0, prec, fmt, prec < 0);
  if (prec < 0) {
    const dg = bits === 32 ? shortest32(v, p) : shortest64(Math.abs(v));
    const nd = dg.d.length;
    switch (fmt) {
      case 'e':
      case 'E':
        prec = Math.max(nd - 1, 0);
        break;
      case 'f':
        prec = Math.max(nd - dg.dp, 0);
        break;
      case 'g':
      case 'G':
        prec = nd;
        break;
    }
    return fmtEFG(neg, dg.d, dg.dp, prec, fmt, true);
  }
  let dg = exactDigits(mant, exp - mantBits);
  switch (fmt) {
    case 'e':
    case 'E':
      dg = roundDigits(dg, prec + 1);
      break;
    case 'f':
      dg = roundDigits(dg, dg.dp + prec);
      break;
    case 'g':
    case 'G':
      if (prec === 0) prec = 1;
      dg = roundDigits(dg, prec);
      break;
  }
  return fmtEFG(neg, dg.d, dg.dp, prec, fmt, false);
}
