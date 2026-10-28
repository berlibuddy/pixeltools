/* =============================================================
   PixelTools — src/core/pixel-engine.js
   MOTORE PIXEL (condiviso da Uncinetto, Pixel Art e futuri tool)
   -------------------------------------------------------------
   Solo calcoli: non tocca la pagina (niente DOM).
   - boxSample:    riduce un'immagine a una griglia di celle
                   (ogni cella = colore medio dei pixel che copre)
   - quantize:     trova N colori rappresentativi (k-means)
   - nearestColor: il colore più vicino dentro una palette
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