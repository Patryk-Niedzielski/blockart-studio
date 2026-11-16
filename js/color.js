// Colour science + image → block-index conversion. Pure functions, no DOM.

const srgbToLinear = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** sRGB 0-255 → OKLab (perceptually uniform, so Euclidean distance ≈ visual difference). */
export function rgbToOklab(r, g, b) {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Builds a nearest-colour matcher over a palette of [r,g,b] with a memo cache. */
export function createMatcher(paletteRgb) {
  const labs = paletteRgb.map(([r, g, b]) => rgbToOklab(r, g, b));
  const n = labs.length;
  const L = new Float64Array(n), A = new Float64Array(n), B = new Float64Array(n);
  labs.forEach(([l, a, b], i) => { L[i] = l; A[i] = a; B[i] = b; });
  const cache = new Map();
  return function match(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    let best = cache.get(key);
    if (best !== undefined) return best;
    const [l, a, bb] = rgbToOklab(r, g, b);
    let bestD = Infinity;
    best = 0;
    for (let i = 0; i < n; i++) {
      const dl = L[i] - l, da = A[i] - a, db = B[i] - bb;
      const d = dl * dl + da * da + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    cache.set(key, best);
    return best;
  };
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Brightness/contrast (-100..100) and saturation (0..200 %) applied in place to RGBA floats. */
export function adjust(buf, { brightness = 0, contrast = 0, saturation = 100 }) {
  if (!brightness && !contrast && saturation === 100) return;
  const bOff = brightness * 1.28;
  const cf = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  const sf = saturation / 100;
  for (let i = 0; i < buf.length; i += 4) {
    let r = buf[i], g = buf[i + 1], b = buf[i + 2];
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    r = grey + (r - grey) * sf; g = grey + (g - grey) * sf; b = grey + (b - grey) * sf;
    r = cf * (r - 128) + 128 + bOff; g = cf * (g - 128) + 128 + bOff; b = cf * (b - 128) + 128 + bOff;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
  }
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

const KERNELS = {
  floyd: { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
};

/**
 * Converts RGBA pixels into palette indices.
 * @param {Uint8ClampedArray} rgba  width*height*4
 * @param {object} o  { width, height, palette: [[r,g,b]], dither: 'none'|'floyd'|'atkinson'|'ordered',
 *                     strength 0..1, alphaThreshold, brightness, contrast, saturation }
 * @returns {Int16Array} index per pixel, -1 = transparent (air)
 */
export function quantize(rgba, o) {
  const { width: w, height: h, palette } = o;
  const dither = o.dither || 'none';
  const strength = o.strength ?? 1;
  const alphaThreshold = o.alphaThreshold ?? 128;
  const buf = Float32Array.from(rgba);
  adjust(buf, o);
  const match = createMatcher(palette);
  const out = new Int16Array(w * h);
  const kernel = KERNELS[dither];

  for (let y = 0; y < h; y++) {
    // Serpentine scan: alternate direction each row to avoid directional artefacts.
    const rev = kernel && (y & 1);
    for (let k = 0; k < w; k++) {
      const x = rev ? w - 1 - k : k;
      const p = y * w + x, i = p * 4;
      if (rgba[i + 3] < alphaThreshold) { out[p] = -1; continue; }
      let r = buf[i], g = buf[i + 1], b = buf[i + 2];
      if (dither === 'ordered') {
        const t = BAYER4[(y & 3) * 4 + (x & 3)] * 64 * strength;
        r += t; g += t; b += t;
      }
      const idx = match(clamp255(r), clamp255(g), clamp255(b));
      out[p] = idx;
      if (!kernel || strength <= 0) continue;
      const c = palette[idx];
      const er = (clamp255(r) - c[0]) * strength;
      const eg = (clamp255(g) - c[1]) * strength;
      const eb = (clamp255(b) - c[2]) * strength;
      for (const [dx0, dy, wgt] of kernel.taps) {
        const dx = rev ? -dx0 : dx0;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 4;
        if (rgba[j + 3] < alphaThreshold) continue;
        const f = wgt / kernel.div;
        buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
      }
    }
  }
  return out;
}

/** Counts how many of each palette index are used. Returns [[index, count]] sorted desc. */
export function countBlocks(indices) {
  const m = new Map();
  for (const v of indices) if (v >= 0) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
