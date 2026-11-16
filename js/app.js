import { BLOCKS, CATEGORIES, VERSIONS, prettyName } from './blocks.js';
import { quantize, countBlocks } from './color.js';
import { buildStructure, toSchem, toLitematic, materialList, stacks } from './export.js';
import { STRINGS, detectLang } from './i18n.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const MAX = 512;
const ZOOMS = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
const STORE_KEY = 'ba-settings-v1';

// ---------------------------------------------------------------- state
const defaults = {
  width: 128, lock: true, orientation: 'wall', version: '1.20.x',
  dither: 'floyd', strength: 60, brightness: 0, contrast: 0, saturation: 100,
  grid: false, shading: true,
  enabled: BLOCKS.filter((b) => CATEGORIES.find((c) => c.id === b.category).default).map((b) => b.id),
};
const S = { ...defaults, ...load(), lang: detectLang(), height: 0, zoom: 0, view: 'blocks' };
let enabled = new Set(S.enabled);
let source = null;       // { bitmap, name, w, h }
let result = null;       // { w, h, indices, blocks, counts, solid }
let resized = null;      // canvas with resized source pixels
let blocksCanvas = null; // 1px-per-block render
let jobId = 0;
let worker = null;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function save() {
  const { width, prefWidth, lock, orientation, version, dither, strength, brightness, contrast, saturation, grid, shading } = S;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      width, prefWidth, lock, orientation, version, dither, strength, brightness, contrast, saturation, grid, shading,
      enabled: [...enabled],
    }));
  } catch { /* private mode */ }
}

const t = (k) => STRINGS[S.lang][k] ?? STRINGS.en[k] ?? k;
const versionInfo = () => VERSIONS.find((v) => v.label === S.version) || VERSIONS[1];
const activeBlocks = () => {
  const minor = versionInfo().minor;
  return BLOCKS.filter((b) => enabled.has(b.id) && b.since <= minor);
};
const fmt = (n) => n.toLocaleString(S.lang === 'pl' ? 'pl-PL' : 'en-US');
const rgbCss = ([r, g, b]) => `rgb(${r},${g},${b})`;

// ---------------------------------------------------------------- i18n
function applyLang() {
  document.documentElement.lang = S.lang;
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang)));
  $('#howtoWe').innerHTML = t('howto_we').map((s) => `<li>${s}</li>`).join('');
  $('#howtoLm').innerHTML = t('howto_lm').map((s) => `<li>${s}</li>`).join('');
  renderCategories();
  syncControls();
  if (result) renderStats();
}

// ---------------------------------------------------------------- controls
function syncControls() {
  $('#width').value = S.width;
  $('#widthRange').value = S.width;
  $('#height').value = S.height || '';
  $('#lockRatio').checked = S.lock;
  $$('#orientation button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === S.orientation)));
  $$('#viewMode button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === S.view)));
  $('#orientationHint').textContent = t(S.orientation === 'wall' ? 'wall_hint' : 'floor_hint');
  $('#version').value = S.version;
  $('#dither').value = S.dither;
  $('#strengthRow').hidden = S.dither === 'none';
  for (const id of ['strength', 'brightness', 'contrast', 'saturation']) {
    const el = $('#' + id);
    el.value = S[id];
    el.nextElementSibling.value = id === 'strength' || id === 'saturation' ? `${S[id]}%` : S[id] > 0 ? `+${S[id]}` : S[id];
  }
  $('#showGrid').checked = S.grid;
  $('#showShading').checked = S.shading;
  const minor = versionInfo().minor;
  $('#gravityWarn').hidden = !(S.orientation === 'wall' && BLOCKS.some((b) => b.gravity && enabled.has(b.id) && b.since <= minor));
}

function renderCategories() {
  const minor = versionInfo().minor;
  $('#categories').innerHTML = CATEGORIES.map((c) => {
    const inCat = BLOCKS.filter((b) => b.category === c.id && b.since <= minor);
    const on = inCat.filter((b) => enabled.has(b.id)).length;
    const dots = inCat.filter((_, i) => i % Math.max(1, Math.floor(inCat.length / 4)) === 0).slice(0, 4)
      .map((b) => `<i style="background:${rgbCss(b.rgb)}"></i>`).join('');
    return `<button class="chip${on && on < inCat.length ? ' partial' : ''}" data-cat="${c.id}" aria-pressed="${on > 0}">
      <span class="dots">${dots}</span>${t('cat_' + c.id)}</button>`;
  }).join('');
  renderBlockGrid();
}

function renderBlockGrid() {
  const q = $('#blockSearch').value.trim().toLowerCase().replace(/\s+/g, '_');
  const minor = versionInfo().minor;
  $('#blockGrid').innerHTML = BLOCKS
    .filter((b) => b.since <= minor && (!q || b.name.includes(q)))
    .map((b) => `<button data-id="${b.id}" aria-pressed="${enabled.has(b.id)}" title="${prettyName(b.name)}"
      aria-label="${prettyName(b.name)}" style="background:${rgbCss(b.rgb)}"></button>`).join('');
}

function setWidth(w, fromHeight = false) {
  if (!source) { S.width = clamp(w, 4, MAX); return; }
  const ratio = source.h / source.w;
  if (fromHeight) {
    S.height = clamp(w, 4, MAX);
    if (S.lock) S.width = clamp(Math.round(S.height / ratio), 1, MAX);
  } else {
    S.width = clamp(w, 4, MAX);
    if (S.lock) S.height = clamp(Math.round(S.width * ratio), 1, MAX);
  }
  if (S.lock) { // keep both within limits while preserving the ratio
    if (S.height >= MAX && S.width * ratio > MAX) S.width = Math.max(1, Math.round(MAX / ratio));
    if (S.width >= MAX && S.height / ratio > MAX) S.height = Math.max(1, Math.round(MAX * ratio));
  }
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, Math.round(Number(v) || a)));

function bindControls() {
  const onSize = (fromHeight) => (e) => { setWidth(e.target.value, fromHeight); S.prefWidth = S.width; syncControls(); schedule(true); };
  $('#width').addEventListener('change', onSize(false));
  $('#height').addEventListener('change', onSize(true));
  $('#widthRange').addEventListener('input', onSize(false));
  $('#lockRatio').addEventListener('change', (e) => { S.lock = e.target.checked; setWidth(S.width); syncControls(); schedule(true); });

  $('#orientation').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.orientation = b.dataset.value; syncControls(); save(); if (result) renderStats();
  });
  $('#viewMode').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.view = b.dataset.value; syncControls(); draw();
  });
  $('#version').innerHTML = VERSIONS.map((v) => `<option>${v.label}</option>`).join('');
  $('#version').addEventListener('change', (e) => { S.version = e.target.value; renderCategories(); syncControls(); schedule(); });
  $('#dither').addEventListener('change', (e) => { S.dither = e.target.value; syncControls(); schedule(); });
  for (const id of ['strength', 'brightness', 'contrast', 'saturation']) {
    $('#' + id).addEventListener('input', (e) => { S[id] = Number(e.target.value); syncControls(); schedule(); });
  }
  $('#resetAdjust').addEventListener('click', () => {
    Object.assign(S, { brightness: 0, contrast: 0, saturation: 100, strength: defaults.strength });
    syncControls(); schedule();
  });

  $('#categories').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const minor = versionInfo().minor;
    const inCat = BLOCKS.filter((x) => x.category === b.dataset.cat && x.since <= minor);
    const allOn = inCat.every((x) => enabled.has(x.id));
    inCat.forEach((x) => (allOn ? enabled.delete(x.id) : enabled.add(x.id)));
    renderCategories(); syncControls(); schedule();
  });
  $('#blockGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    enabled.has(b.dataset.id) ? enabled.delete(b.dataset.id) : enabled.add(b.dataset.id);
    renderCategories(); syncControls(); schedule();
  });
  $('#blockSearch').addEventListener('input', renderBlockGrid);
  $('#allBlocks').addEventListener('click', () => { BLOCKS.forEach((b) => enabled.add(b.id)); renderCategories(); syncControls(); schedule(); });
  $('#noBlocks').addEventListener('click', () => { enabled.clear(); renderCategories(); syncControls(); schedule(); });

  $('#showGrid').addEventListener('change', (e) => { S.grid = e.target.checked; save(); draw(); });
  $('#showShading').addEventListener('change', (e) => { S.shading = e.target.checked; save(); draw(); });
  $('#zoomIn').addEventListener('click', () => stepZoom(1));
  $('#zoomOut').addEventListener('click', () => stepZoom(-1));
  $('#zoomFit').addEventListener('click', () => { S.zoom = 0; draw(); });

  $$('.lang button').forEach((b) => b.addEventListener('click', () => {
    S.lang = b.dataset.lang;
    try { localStorage.setItem('ba-lang', S.lang); } catch { /* ignore */ }
    applyLang();
  }));

  $('#dlSchem').addEventListener('click', () => download('schem'));
  $('#dlLitematic').addEventListener('click', () => download('litematic'));
  $('#dlPng').addEventListener('click', () => download('png'));
  $('#dlList').addEventListener('click', () => download('txt'));
  $('#copyList').addEventListener('click', copyList);
}

// ---------------------------------------------------------------- image input
function bindInput() {
  const input = $('#fileInput');
  const open = () => input.click();
  $('#dropzone').addEventListener('click', (e) => { if (!e.target.closest('#sampleBtn')) open(); });
  $('#dropzone').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  $('#changeBtn').addEventListener('click', open);
  $('#sampleBtn').addEventListener('click', (e) => { e.stopPropagation(); loadSample(); });
  input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); input.value = ''; });

  let depth = 0;
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    depth = 0; document.body.classList.remove('dragging');
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); loadFile(f); }
  });
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); loadFile(item.getAsFile(), 'pasted'); }
  });
}
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

async function loadFile(file, fallbackName = 'image') {
  try {
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch {
      bitmap = await new Promise((res, rej) => {
        const img = new Image(); const url = URL.createObjectURL(file);
        img.onload = () => { URL.revokeObjectURL(url); res(img); };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
        img.src = url;
      });
    }
    const name = (file.name || fallbackName).replace(/\.[^.]+$/, '');
    setSource(bitmap, name);
  } catch {
    toast(t('load_error'));
  }
}

function setSource(bitmap, name) {
  const w = bitmap.width || bitmap.naturalWidth, h = bitmap.height || bitmap.naturalHeight;
  if (!w || !h) { toast(t('load_error')); return; }
  source = { bitmap, name, w, h };
  setWidth(Math.min(S.prefWidth || defaults.width, w, MAX));
  S.zoom = 0;
  $('#dropzone').hidden = true;
  $('#workspace').hidden = false;
  $('#changeCard').hidden = false;
  syncControls();
  schedule(true);
}

function loadSample() {
  const c = document.createElement('canvas'); c.width = 480; c.height = 300;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 190);
  sky.addColorStop(0, '#1d2b64'); sky.addColorStop(0.45, '#7b4397'); sky.addColorStop(0.8, '#f8865a'); sky.addColorStop(1, '#ffd36e');
  g.fillStyle = sky; g.fillRect(0, 0, 480, 200);
  g.fillStyle = 'rgba(255,255,255,.85)';
  for (let i = 0; i < 40; i++) { const x = (i * 97) % 480, y = (i * 53) % 90; g.fillRect(x, y, 2, 2); }
  const sun = g.createRadialGradient(240, 175, 5, 240, 175, 70);
  sun.addColorStop(0, '#fff6c8'); sun.addColorStop(0.35, '#ffcf5a'); sun.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = sun; g.beginPath(); g.arc(240, 175, 70, 0, Math.PI * 2); g.fill();
  const ridge = (base, amp, seed, color) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, 300);
    for (let x = 0; x <= 480; x += 4) g.lineTo(x, base - Math.abs(Math.sin(x / 55 + seed)) * amp - Math.sin(x / 17 + seed * 3) * amp * 0.15);
    g.lineTo(480, 300); g.fill();
  };
  ridge(190, 70, 1.3, '#5b3a6e'); ridge(205, 50, 4.1, '#3b2752'); ridge(220, 30, 2.2, '#22183a');
  const sea = g.createLinearGradient(0, 220, 0, 300);
  sea.addColorStop(0, '#f39c6b'); sea.addColorStop(1, '#1b2050');
  g.fillStyle = sea; g.fillRect(0, 222, 480, 78);
  g.fillStyle = 'rgba(255,230,160,.55)';
  for (let y = 228; y < 300; y += 6) { const w = 70 - (y - 228) * 0.6; g.fillRect(240 - w / 2 + Math.sin(y) * 6, y, w, 2); }
  g.fillStyle = '#120c20';
  for (const [x, s] of [[40, 1], [70, 0.7], [420, 1.1], [450, 0.8]]) {
    g.fillRect(x - 2 * s, 222 - 40 * s, 4 * s, 40 * s);
    g.beginPath(); g.moveTo(x, 222 - 85 * s); g.lineTo(x - 18 * s, 222 - 25 * s); g.lineTo(x + 18 * s, 222 - 25 * s); g.fill();
  }
  setSource(c, 'sunset');
}

// ---------------------------------------------------------------- processing
let timer = 0;
function schedule(resize = false) {
  save();
  if (!source) return;
  if (resize) resized = null;
  clearTimeout(timer);
  timer = setTimeout(process, 90);
}

/** High-quality downscale: halve repeatedly, then one final smooth draw. */
function resizeSource(w, h) {
  let src = source.bitmap, sw = source.w, sh = source.h;
  while (sw / 2 >= w * 1.5 && sh / 2 >= h * 1.5) {
    const c = document.createElement('canvas'); c.width = Math.ceil(sw / 2); c.height = Math.ceil(sh / 2);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
    src = c; sw = c.width; sh = c.height;
  }
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const g = out.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = w < sw || h < sh; g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return out;
}

function process() {
  const blocks = activeBlocks();
  const w = S.width, h = S.height;
  $('#sizeWarn').hidden = true;
  setDownloads(blocks.length > 0);
  if (!blocks.length) { result = null; showWarn(t('no_blocks')); draw(); renderStats(); return; }
  if (!resized || resized.width !== w || resized.height !== h) resized = resizeSource(w, h);
  const rgba = resized.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const opts = {
    width: w, height: h, palette: blocks.map((b) => b.rgb), dither: S.dither, strength: S.strength / 100,
    brightness: S.brightness, contrast: S.contrast, saturation: S.saturation,
  };
  const id = ++jobId;
  const done = (indices) => {
    if (id !== jobId) return;
    $('#busy').hidden = true;
    result = { w, h, indices, blocks, counts: countBlocks(indices) };
    result.solid = result.counts.reduce((a, [, n]) => a + n, 0);
    renderBlocksCanvas(); draw(); renderStats();
  };
  const busyTimer = setTimeout(() => { if (id === jobId) $('#busy').hidden = false; }, 150);
  const fallback = () => { clearTimeout(busyTimer); done(quantize(rgba, opts)); };
  if (!worker && worker !== false) {
    try { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); }
    catch { worker = false; }
  }
  if (!worker) return fallback();
  worker.onmessage = (e) => {
    if (e.data.id !== jobId) return;
    clearTimeout(busyTimer);
    if (e.data.error) { worker = false; return fallback(); }
    done(e.data.indices);
  };
  worker.onerror = () => { worker = false; fallback(); };
  worker.postMessage({ id, rgba, opts });
}

function showWarn(msg) { const el = $('#sizeWarn'); el.textContent = msg; el.hidden = false; }
function setDownloads(on) { ['#dlSchem', '#dlLitematic', '#dlPng', '#dlList', '#copyList'].forEach((s) => { $(s).disabled = !on; }); }

function renderBlocksCanvas() {
  const { w, h, indices, blocks } = result;
  blocksCanvas = document.createElement('canvas'); blocksCanvas.width = w; blocksCanvas.height = h;
  const g = blocksCanvas.getContext('2d');
  const img = g.createImageData(w, h);
  for (let p = 0; p < indices.length; p++) {
    const v = indices[p]; if (v < 0) continue;
    const c = blocks[v].rgb, i = p * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- drawing
/** Shrinks the preview box to the picture's aspect ratio so there is no dead space. */
function sizeViewport() {
  const vp = $('#viewport');
  const maxH = Math.min(window.innerHeight * (window.innerWidth <= 900 ? 0.62 : 0.72), 780);
  const want = ((vp.clientWidth - 24) * S.height) / S.width + 24;
  vp.style.height = `${Math.round(Math.max(240, Math.min(maxH, want)))}px`;
}

function fitZoom() {
  const vp = $('#viewport');
  const w = S.width, h = S.height;
  return Math.max(0.25, Math.min((vp.clientWidth - 24) / w, (vp.clientHeight - 24) / h));
}
const currentZoom = () => S.zoom || fitZoom();

function stepZoom(dir, anchor) {
  const z = currentZoom();
  const next = dir > 0 ? ZOOMS.find((x) => x > z + 1e-6) : [...ZOOMS].reverse().find((x) => x < z - 1e-6);
  if (next) setZoom(next, anchor);
}

function setZoom(z, anchor) {
  const vp = $('#viewport'), cv = $('#preview');
  const old = currentZoom();
  const ax = anchor ? anchor.x : vp.clientWidth / 2, ay = anchor ? anchor.y : vp.clientHeight / 2;
  const cx = (vp.scrollLeft + ax - cv.offsetLeft) / old, cy = (vp.scrollTop + ay - cv.offsetTop) / old;
  S.zoom = Math.min(32, Math.max(0.25, z));
  draw();
  vp.scrollLeft = cx * S.zoom + cv.offsetLeft - ax;
  vp.scrollTop = cy * S.zoom + cv.offsetTop - ay;
}

function draw() {
  const cv = $('#preview');
  if (!source) return;
  const w = S.width, h = S.height;
  sizeViewport();
  const z = currentZoom();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let cell = z * dpr;
  const maxPx = 8192;
  if (w * cell > maxPx || h * cell > maxPx) cell = Math.min(maxPx / w, maxPx / h);
  cv.width = Math.round(w * cell); cv.height = Math.round(h * cell);
  cv.style.width = `${w * z}px`; cv.style.height = `${h * z}px`;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  const showOriginal = S.view === 'original' || !result;
  if (showOriginal) {
    if (!resized || resized.width !== w || resized.height !== h) resized = resizeSource(w, h);
    g.drawImage(resized, 0, 0, cv.width, cv.height);
  } else {
    g.drawImage(blocksCanvas, 0, 0, cv.width, cv.height);
    if (S.shading && cell >= 10) shade(g, cell, w, h);
  }
  if (S.grid && cell >= 4) grid(g, cell, w, h);
}

function shade(g, cell, w, h) {
  const k = Math.max(1, Math.round(cell / 8));
  const tile = document.createElement('canvas');
  const s = Math.round(cell); tile.width = s; tile.height = s;
  const tg = tile.getContext('2d');
  tg.fillStyle = 'rgba(255,255,255,.16)'; tg.fillRect(0, 0, s, k); tg.fillRect(0, 0, k, s);
  tg.fillStyle = 'rgba(0,0,0,.22)'; tg.fillRect(0, s - k, s, k); tg.fillRect(s - k, 0, k, s);
  // A few deterministic speckles to hint at texture.
  tg.fillStyle = 'rgba(0,0,0,.07)';
  for (let i = 0; i < 5; i++) tg.fillRect(((i * 37) % 7) / 8 * s, ((i * 23) % 6) / 7 * s, k * 2, k * 2);
  g.save(); g.globalCompositeOperation = 'source-atop';
  const pat = g.createPattern(tile, 'repeat');
  if (Math.abs(cell - s) > 1e-6 && pat.setTransform) pat.setTransform(new DOMMatrix().scale(cell / s));
  g.fillStyle = pat; g.fillRect(0, 0, w * cell, h * cell);
  g.restore();
}

function grid(g, cell, w, h) {
  g.save();
  g.lineWidth = 1;
  for (let i = 0; i <= Math.max(w, h); i++) {
    const major = i % 16 === 0;
    g.strokeStyle = major ? 'rgba(255,80,80,.65)' : 'rgba(0,0,0,.28)';
    const p = Math.round(i * cell) + 0.5;
    if (i <= w) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h * cell); g.stroke(); }
    if (i <= h) { g.beginPath(); g.moveTo(0, p); g.lineTo(w * cell, p); g.stroke(); }
  }
  g.restore();
}

// ---------------------------------------------------------------- inspect + gestures
function bindViewport() {
  const vp = $('#viewport'), cv = $('#preview'), tip = $('#tooltip');
  const pointers = new Map();
  let pinch = null;

  const inspect = (e) => {
    if (!result || S.view !== 'blocks') { tip.hidden = true; return; }
    const r = cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * result.w);
    const y = Math.floor(((e.clientY - r.top) / r.height) * result.h);
    if (x < 0 || y < 0 || x >= result.w || y >= result.h) { tip.hidden = true; highlight(-1); return; }
    const v = result.indices[y * result.w + x];
    const vr = vp.getBoundingClientRect();
    const coord = S.orientation === 'wall' ? `x ${x}, y ${result.h - 1 - y}` : `x ${x}, z ${y}`;
    tip.innerHTML = v < 0 ? `Air <small>${coord}</small>`
      : `<i style="background:${rgbCss(result.blocks[v].rgb)}"></i>${prettyName(result.blocks[v].name)} <small>${coord}</small>`;
    tip.hidden = false;
    let tx = e.clientX - vr.left + vp.scrollLeft + 14, ty = e.clientY - vr.top + vp.scrollTop + 14;
    tx = Math.min(tx, vp.scrollLeft + vp.clientWidth - tip.offsetWidth - 6);
    ty = Math.min(ty, vp.scrollTop + vp.clientHeight - tip.offsetHeight - 6);
    tip.style.left = `${tx}px`; tip.style.top = `${ty}px`;
    highlight(v);
  };

  cv.addEventListener('pointermove', (e) => { if (!pinch) inspect(e); });
  cv.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') inspect(e); });
  vp.addEventListener('pointerleave', () => { tip.hidden = true; highlight(-1); });
  vp.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  vp.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return; // trackpad pinch arrives as ctrl+wheel
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    setZoom(currentZoom() * Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });

  // Two-finger pinch on touch screens.
  vp.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: currentZoom() };
    }
  });
  vp.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const r = vp.getBoundingClientRect();
      setZoom(pinch.z * (d / pinch.d), { x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top });
    }
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up);
  vp.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  let rz = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (!S.zoom) draw(); }); });
}

let lastHl = -2;
function highlight(v) {
  if (v === lastHl) return; lastHl = v;
  $$('#materials tr').forEach((tr) => tr.classList.toggle('hl', Number(tr.dataset.idx) === v));
}

// ---------------------------------------------------------------- stats & materials
function renderStats() {
  if (!result) { $('#stats').innerHTML = ''; $('#materials').innerHTML = ''; return; }
  const { w, h, counts, blocks, solid } = result;
  const dims = S.orientation === 'wall' ? `${w} × ${h} × 1` : `${w} × 1 × ${h}`;
  const totalStacks = counts.reduce((a, [, n]) => a + Math.ceil(n / 64), 0);
  $('#stats').innerHTML = [
    [dims, t('stat_size')], [fmt(solid), t('stat_blocks')], [counts.length, t('stat_types')],
    [`${fmt(totalStacks)} <small style="font-size:.6em;color:var(--muted)">≈ ${Math.ceil(totalStacks / 27)} 📦</small>`, t('stat_stacks')],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('#materials').innerHTML = counts.map(([idx, n]) => {
    const b = blocks[idx];
    return `<tr data-idx="${idx}"><td><span class="swatch" style="background:${rgbCss(b.rgb)}"></span>${prettyName(b.name)}</td>
      <td>${fmt(n)}</td><td>${stacks(n)}</td></tr>`;
  }).join('');
  lastHl = -2;
  const warns = [];
  if (S.orientation === 'wall' && h > 384) warns.push(t('height_warn'));
  if (solid > 40000) warns.push(t('big_warn'));
  $('#sizeWarn').hidden = !warns.length;
  $('#sizeWarn').textContent = warns.join(' ');
}

// ---------------------------------------------------------------- export
const baseName = () => `${(source?.name || 'blockart').replace(/[^\w\-]+/g, '_').slice(0, 40)}_${result.w}x${result.h}`;

function listText() {
  const dims = S.orientation === 'wall' ? `${result.w}×${result.h} wall` : `${result.w}×${result.h} floor`;
  return materialList(result.counts, result.blocks, prettyName, `BlockArt Studio – ${source.name} (${dims}, MC ${S.version})`);
}

async function download(kind) {
  if (!result) return;
  const v = versionInfo();
  const name = baseName();
  let blob, file;
  if (kind === 'png') {
    const c = document.createElement('canvas');
    const scale = Math.max(1, Math.min(16, Math.floor(2048 / Math.max(result.w, result.h))));
    c.width = result.w * scale; c.height = result.h * scale;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(blocksCanvas, 0, 0, c.width, c.height);
    if (scale >= 6) shade(g, scale, result.w, result.h);
    blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    file = `${name}.png`;
  } else if (kind === 'txt') {
    blob = new Blob([listText()], { type: 'text/plain;charset=utf-8' });
    file = `${name}_materials.txt`;
  } else {
    const s = buildStructure(result.indices, result.w, result.h, result.blocks, S.orientation);
    const data = kind === 'schem' ? await toSchem(s, v.dataVersion, name) : await toLitematic(s, v.dataVersion, v.minor, name);
    blob = new Blob([data], { type: 'application/octet-stream' });
    file = `${name}.${kind}`;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`✓ ${file}`);
}

async function copyList() {
  if (!result) return;
  const text = listText();
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast(t('copied'));
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- PWA
function setupPwa() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').hidden = true;
  });
  // Files opened via the installed app's file handler.
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      const h = params.files?.[0]; if (h) loadFile(await h.getFile());
    });
  }
}

// ---------------------------------------------------------------- boot
bindControls();
bindInput();
bindViewport();
applyLang();
setDownloads(false);
setupPwa();
if (new URLSearchParams(location.search).has('sample')) loadSample();
