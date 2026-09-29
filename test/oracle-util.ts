import { spawnSync } from 'node:child_process';
import { sprintfBytes } from '../src/index.ts';
import * as g from '../src/index.ts';

/** One differential case, as written by scripts/oracle (see its header for the encoding). */
export interface OracleCase {
  f?: string;
  fb?: string;
  a: { t: string; v?: unknown }[];
  o?: string;
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

function scalar(t: string, v: unknown, bare: boolean): unknown {
  switch (t) {
    case 'int':
    case 'int8':
    case 'int16':
    case 'int32':
    case 'int64':
    case 'uint':
    case 'uint8':
    case 'uint16':
    case 'uint32':
    case 'uint64':
    case 'uintptr': {
      const n = BigInt(v as string);
      if (bare && t === 'int' && BigInt(Number(n)) === n && Math.abs(Number(n)) < 2 ** 63) return Number(n);
      if (bare && t === 'int64') return n;
      return (g as unknown as Record<string, (n: bigint) => unknown>)[t]!(n);
    }
    case 'float64':
    case 'float32': {
      const dv = new DataView(new ArrayBuffer(8));
      let x: number;
      if (t === 'float64') {
        dv.setBigUint64(0, BigInt('0x' + (v as string)));
        x = dv.getFloat64(0);
        if (bare && !(Number.isInteger(x) && Math.abs(x) < 2 ** 63 && !Object.is(x, -0))) return x;
        return g.float64(x);
      }
      dv.setUint32(0, Number.parseInt(v as string, 16));
      x = dv.getFloat32(0);
      return g.float32(x);
    }
    case 'string': {
      const b = b64(v as string);
      if (bare) {
        try {
          return strictUtf8.decode(b);
        } catch {
          /* fall through */
        }
      }
      return g.gostring(b);
    }
    case 'bytes':
      return b64(v as string);
    case 'bool':
      return v as boolean;
  }
  throw new Error(`unknown type ${t}`);
}

export function decodeCase(c: OracleCase, i: number): { format: string | Uint8Array; args: unknown[] } {
  const bare = i % 2 === 0;
  const args = c.a.map((a) => {
    if (a.t === 'nil') return i % 3 === 0 ? undefined : null;
    if (a.t.startsWith('[]')) return (a.v as unknown[]).map((e) => scalar(a.t.slice(2), e, bare));
    return scalar(a.t, a.v, bare);
  });
  return { format: c.f !== undefined ? c.f : b64(c.fb as string), args };
}

export interface Mismatch {
  i: number;
  format: string;
  args: string;
  want: string;
  got: string;
}

const show = (b: Uint8Array): string => JSON.stringify(Buffer.from(b).toString('latin1'));

/** Runs cases through sprintfBytes and returns the mismatches against the recorded Go output. */
export function check(cases: OracleCase[]): Mismatch[] {
  const bad: Mismatch[] = [];
  cases.forEach((c, i) => {
    const { format, args } = decodeCase(c, i);
    const want = b64(c.o as string);
    let got: Uint8Array;
    try {
      got = sprintfBytes(format, ...args);
    } catch (e) {
      got = new TextEncoder().encode('THROW ' + String(e));
    }
    if (Buffer.compare(want, got) !== 0) {
      bad.push({
        i,
        format: typeof format === 'string' ? format : show(format),
        args: JSON.stringify(c.a),
        want: show(want),
        got: show(got),
      });
    }
  });
  return bad;
}

export function parseNdjson(text: string): OracleCase[] {
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as OracleCase);
}

export function haveGo(): boolean {
  return spawnSync('go', ['version'], { timeout: 20000 }).status === 0;
}

/** Streams `go run ./scripts/oracle <args>` output as parsed cases. */
export function oracle(args: string[], input?: string): OracleCase[] {
  const r = spawnSync('go', ['run', '.', ...args], {
    cwd: new URL('../scripts/oracle/', import.meta.url),
    input,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    timeout: 300000,
  });
  if (r.status !== 0) throw new Error(`oracle failed: ${r.stderr}`);
  return parseNdjson(r.stdout);
}
