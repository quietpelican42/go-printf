// Explicit Go-typed values. JS numbers carry no int/float/width, so callers wrap
// them when the default mapping (see README) is not what Go would have.

export type IntKind =
  | 'int' | 'int8' | 'int16' | 'int32' | 'int64'
  | 'uint' | 'uint8' | 'uint16' | 'uint32' | 'uint64' | 'uintptr';

const widths: Record<IntKind, number> = {
  int: 64, int8: 8, int16: 16, int32: 32, int64: 64,
  uint: 64, uint8: 8, uint16: 16, uint32: 32, uint64: 64, uintptr: 64,
};

/** A Go integer of a specific type. Build with int(), int64(), uint8(), rune() and friends. */
export class GoInt {
  readonly kind: IntKind;
  /** The value after Go-style wrap-around to the kind's width. */
  readonly value: bigint;
  constructor(kind: IntKind, n: number | bigint) {
    let b: bigint;
    if (typeof n === 'bigint') b = n;
    else if (Number.isInteger(n)) b = BigInt(n);
    else throw new TypeError(`${kind}(${String(n)}): not an integer`);
    this.kind = kind;
    this.value = kind.startsWith('u') ? BigInt.asUintN(widths[kind], b) : BigInt.asIntN(widths[kind], b);
  }
  get signed(): boolean {
    return this.kind.charCodeAt(0) === 105; // 'i'
  }
}

/** A Go float32 or float64. Build with float32() and float64(). */
export class GoFloat {
  readonly bits: 32 | 64;
  readonly value: number;
  constructor(bits: 32 | 64, n: number) {
    if (typeof n !== 'number') throw new TypeError(`float${bits}: expected a number`);
    this.bits = bits;
    this.value = bits === 32 ? Math.fround(n) : n;
  }
}

/** A Go string given as raw bytes, for text that is not valid UTF-8. */
export class GoString {
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
}

type N = number | bigint;
export const int = (n: N): GoInt => new GoInt('int', n);
export const int8 = (n: N): GoInt => new GoInt('int8', n);
export const int16 = (n: N): GoInt => new GoInt('int16', n);
export const int32 = (n: N): GoInt => new GoInt('int32', n);
export const int64 = (n: N): GoInt => new GoInt('int64', n);
export const uint = (n: N): GoInt => new GoInt('uint', n);
export const uint8 = (n: N): GoInt => new GoInt('uint8', n);
export const uint16 = (n: N): GoInt => new GoInt('uint16', n);
export const uint32 = (n: N): GoInt => new GoInt('uint32', n);
export const uint64 = (n: N): GoInt => new GoInt('uint64', n);
export const uintptr = (n: N): GoInt => new GoInt('uintptr', n);
/** Go rune (an alias of int32). */
export const rune = (n: N): GoInt => new GoInt('int32', n);
/** Go byte (an alias of uint8). */
export const byte = (n: N): GoInt => new GoInt('uint8', n);
export const float64 = (n: number): GoFloat => new GoFloat(64, n);
export const float32 = (n: number): GoFloat => new GoFloat(32, n);
/** A Go string from raw bytes; formats like string, including invalid UTF-8. */
export const gostring = (bytes: Uint8Array): GoString => new GoString(bytes);
