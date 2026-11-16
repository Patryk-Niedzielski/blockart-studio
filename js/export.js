// Builds structure files from a quantised image.
import {
  writeNbt, gzip, varintArray, compound, int, short, long, string,
  byteArray, intArray, longArray, list, T,
} from './nbt.js';

/**
 * Turns per-pixel palette indices into a 3D grid description.
 * Wall: stands upright in the X/Y plane (read it facing north).
 * Floor: lies flat in the X/Z plane (top of the image = north).
 */
export function buildStructure(indices, imgW, imgH, blocks, orientation) {
  const used = [...new Set(indices)].filter((v) => v >= 0).sort((a, b) => a - b);
  const names = ['minecraft:air', ...used.map((i) => blocks[i].id)];
  const localOf = new Map(used.map((g, k) => [g, k + 1]));
  const wall = orientation !== 'floor';
  const size = wall ? { x: imgW, y: imgH, z: 1 } : { x: imgW, y: 1, z: imgH };
  const volume = size.x * size.y * size.z;
  const cells = new Uint16Array(volume); // YZX order: index = (y * sizeZ + z) * sizeX + x
  let solid = 0;
  for (let py = 0; py < imgH; py++) {
    for (let px = 0; px < imgW; px++) {
      const v = indices[py * imgW + px];
      if (v < 0) continue;
      const y = wall ? imgH - 1 - py : 0;
      const z = wall ? 0 : py;
      cells[(y * size.z + z) * size.x + px] = localOf.get(v);
      solid++;
    }
  }
  return { names, cells, size, volume, solid, wall };
}

/** Where the structure lands relative to the player on a plain `//paste`. */
export function pasteOffset(s) {
  return s.wall
    ? { x: -Math.floor(s.size.x / 2), y: 0, z: -3 } // wall 3 blocks in front of a north-facing player
    : { x: -Math.floor(s.size.x / 2), y: -1, z: -Math.floor(s.size.z / 2) }; // floor centred under feet
}

const safeName = (n) => (n || 'blockart').replace(/[^\w\- .()]/g, '').trim().slice(0, 64) || 'blockart';

/** Sponge Schematic v2 (.schem) — WorldEdit 7+, FastAsyncWorldEdit, Axiom, Amulet. */
export function schemNbt(s, dataVersion, name) {
  const palette = {};
  s.names.forEach((n, i) => { palette[n] = int(i); });
  const off = pasteOffset(s);
  return writeNbt('Schematic', compound({
    Version: int(2),
    DataVersion: int(dataVersion),
    Metadata: compound({
      Name: string(safeName(name)),
      Author: string('BlockArt Studio'),
      Date: long(Date.now()),
      WEOffsetX: int(off.x), WEOffsetY: int(off.y), WEOffsetZ: int(off.z),
    }),
    Width: short(s.size.x),
    Height: short(s.size.y),
    Length: short(s.size.z),
    Offset: intArray([0, 0, 0]),
    PaletteMax: int(s.names.length),
    Palette: compound(palette),
    BlockData: byteArray(varintArray(s.cells)), // Sponge order x + z*W + y*W*L == our YZX order
    BlockEntities: list(T.COMPOUND, []),
  }));
}

/** Packs values into a Litematica-style tightly packed long array (values may span two longs). */
export function packLitematica(cells, bits) {
  const longs = new BigInt64Array(Math.ceil((cells.length * bits) / 64));
  const tmp = new BigUint64Array(longs.length);
  for (let i = 0; i < cells.length; i++) {
    const v = BigInt(cells[i]);
    if (!v) continue;
    const start = i * bits, a = start >> 6, b = (start + bits - 1) >> 6, off = BigInt(start & 63);
    tmp[a] = BigInt.asUintN(64, tmp[a] | (v << off));
    if (a !== b) tmp[b] |= v >> (64n - off);
  }
  for (let i = 0; i < tmp.length; i++) longs[i] = BigInt.asIntN(64, tmp[i]);
  return longs;
}

/** Litematica (.litematic) — the most popular schematic mod for survival building. */
export function litematicNbt(s, dataVersion, minor, name) {
  const bits = Math.max(2, 32 - Math.clz32(s.names.length - 1));
  const now = Date.now();
  const vec = (v) => compound({ x: int(v.x), y: int(v.y), z: int(v.z) });
  const nm = safeName(name);
  return writeNbt('', compound({
    Version: int(minor >= 16 ? 5 : 4),
    MinecraftDataVersion: int(dataVersion),
    Metadata: compound({
      Name: string(nm),
      Author: string('BlockArt Studio'),
      Description: string('Made with BlockArt Studio'),
      RegionCount: int(1),
      TotalVolume: int(s.volume),
      TotalBlocks: int(s.solid),
      TimeCreated: long(now),
      TimeModified: long(now),
      EnclosingSize: vec(s.size),
    }),
    Regions: compound({
      [nm]: compound({
        Position: vec({ x: 0, y: 0, z: 0 }),
        Size: vec(s.size),
        BlockStatePalette: list(T.COMPOUND, s.names.map((n) => compound({ Name: string(n) }))),
        BlockStates: longArray(packLitematica(s.cells, bits)),
        Entities: list(T.COMPOUND, []),
        TileEntities: list(T.COMPOUND, []),
        PendingBlockTicks: list(T.COMPOUND, []),
        PendingFluidTicks: list(T.COMPOUND, []),
      }),
    }),
  }));
}

export async function toSchem(s, dataVersion, name) {
  return gzip(schemNbt(s, dataVersion, name));
}

export async function toLitematic(s, dataVersion, minor, name) {
  return gzip(litematicNbt(s, dataVersion, minor, name));
}

/** Plain-text shopping list for survival players. */
export function materialList(counts, blocks, prettyName, title) {
  const lines = [`${title}`, ''];
  let total = 0;
  for (const [idx, n] of counts) {
    total += n;
    lines.push(`${prettyName(blocks[idx].name).padEnd(28)} ${String(n).padStart(6)}  (${stacks(n)})`);
  }
  lines.push('', `Total: ${total}`);
  return lines.join('\n');
}

export function stacks(n) {
  const sb = Math.floor(n / 1728), rest = n % 1728, st = Math.floor(rest / 64), one = rest % 64;
  const parts = [];
  if (sb) parts.push(`${sb} SB`);
  if (st) parts.push(`${st}×64`);
  if (one || !parts.length) parts.push(`${one}`);
  return parts.join(' + ');
}
