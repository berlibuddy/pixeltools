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
 * k-means: trova k colori rappresentativi tra n colori (px = 3 valori per colore).
 * Partenza: colore medio + i colori "più lontani" (risultato sempre uguale);
 * poi si ripete: assegna ogni colore al centro più vicino → ricalcola le medie.
 */
export function quantize(px, n, k) {
  const d2 = (i, c) => colorDist(px[i * 3], px[i * 3 + 1], px[i * 3 + 2], c[0], c[1], c[2]);
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += px[i * 3]; mg += px[i * 3 + 1]; mb += px[i * 3 + 2]; }
  const centers = [[mr / n, mg / n, mb / n]];
  const minD = new Float64Array(n).fill(Infinity);
  while (centers.length < Math.min(k, n)) {
    const last = centers[centers.length - 1];
    let best = -1, bi = 0;
    for (let i = 0; i < n; i++) {
      const d = d2(i, last);
      if (d < minD[i]) minD[i] = d;
      if (minD[i] > best) { best = minD[i]; bi = i; }
    }
    if (best < 1) break; // l'immagine ha meno colori di quelli richiesti
    centers.push([px[bi * 3], px[bi * 3 + 1], px[bi * 3 + 2]]);
  }

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
 * Colori "veri" di una foto (senza trasparenza): k-means su una copia piccola
 * (max 200 px di lato). Così i colori nascono dai pixel della foto e non dalle
 * medie delle celle, che sui bordi mescolano due colori (nero + arancione = marrone).
 * Restituisce [[r,g,b], …] arrotondati.
 */
export function paletteFromImage(src, k) {
  const s = Math.min(1, 200 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const { rgb } = boxSample(src, w, h);
  return quantize(rgb, w * h, k).centers.map((c) => c.map(Math.round));
}

/**
 * Riduce un ImageData a W×H celle "a maggioranza": ogni pixel della foto vota
 * il colore più vicino della palette, la cella prende il colore con più voti.
 * A differenza della media, non inventa colori nuovi sui bordi.
 * Restituisce un Uint8Array con l'indice del colore di ogni cella.
 */
export function majorityLabels(src, W, H, pal) {
  const { width: sw, height: sh, data: sd } = src;
  const labels = new Uint8Array(W * H);
  const votes = new Uint32Array(pal.length);
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
