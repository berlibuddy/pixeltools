/* =============================================================
   PixelTools — src/core/pixel-engine.js
   MOTORE PIXEL (condiviso da Uncinetto, Pixel Art e futuri tool)
   -------------------------------------------------------------
   Solo calcoli: non tocca la pagina (niente DOM).
   - boxSample:    riduce un'immagine a una griglia di celle
                   (ogni cella = colore medio dei pixel che copre)
   - quantize:     trova N colori rappresentativi (k-means)
   - nearestColor: il colore più vicino dentro una palette
   - paletteFromImage, majorityLabels: colori presi dalla foto vera
                   e celle "a maggioranza" (Uncinetto)
   - simplify:     pulizia dei punti sparsi ("Semplifica")
   - patternStats, importantColors: numeri per l'indicatore di difficoltà
   - stylize, keepOutlines: la foto "a macchie" per gli stili dell'Uncinetto
   - colorDist, luma, toHex, parseHex: piccoli aiuti sui colori
   ============================================================= */

/** Luminosità percepita (0 = nero, 255 = bianco) */
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** 255, 122, 107 → "#FF7A6B" */
export const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** "#FF7A6B" → [255, 122, 107] */
export const parseHex = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** Distanza tra due colori, pesata: l'occhio è più sensibile al verde */
export function colorDist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
}

/** Indice del colore della palette ([[r,g,b], …]) più vicino a r,g,b */
export function nearestColor(pal, r, g, b) {
  let best = Infinity, bi = 0;
  for (let j = 0; j < pal.length; j++) {
    const d = colorDist(r, g, b, pal[j][0], pal[j][1], pal[j][2]);
    if (d < best) { best = d; bi = j; }
  }
  return bi;
}

/**
 * Riduce un ImageData a W×H celle.
 * Restituisce { rgb, alpha }: rgb = 3 valori per cella, alpha = 0…255 per cella.
 * Il colore è pesato con la trasparenza, così i bordi trasparenti non "sporcano" di nero.
 */
export function boxSample(src, W, H) {
  const { width: sw, height: sh, data: sd } = src;
  const rgb = new Float32Array(W * H * 3);
  const alpha = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * sh) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * sw) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / W));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          const al = sd[i + 3];
          r += sd[i] * al; g += sd[i + 1] * al; b += sd[i + 2] * al; a += al; n++;
        }
      }
      const o = y * W + x;
      alpha[o] = a / n;
      if (a > 0) { rgb[o * 3] = r / a; rgb[o * 3 + 1] = g / a; rgb[o * 3 + 2] = b / a; } else { rgb[o * 3] = rgb[o * 3 + 1] = rgb[o * 3 + 2] = 255; }
    }
  }
  return { rgb, alpha };
}

/**
 * Partenza del k-means: aggiunge ai centri i colori "più lontani" da quelli già scelti,
 * finché sono k (risultato sempre uguale). Si ferma prima se l'immagine ha meno colori.
 */
function farthestFirst(px, n, k, centers) {
  const minD = new Float64Array(n).fill(Infinity);
  while (centers.length < Math.min(k, n)) {
    const last = centers[centers.length - 1];
    let best = -1, bi = 0;
    for (let i = 0; i < n; i++) {
      const d = colorDist(px[i * 3], px[i * 3 + 1], px[i * 3 + 2], last[0], last[1], last[2]);
      if (d < minD[i]) minD[i] = d;
      if (minD[i] > best) { best = minD[i]; bi = i; }
    }
    if (best < 1) break; // l'immagine ha meno colori di quelli richiesti
    centers.push([px[bi * 3], px[bi * 3 + 1], px[bi * 3 + 2]]);
  }
  return centers;
}

/** k-means vero e proprio: assegna ogni colore al centro più vicino → ricalcola le medie (max 12 giri) */
function kmeans(px, n, centers) {
  const d2 = (i, c) => colorDist(px[i * 3], px[i * 3 + 1], px[i * 3 + 2], c[0], c[1], c[2]);
  const labels = new Uint8Array(n);
  const assign = () => {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let bd = Infinity, bj = 0;
      for (let j = 0; j < centers.length; j++) {
        const d = d2(i, centers[j]);
        if (d < bd) { bd = d; bj = j; }
      }
      if (labels[i] !== bj) { labels[i] = bj; changed++; }
    }
    return changed;
  };
  for (let it = 0; it < 12; it++) {
    if (assign() === 0 && it > 0) break;
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sum[labels[i]];
      s[0] += px[i * 3]; s[1] += px[i * 3 + 1]; s[2] += px[i * 3 + 2]; s[3]++;
    }
    sum.forEach((s, j) => { if (s[3]) centers[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  assign();
  return { centers, labels };
}

/**
 * k-means: trova k colori rappresentativi tra n colori (px = 3 valori per colore).
 * Partenza: colore medio + i colori "più lontani" (usato da Pixel Art).
 */
export function quantize(px, n, k) {
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += px[i * 3]; mg += px[i * 3 + 1]; mb += px[i * 3 + 2]; }
  return kmeans(px, n, farthestFirst(px, n, k, [[mr / n, mg / n, mb / n]]));
}

/**
 * Colori "veri" di una foto (senza trasparenza), per l'Uncinetto.
 * - Campioni presi dalla foto così come sono (circa 200 per lato, nessuna media):
 *   le medie sui bordi inventano colori finti (nero + arancione = marrone).
 * - Il k-means parte dal colore PIÙ PRESENTE (non dal colore medio: in una foto
 *   con cielo azzurro e prato verde il colore medio sta a metà e li unisce in uno).
 * Restituisce [[r,g,b], …] arrotondati.
 */
export function paletteFromImage(src, k) {
  const { width: sw, height: sh, data: sd } = src;
  const step = Math.max(1, Math.round(Math.max(sw, sh) / 200));
  const half = Math.floor(step / 2);
  const samples = [];
  for (let y = half; y < sh; y += step) {
    for (let x = half; x < sw; x += step) {
      const i = (y * sw + x) * 4;
      samples.push(sd[i], sd[i + 1], sd[i + 2]);
    }
  }
  const px = Float32Array.from(samples);
  const n = px.length / 3;
  // Colore più presente: si raggruppano i colori simili (16 livelli per canale) e si prende il gruppo più grande
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const key = ((px[i * 3] >> 4) << 8) | ((px[i * 3 + 1] >> 4) << 4) | (px[i * 3 + 2] >> 4);
    const g = groups.get(key) || [0, 0, 0, 0];
    g[0] += px[i * 3]; g[1] += px[i * 3 + 1]; g[2] += px[i * 3 + 2]; g[3]++;
    groups.set(key, g);
  }
  let top = null;
  for (const g of groups.values()) if (!top || g[3] > top[3]) top = g;
  const start = [[top[0] / top[3], top[1] / top[3], top[2] / top[3]]];
  return kmeans(px, n, farthestFirst(px, n, k, start)).centers.map((c) => c.map(Math.round));
}

/**
 * Riduce un ImageData a W×H celle "a maggioranza": ogni pixel della foto vota
 * il colore più vicino della palette, la cella prende il colore con più voti.
 * A differenza della media, non inventa colori nuovi sui bordi.
 * CONTORNI PROTETTI: una linea scura sottile perderebbe la votazione e sparirebbe;
 * per questo un colore scuro vince la cella se ne copre almeno un quarto,
 * ma solo sopra un fondo chiaro (come una linea a matita su un foglio).
 * Restituisce un Uint8Array con l'indice del colore di ogni cella.
 */
const OUTLINE_DARK = 90;    // luminosità sotto cui un colore è "scuro" (linea)
const OUTLINE_LIGHT = 170;  // luminosità sopra cui il fondo è "chiaro"
const OUTLINE_SHARE = 0.25; // parte della cella che la linea deve coprire
export function majorityLabels(src, W, H, pal) {
  const { width: sw, height: sh, data: sd } = src;
  const labels = new Uint8Array(W * H);
  const votes = new Uint32Array(pal.length);
  const dark = pal.map((c) => luma(c[0], c[1], c[2]) < OUTLINE_DARK);
  const light = pal.map((c) => luma(c[0], c[1], c[2]) > OUTLINE_LIGHT);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * sh) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * sw) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / W));
      votes.fill(0);
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) votes[nearestColor(pal, sd[i], sd[i + 1], sd[i + 2])]++;
      }
      let best = 0;
      for (let j = 1; j < pal.length; j++) if (votes[j] > votes[best]) best = j;
      if (light[best]) {
        const min = OUTLINE_SHARE * (x1 - x0) * (y1 - y0);
        let line = -1;
        for (let j = 0; j < pal.length; j++) if (dark[j] && votes[j] >= min && (line < 0 || votes[j] > votes[line])) line = j;
        if (line >= 0) best = line;
      }
      labels[y * W + x] = best;
    }
  }
  return labels;
}

/** Celle vicine a i (8 direzioni: lati + diagonali) */
function neighbours8(i, W, H) {
  const x = i % W, y = (i - x) / W, out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && nx < W && ny >= 0 && ny < H) out.push(ny * W + nx);
    }
  }
  return out;
}

/** Gruppi di celle dello stesso colore che si toccano (anche in diagonale) */
function colorGroups(cells, W, H) {
  const group = new Int32Array(W * H).fill(-1);
  const list = [];
  for (let s = 0; s < W * H; s++) {
    if (group[s] !== -1) continue;
    const id = list.length, col = cells[s], members = [], stack = [s];
    group[s] = id;
    while (stack.length) {
      const i = stack.pop();
      members.push(i);
      for (const j of neighbours8(i, W, H)) if (group[j] === -1 && cells[j] === col) { group[j] = id; stack.push(j); }
    }
    list.push({ id, col, members });
  }
  return { group, list };
}

/**
 * Pulizia dello schema ("Semplifica"): i gruppetti piccoli di un colore prendono
 * il colore che li circonda di più (a parità: il colore più simile).
 * Le diagonali contano come "vicine", così le linee sottili oblique restano.
 * level: 0 nessuna · 1 poco (via i punti da soli) · 2 medio (gruppetti fino a 3) · 3 tanto (fino a 6).
 * cells: indici colore (non viene modificato); pal: [[r,g,b], …]. Restituisce un nuovo Uint8Array.
 */
const SIMPLIFY_MAX = [0, 1, 3, 6];
export function simplify(cells, W, H, pal, level) {
  const out = Uint8Array.from(cells);
  const maxSize = SIMPLIFY_MAX[level] || 0;
  if (!maxSize) return out;
  for (let pass = 0; pass < 8; pass++) {
    const { group, list } = colorGroups(out, W, H);
    const small = list.filter((g) => g.members.length <= maxSize).sort((a, b) => a.members.length - b.members.length);
    let changed = 0;
    for (const g of small) {
      if (out[g.members[0]] !== g.col) continue; // già cambiato in questo giro
      const touch = new Map();
      for (const i of g.members) {
        for (const j of neighbours8(i, W, H)) if (group[j] !== g.id) touch.set(out[j], (touch.get(out[j]) || 0) + 1);
      }
      const c0 = pal[g.col];
      let bestN = -1, bestD = Infinity, next = g.col;
      for (const [c, n] of touch) {
        const d = colorDist(c0[0], c0[1], c0[2], pal[c][0], pal[c][1], pal[c][2]);
        if (n > bestN || (n === bestN && d < bestD)) { bestN = n; bestD = d; next = c; }
      }
      if (next !== g.col) { for (const i of g.members) out[i] = next; changed++; }
    }
    if (!changed) break;
  }
  return out;
}

/**
 * Numeri di uno schema, per l'indicatore di difficoltà dell'Uncinetto.
 * - changesAvg / changesMax: cambi di colore per riga (media e massimo)
 * - colorsRowMax: colori al massimo nella stessa riga (tapestry: meglio 2)
 * - rowsOver2: righe con più di 2 colori
 * - zones: zone di colore separate (lati che si toccano) = bobine/gomitoli nel C2C
 */
export function patternStats(cells, W, H) {
  let total = 0, changesMax = 0, colorsRowMax = 0, rowsOver2 = 0;
  for (let y = 0; y < H; y++) {
    const row = new Set();
    let ch = 0;
    for (let x = 0; x < W; x++) {
      const c = cells[y * W + x];
      row.add(c);
      if (x > 0 && c !== cells[y * W + x - 1]) ch++;
    }
    total += ch;
    if (ch > changesMax) changesMax = ch;
    if (row.size > colorsRowMax) colorsRowMax = row.size;
    if (row.size > 2) rowsOver2++;
  }
  const seen = new Uint8Array(W * H);
  let zones = 0;
  for (let s = 0; s < W * H; s++) {
    if (seen[s]) continue;
    zones++;
    seen[s] = 1;
    const stack = [s];
    while (stack.length) {
      const i = stack.pop(), x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j >= 0 && j < W * H && !seen[j] && cells[j] === cells[i]) { seen[j] = 1; stack.push(j); }
      }
    }
  }
  return { changesAvg: total / H, changesMax, colorsRowMax, rowsOver2, zones };
}

/**
 * Quanti colori "importanti" ha una foto: si cercano 8 colori, si tengono quelli
 * che coprono almeno l'1,5% della foto e si uniscono quelli quasi uguali.
 * Serve al consiglio "questa foto ha 6 colori importanti, ne hai scelti 4".
 */
export function importantColors(src) {
  const pal = paletteFromImage(src, 8);
  const W = 80, H = Math.max(1, Math.round((80 * src.height) / src.width));
  const labels = majorityLabels(src, W, H, pal);
  const count = new Array(pal.length).fill(0);
  for (const l of labels) count[l]++;
  const big = pal.map((p, i) => ({ p, share: count[i] / (W * H) }))
    .filter((o) => o.share >= 0.015)
    .sort((a, b) => b.share - a.share);
  const kept = [];
  for (const o of big) if (!kept.some((k) => colorDist(k[0], k[1], k[2], o.p[0], o.p[1], o.p[2]) < 1200)) kept.push(o.p);
  return kept.length;
}

/**
 * "Stilizza" (Uncinetto): la foto diventa a macchie, come un poster o un adesivo.
 * Filtro di Kuwahara: per ogni pixel guarda i 4 quadrati intorno e prende il colore
 * medio di quello più uniforme → le sfumature si lisciano, i bordi restano netti.
 * Lavora su una copia piccola (lato max 256 px): pochi centesimi di secondo anche sul telefono.
 * strength: 0 nessuna · 1 leggera · 2 media · 3 forte. Restituisce un oggetto come ImageData.
 */
const STYLIZE_RADIUS = [0, 2, 3, 4];
const STYLIZE_PASSES = [0, 1, 2, 3];
export function stylize(src, strength) {
  if (!strength) return src;
  const s = Math.min(1, 256 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const { rgb } = boxSample(src, w, h);
  let img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = rgb[i * 3]; img.data[i * 4 + 1] = rgb[i * 3 + 1]; img.data[i * 4 + 2] = rgb[i * 3 + 2]; img.data[i * 4 + 3] = 255;
  }
  for (let p = 0; p < STYLIZE_PASSES[strength]; p++) img = kuwahara(img, STYLIZE_RADIUS[strength]);
  return img;
}

function kuwahara(img, r) {
  const { width: w, height: h, data: d } = img;
  // Somme cumulate di r, g, b, luminosità e luminosità² → media e varianza di ogni quadrato in un colpo solo
  const W1 = w + 1, N = W1 * (h + 1);
  const S = [0, 1, 2, 3, 4].map(() => new Float64Array(N));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, l = luma(d[i], d[i + 1], d[i + 2]);
      const v = [d[i], d[i + 1], d[i + 2], l, l * l], k = (y + 1) * W1 + x + 1;
      for (let c = 0; c < 5; c++) S[c][k] = v[c] + S[c][k - 1] + S[c][k - W1] - S[c][k - W1 - 1];
    }
  }
  const box = (c, x0, y0, x1, y1) => S[c][(y1 + 1) * W1 + x1 + 1] - S[c][y0 * W1 + x1 + 1] - S[c][(y1 + 1) * W1 + x0] + S[c][y0 * W1 + x0];
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity, q = null;
      for (const [ax, ay] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const x0 = Math.max(0, x + ax * r), y0 = Math.max(0, y + ay * r);
        const x1 = Math.min(w - 1, x0 + r), y1 = Math.min(h - 1, y0 + r);
        const n = (x1 - x0 + 1) * (y1 - y0 + 1), m = box(3, x0, y0, x1, y1) / n;
        const v = box(4, x0, y0, x1, y1) / n - m * m;
        if (v < best) { best = v; q = [x0, y0, x1, y1, n]; }
      }
      const i = (y * w + x) * 4;
      out[i] = box(0, q[0], q[1], q[2], q[3]) / q[4];
      out[i + 1] = box(1, q[0], q[1], q[2], q[3]) / q[4];
      out[i + 2] = box(2, q[0], q[1], q[2], q[3]) / q[4];
      out[i + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Dopo "Stilizza": i contorni scuri sottili della foto originale tornano sopra le macchie
 * (il filtro li lisciava via: il bradipo perdeva la testa). Stessa regola dei contorni
 * protetti: colore scuro dall'originale sopra un colore chiaro delle macchie.
 * styled, original: indici colore della stessa palette. Restituisce un nuovo Uint8Array.
 */
export function keepOutlines(styled, original, pal) {
  const L = pal.map((c) => luma(c[0], c[1], c[2]));
  const out = Uint8Array.from(styled);
  for (let i = 0; i < out.length; i++) if (L[original[i]] < OUTLINE_DARK && L[out[i]] > OUTLINE_LIGHT) out[i] = original[i];
  return out;
}
