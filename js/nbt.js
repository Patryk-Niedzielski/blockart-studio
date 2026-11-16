// Minimal big-endian NBT writer (Java Edition) + gzip helper.

export const T = {
  END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6,
  BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12,
};

// Tagged value constructors.
export const byte = (v) => ({ t: T.BYTE, v });
export const short = (v) => ({ t: T.SHORT, v });
export const int = (v) => ({ t: T.INT, v });
export const long = (v) => ({ t: T.LONG, v: BigInt(v) });
export const string = (v) => ({ t: T.STRING, v: String(v) });
export const byteArray = (v) => ({ t: T.BYTE_ARRAY, v });
export const intArray = (v) => ({ t: T.INT_ARRAY, v });
export const longArray = (v) => ({ t: T.LONG_ARRAY, v });
export const list = (itemType, v) => ({ t: T.LIST, itemType, v });
export const compound = (v) => ({ t: T.COMPOUND, v });

class Writer {
  constructor() { this.buf = new Uint8Array(1 << 16); this.view = new DataView(this.buf.buffer); this.n = 0; }
  ensure(k) {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const nb = new Uint8Array(size); nb.set(this.buf.subarray(0, this.n));
    this.buf = nb; this.view = new DataView(nb.buffer);
  }
  u8(v) { this.ensure(1); this.view.setInt8(this.n, v); this.n += 1; }
  i16(v) { this.ensure(2); this.view.setInt16(this.n, v); this.n += 2; }
  i32(v) { this.ensure(4); this.view.setInt32(this.n, v); this.n += 4; }
  i64(v) { this.ensure(8); this.view.setBigInt64(this.n, BigInt.asIntN(64, v)); this.n += 8; }
  bytes(arr) { this.ensure(arr.length); this.buf.set(arr, this.n); this.n += arr.length; }
  str(s) {
    const b = new TextEncoder().encode(s); // modified UTF-8 == UTF-8 for BMP chars without NUL
    this.i16(b.length); this.bytes(b);
  }
  result() { return this.buf.slice(0, this.n); }
}

function payload(w, tag) {
  const { t, v } = tag;
  switch (t) {
    case T.BYTE: w.u8(v); break;
    case T.SHORT: w.i16(v); break;
    case T.INT: w.i32(v); break;
    case T.LONG: w.i64(v); break;
    case T.STRING: w.str(v); break;
    case T.BYTE_ARRAY: w.i32(v.length); w.bytes(new Uint8Array(v.buffer, v.byteOffset, v.length)); break;
    case T.INT_ARRAY: w.i32(v.length); for (const x of v) w.i32(x); break;
    case T.LONG_ARRAY: w.i32(v.length); for (const x of v) w.i64(x); break;
    case T.LIST:
      w.u8(v.length ? tag.itemType : T.END); w.i32(v.length);
      for (const item of v) payload(w, item.t === undefined ? { t: tag.itemType, v: item } : item);
      break;
    case T.COMPOUND:
      for (const [name, child] of Object.entries(v)) { w.u8(child.t); w.str(name); payload(w, child); }
      w.u8(T.END);
      break;
    default: throw new Error(`Unsupported NBT tag ${t}`);
  }
}

/** Serialises a named root compound. */
export function writeNbt(rootName, rootCompound) {
  const w = new Writer();
  w.u8(T.COMPOUND); w.str(rootName); payload(w, rootCompound);
  return w.result();
}

/** Encodes non-negative ints as unsigned LEB128 varints (Sponge BlockData). */
export function varintArray(values) {
  const out = [];
  for (let v of values) {
    while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v);
  }
  return Uint8Array.from(out);
}

// ---------------- gzip ----------------

let CRC_TABLE;
export function crc32(data) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Valid gzip using uncompressed ("stored") deflate blocks – fallback for old browsers. */
export function gzipStored(data) {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(10 + data.length + blocks * 5 + 8);
  out.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255]);
  let o = 10;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535, len = Math.min(65535, data.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff; out[o++] = len >>> 8;
    out[o++] = ~len & 0xff; out[o++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), o); o += len;
  }
  const dv = new DataView(out.buffer);
  dv.setUint32(o, crc32(data), true); dv.setUint32(o + 4, data.length >>> 0, true);
  return out;
}

export async function gzip(data) {
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { /* fall through */ }
  }
  return gzipStored(data);
}
