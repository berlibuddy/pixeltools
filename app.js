/* =============================================================
   PixelTools — app.js
   -------------------------------------------------------------
   Tutto gira nel browser: nessun file viene inviato a un server.

   Librerie caricate via CDN in index.html (variabili globali):
     - PDFLib    (pdf-lib 1.17.1)   → creare e modificare PDF
     - JSZip     (3.10.1)           → creare archivi .zip
     - pdfjsLib  (pdf.js 3.11.174)  → SOLO anteprima pagine nel tool Firma
   Le immagini usano la Canvas API nativa del browser.

   Indice:
     0. Configurazione
     1. Utility generiche → spostate in src/core/ (dom, files, images, ui)
     2. Componenti riutilizzabili (Dropzone, FileQueue) → src/core/ui.js
     2b. Motore pixel → spostato in src/core/pixel-engine.js
     3. Router (dashboard ↔ strumenti)
     4. Tool 1 — Unisci PDF
     5. Tool 2 — Firma & Annotazioni PDF
     6. Tool 3 — Immagini in PDF
     7. Tool 4 — Convertitore & Compressore immagini
     8. Tool 5 — Crea archivio ZIP
     9. Tool 6 — Foto in Uncinetto
    10. Tool 7 — Foto in Pixel Art
    11. Avvio
   ============================================================= */
   'use strict';

   import { luma, toHex, parseHex, colorDist, nearestColor, boxSample, quantize } from './src/core/pixel-engine.js';
   import { $, $$, h, clamp } from './src/core/dom.js';
   import { formatBytes, baseName, extOf, isPdf, isImage, downloadBlob, uniqueName, pathOf, filesFromDrop } from './src/core/files.js';
   import { loadBitmap, fileToCanvas, canvasToBlob, canEncode } from './src/core/images.js';
   import { setStatus, requireLib, runTask, setupDropzone, FileQueue } from './src/core/ui.js';
   import { CONFIG } from './src/core/config.js';

   /* =============================================================
      0. CONFIGURAZIONE → spostata in src/core/config.js (CONFIG)
      ============================================================= */
   
   /* =============================================================
      1. UTILITY GENERICHE + 2. COMPONENTI RIUTILIZZABILI
      → spostati in src/core/ui.js (setStatus, requireLib, runTask, setupDropzone, FileQueue)
      ============================================================= */

   /* =============================================================
      3. ROUTER — mostra la dashboard o lo strumento indicato nell'URL (#merge, #sign…)
      Usare l'hash fa funzionare anche il tasto "indietro" del browser.
      ============================================================= */
   const TOOL_TITLES = {
     merge: 'Unisci PDF',
     sign: 'Firma & Annotazioni',
     img2pdf: 'Immagini in PDF',
     convert: 'Converti & Comprimi',
     zip: 'Crea ZIP',
     crochet: 'Foto in Uncinetto',
     pixel: 'Foto in Pixel Art',
   };
   const toolHooks = {}; // funzioni da chiamare quando un tool diventa visibile
   
   /**
    * Tool "a richiesta" (Passo 3): ognuno vive in src/tools/<tool>/ e viene
    * scaricato solo la prima volta che lo apri. tool.js esporta:
    *   view → il markup (view.html) · init(ws, toolHooks) → collega i comandi
    * Se il tool ha uno stile suo (style.css), Vite lo carica insieme al tool.
    * I tool non ancora spostati restano qui sotto in app.js e in index.html.
    */
   const LAZY_TOOLS = {
     merge: () => import('./src/tools/merge/tool.js'),
     img2pdf: () => import('./src/tools/img2pdf/tool.js'),
     convert: () => import('./src/tools/convert/tool.js'),
     zip: () => import('./src/tools/zip/tool.js'),
     sign: () => import('./src/tools/sign/tool.js'),
     crochet: () => import('./src/tools/crochet/tool.js'),
   };
   const loadingTools = {}; // id → Promise: ogni tool si carica una volta sola
   
   function loadTool(id) {
     if (!LAZY_TOOLS[id]) return Promise.resolve();
     loadingTools[id] ??= LAZY_TOOLS[id]().then(({ view, init }) => {
       const tpl = document.createElement('template');
       tpl.innerHTML = view; // markup statico nostro (view.html): sicuro
       const ws = tpl.content.querySelector('.workspace');
       $('main').append(ws);
       init(ws, toolHooks); // toolHooks: il tool può dire cosa fare quando diventa visibile
     }).catch((err) => {
       delete loadingTools[id]; // al prossimo tentativo riprova da capo
       throw err;
     });
     return loadingTools[id];
   }
   
   async function route() {
     const id = location.hash.slice(1);
     let active = id in TOOL_TITLES ? id : null;
   
     if (active) {
       try {
         await loadTool(active);
       } catch (err) {
         console.error(err);
         const banner = $('#lib-warning');
         banner.textContent = '⚠ Non riesco ad aprire questo strumento. Controlla la connessione e ricarica la pagina.';
         banner.hidden = false;
         active = null; // resta sulla dashboard
       }
       if (location.hash.slice(1) !== id) return; // nel frattempo hai già cambiato pagina
     }
   
     $('#dashboard').hidden = Boolean(active);
     $$('.workspace').forEach((ws) => { ws.hidden = ws.dataset.tool !== active; });
     document.title = active ? `${TOOL_TITLES[active]} — PixelTools` : 'PixelTools — PDF, Immagini e ZIP nel browser';
     window.scrollTo(0, 0);
   
     if (active) {
       $(`#tool-${active} h2`)?.focus({ preventScroll: true }); // accessibilità: annuncia il tool
       toolHooks[active]?.();
     }
   }
   
   /* =============================================================
      4. TOOL 1 — UNISCI PDF → spostato in src/tools/merge/ (tool.js + view.html)
      ============================================================= */
   
   /* =============================================================
      5. TOOL 2 — FIRMA & ANNOTAZIONI PDF → spostato in src/tools/sign/ (tool.js + view.html)
      ============================================================= */
   
   /* =============================================================
      6. TOOL 3 — IMMAGINI IN PDF → spostato in src/tools/img2pdf/ (tool.js + view.html)
      ============================================================= */
   
   /* =============================================================
      7. TOOL 4 — CONVERTITORE & COMPRESSORE IMMAGINI → spostato in src/tools/convert/ (tool.js + view.html)
      ============================================================= */
   
   /* =============================================================
      8. TOOL 5 — CREA ARCHIVIO ZIP → spostato in src/tools/zip/ (tool.js + view.html)
      ============================================================= */
   
   /* =============================================================
      9. TOOL 6 — FOTO IN UNCINETTO → spostato in src/tools/crochet/ (tool.js + view.html + style.css)
      ============================================================= */
   
   /* =============================================================
      10. TOOL 7 — FOTO IN PIXEL ART
      -------------------------------------------------------------
      Due modalità:
      - FOTO → PIXEL ART: la foto viene ridotta a pochi pixel (boxSample)
        e i colori a una palette: automatica (k-means) o una palette retrò
        famosa. Il "dithering" alterna due colori a puntini per simulare
        le sfumature, come nei vecchi videogiochi.
      - RIPULISCI PIXEL ART AI: la pixel art fatta con l'AI spesso è
        "finta": pixel storti e sfocati, troppi colori. Troviamo la griglia
        vera (detectPixelSize), prendiamo il colore al CENTRO di ogni pixel
        (i bordi sono sfocati) e riduciamo la palette.
      Il risultato è un'immagine "indicizzata": ogni pixel contiene il
      numero di un colore della palette (-1 = trasparente).
      ============================================================= */
   function initPixel() {
     const ws = $('#tool-pixel');
     const status = $('.status', ws);
     const fileLabel = $('#px-filename');
     const widthIn = $('#px-width');
     const heightOut = $('#px-height');
     const cellIn = $('#px-cell');
     const gridOut = $('#px-grid');
     const detectBtn = $('#px-detect');
     const detectInfo = $('#px-detect-info');
     const paletteSel = $('#px-palette');
     const colorsPanel = $('#px-colors-panel');
     const colorsIn = $('#px-colors');
     const colorsOut = $('#px-colors-out');
     const ditherSel = $('#px-dither');
     const outlineIn = $('#px-outline');
     const scaleSel = $('#px-scale');
     const outSize = $('#px-out-size');
     const downloadBtn = $('#px-download');
     const canvas = $('#px-canvas');
     const stage = $('.px-stage', ws);
     const stageEmpty = $('.stage-empty', ws);
     const info = $('#px-info');
     const swatches = $('#px-swatches');
     const gridToggle = $('#px-grid-toggle');
   
     /** Palette retrò famose, libere da usare */
     const PALETTES = {
       gameboy: ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'],
       pico8: ['#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
         '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA'],
       endesga32: ['#BE4A2F', '#D77643', '#EAD4AA', '#E4A672', '#B86F50', '#733E39', '#3E2731', '#A22633',
         '#E43B44', '#F77622', '#FEAE34', '#FEE761', '#63C74D', '#3E8948', '#265C42', '#193C3E',
         '#124E89', '#0099DB', '#2CE8F5', '#FFFFFF', '#C0CBDC', '#8B9BB4', '#5A6988', '#3A4466',
         '#262B44', '#181425', '#FF0044', '#68386C', '#B55088', '#F6757A', '#E8B796', '#C28569'],
       bw: ['#000000', '#FFFFFF'],
     };
     const MAX_SIDE = 256; // lato massimo della pixel art
     // Matrice di Bayer 4×4: lo "schema a puntini" del dithering ordinato
     const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
   
     /** Stato del tool */
     const S = {
       src: null,        // ImageData dell'immagine (max 2048 px, trasparenza conservata)
       fileName: '',
       mode: 'photo',    // 'photo' | 'clean'
       hasAlpha: false,  // l'immagine ha parti trasparenti?
       grid: null,       // griglia rilevata in modalità "ripulisci": { size, ox, oy }
       art: null,        // risultato: { W, H, pal, idx, counts }
     };
   
     /* ---------- 10a. Ripulisci AI: trovare la griglia ---------- */
     /**
      * Nella pixel art ingrandita i colori cambiano SOLO sui bordi dei "pixel grandi".
      * 1. Sommiamo quanto cambia il colore colonna per colonna (e riga per riga).
      * 2. Togliamo il "rumore" di fondo (la mediana) e teniamo solo i picchi:
      *    restano le posizioni dei bordi veri.
      * 3. Per ogni grandezza s calcoliamo quanta "forza dei bordi" cade su una griglia
      *    ogni s pixel. Anche s/2 e s/3 contengono tutti i bordi (la griglia è più fitta),
      *    mentre 2s ne perde molti: quindi vince la grandezza PIÙ GRANDE che li contiene quasi tutti.
      */
     function detectPixelSize(src) {
       const { width: w, height: hgt, data: d } = src;
       const colG = new Float64Array(w);
       const rowG = new Float64Array(hgt);
       const diff = (i, j) => Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) + Math.abs(d[i + 3] - d[j + 3]);
       for (let y = 0; y < hgt; y++) {
         for (let x = 0; x < w; x++) {
           const i = (y * w + x) * 4;
           if (x > 0) colG[x] += diff(i, i - 4);
           if (y > 0) rowG[y] += diff(i, i - w * 4);
         }
       }
   
       /** Toglie il rumore di fondo e tiene solo i picchi (i bordi veri) */
       const peaks = (G) => {
         const median = Float64Array.from(G).sort()[Math.floor(G.length / 2)];
         const base = G.map((v) => Math.max(0, v - median));
         return base.map((v, i) => (v > 0 && v >= (base[i - 1] || 0) && v >= (base[i + 1] || 0) ? v : 0));
       };
       const pc = peaks(colG);
       const pr = peaks(rowG);
       const totC = pc.reduce((a, v) => a + v, 0);
       const totR = pr.reduce((a, v) => a + v, 0);
       if (!totC || !totR) return null; // nessun bordo: immagine tutta di un colore
   
       /** Frazione dei bordi che cade sulla griglia s (con lo spostamento migliore) */
       const fit = (G, tot, s) => {
         let best = 0, off = 0;
         for (let o = 0; o < s; o++) {
           let sum = 0;
           for (let k = o; k < G.length; k += s) sum += G[k];
           if (sum > best) { best = sum; off = o; }
         }
         return { f: best / tot, off };
       };
   
       const maxS = Math.min(64, Math.floor(Math.min(w, hgt) / 4));
       let found = null;
       for (let s = 2; s <= maxS; s++) {
         const cx = fit(pc, totC, s);
         const cy = fit(pr, totR, s);
         // almeno l'80% dei bordi sulla griglia, in orizzontale e in verticale
         if (cx.f >= 0.8 && cy.f >= 0.8) found = { size: s, ox: cx.off, oy: cy.off };
       }
       return found; // null = i bordi non seguono una griglia: non è pixel art ingrandita
     }
   
     /** Ripulisci: colore al CENTRO di ogni pixel grande (i bordi dell'AI sono sfocati) */
     function sampleCenters(src, cell, ox, oy) {
       const { width: sw, height: sh, data: sd } = src;
       const W = Math.floor((sw - ox) / cell);
       const H = Math.floor((sh - oy) / cell);
       const rgb = new Float32Array(Math.max(0, W * H) * 3);
       const alpha = new Float32Array(Math.max(0, W * H));
       const m = Math.floor(cell / 4); // margine escluso su ogni lato
       for (let y = 0; y < H; y++) {
         for (let x = 0; x < W; x++) {
           const x0 = ox + x * cell + m, x1 = ox + (x + 1) * cell - m;
           const y0 = oy + y * cell + m, y1 = oy + (y + 1) * cell - m;
           let r = 0, g = 0, b = 0, a = 0, n = 0;
           for (let yy = y0; yy < y1; yy++) {
             for (let xx = x0; xx < x1; xx++) {
               const i = (yy * sw + xx) * 4;
               const al = sd[i + 3];
               r += sd[i] * al; g += sd[i + 1] * al; b += sd[i + 2] * al; a += al; n++;
             }
           }
           const o = y * W + x;
           alpha[o] = n ? a / n : 0;
           if (a > 0) { rgb[o * 3] = r / a; rgb[o * 3 + 1] = g / a; rgb[o * 3 + 2] = b / a; }
         }
       }
       return { W, H, rgb, alpha };
     }
   
     /* ---------- 10b. Palette, dithering, contorno ---------- */
     const visible = (alpha, i) => alpha[i] >= 128; // sotto metà opacità = trasparente
   
     /** Palette scelta, oppure automatica (k-means sui soli pixel visibili) */
     function buildPalette(rgb, alpha, n) {
       const key = paletteSel.value;
       if (key !== 'auto') return PALETTES[key].map(parseHex);
       const ids = [];
       for (let i = 0; i < n; i++) if (visible(alpha, i)) ids.push(i);
       if (!ids.length) return [[0, 0, 0]];
       const px = new Float32Array(ids.length * 3);
       ids.forEach((i, j) => { px[j * 3] = rgb[i * 3]; px[j * 3 + 1] = rgb[i * 3 + 1]; px[j * 3 + 2] = rgb[i * 3 + 2]; });
       const centers = quantize(px, ids.length, Number(colorsIn.value)).centers;
       // Unisce i colori quasi uguali (l'AI "sporca" i colori: due beige quasi identici → uno solo)
       const minDist = S.mode === 'clean' ? 200 : 60;
       const merged = [];
       for (const c of centers) {
         if (!merged.some((m) => colorDist(c[0], c[1], c[2], m[0], m[1], m[2]) < minDist)) merged.push(c);
       }
       return merged.map((c) => c.map(Math.round));
     }
   
     /** Assegna a ogni pixel un colore della palette, con o senza dithering */
     function mapToPalette(rgb, alpha, W, H, pal, dither) {
       const out = new Int16Array(W * H).fill(-1);
   
       if (dither === 'fs') {
         // Floyd–Steinberg: l'errore di colore di un pixel viene "spalmato" sui vicini
         const work = Float32Array.from(rgb);
         for (let y = 0; y < H; y++) {
           for (let x = 0; x < W; x++) {
             const i = y * W + x;
             if (!visible(alpha, i)) continue;
             const r = clamp(work[i * 3], 0, 255), g = clamp(work[i * 3 + 1], 0, 255), b = clamp(work[i * 3 + 2], 0, 255);
             const k = nearestColor(pal, r, g, b);
             out[i] = k;
             const er = r - pal[k][0], eg = g - pal[k][1], eb = b - pal[k][2];
             const push = (dx, dy, f) => {
               const xx = x + dx, yy = y + dy;
               if (xx < 0 || xx >= W || yy >= H) return;
               const j = yy * W + xx;
               if (!visible(alpha, j)) return;
               work[j * 3] += er * f; work[j * 3 + 1] += eg * f; work[j * 3 + 2] += eb * f;
             };
             push(1, 0, 7 / 16); push(-1, 1, 3 / 16); push(0, 1, 5 / 16); push(1, 1, 1 / 16);
           }
         }
         return out;
       }
   
       // Dithering ordinato (Bayer): spostamento fisso a scacchiera; più forte con meno colori
       const amp = dither === 'bayer' ? 128 / Math.cbrt(pal.length) : 0;
       for (let y = 0; y < H; y++) {
         for (let x = 0; x < W; x++) {
           const i = y * W + x;
           if (!visible(alpha, i)) continue;
           const t = amp ? ((BAYER[y % 4][x % 4] + 0.5) / 16 - 0.5) * amp : 0;
           out[i] = nearestColor(pal, rgb[i * 3] + t, rgb[i * 3 + 1] + t, rgb[i * 3 + 2] + t);
         }
       }
       return out;
     }
   
     /** Contorno: ogni pixel trasparente che tocca il soggetto diventa il colore più scuro */
     function addOutline(idx, W, H, pal) {
       let dark = 0;
       pal.forEach((c, j) => { if (luma(...c) < luma(...pal[dark])) dark = j; });
       const res = Int16Array.from(idx);
       for (let y = 0; y < H; y++) {
         for (let x = 0; x < W; x++) {
           const i = y * W + x;
           if (idx[i] !== -1) continue;
           const touches = (x > 0 && idx[i - 1] >= 0) || (x < W - 1 && idx[i + 1] >= 0)
             || (y > 0 && idx[i - W] >= 0) || (y < H - 1 && idx[i + W] >= 0);
           if (touches) res[i] = dark;
         }
       }
       return res;
     }
   
     /** Calcola la pixel art con le opzioni attuali (null se non si può) */
     function build() {
       let W, H, rgb, alpha;
       if (S.mode === 'photo') {
         W = clamp(Math.round(Number(widthIn.value) || 64), 8, MAX_SIDE);
         H = clamp(Math.round((W * S.src.height) / S.src.width), 1, MAX_SIDE);
         ({ rgb, alpha } = boxSample(S.src, W, H));
       } else {
         const cell = clamp(Math.round(Number(cellIn.value) || 1), 1, 64);
         const g = S.grid && S.grid.size === cell ? S.grid : { ox: 0, oy: 0 };
         ({ W, H, rgb, alpha } = sampleCenters(S.src, cell, g.ox, g.oy));
         if (W < 1 || H < 1) { setStatus(status, '⚠ Pixel troppo grande per questa immagine.', 'warn'); return null; }
         if (W > MAX_SIDE || H > MAX_SIDE) {
           setStatus(status, `⚠ Griglia troppo grande (${W} × ${H}). Aumenta la grandezza del pixel o usa "Rileva in automatico".`, 'warn');
           return null;
         }
       }
       const pal = buildPalette(rgb, alpha, W * H);
       let idx = mapToPalette(rgb, alpha, W, H, pal, S.mode === 'photo' ? ditherSel.value : 'none');
       if (outlineIn.checked && S.hasAlpha) idx = addOutline(idx, W, H, pal);
       const counts = new Array(pal.length).fill(0);
       idx.forEach((k) => { if (k >= 0) counts[k]++; });
       return { W, H, pal, idx, counts };
     }
   
     /* ---------- 10c. Disegno ---------- */
     /** Pixel art → canvas, ingrandita di "scale" volte senza sfocare */
     function artToCanvas(A, scale = 1) {
       const small = document.createElement('canvas');
       small.width = A.W;
       small.height = A.H;
       const ctx = small.getContext('2d');
       const img = ctx.createImageData(A.W, A.H);
       A.idx.forEach((k, i) => {
         if (k < 0) return; // trasparente
         const c = A.pal[k];
         img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
       });
       ctx.putImageData(img, 0, 0);
       if (scale === 1) return small;
       const big = document.createElement('canvas');
       big.width = A.W * scale;
       big.height = A.H * scale;
       const bctx = big.getContext('2d');
       bctx.imageSmoothingEnabled = false; // pixel netti, quadrati
       bctx.drawImage(small, 0, 0, big.width, big.height);
       return big;
     }
   
     function renderPreview() {
       const A = S.art;
       if (!A) return;
       const avail = Math.max(200, stage.clientWidth - 40);
       const sc = clamp(Math.min(Math.floor(avail / A.W), Math.floor(640 / A.H)), 1, 16);
       const dpr = window.devicePixelRatio || 1;
       canvas.width = Math.round(A.W * sc * dpr);
       canvas.height = Math.round(A.H * sc * dpr);
       canvas.style.width = `${A.W * sc}px`;
       canvas.style.height = `${A.H * sc}px`;
       const ctx = canvas.getContext('2d');
       ctx.imageSmoothingEnabled = false;
       ctx.clearRect(0, 0, canvas.width, canvas.height);
       ctx.drawImage(artToCanvas(A), 0, 0, canvas.width, canvas.height);
   
       if (gridToggle.checked && sc >= 4) {
         const step = sc * dpr;
         ctx.strokeStyle = 'rgba(17,17,17,.25)';
         ctx.lineWidth = 1;
         ctx.beginPath();
         for (let x = 1; x < A.W; x++) { const X = Math.round(x * step) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, canvas.height); }
         for (let y = 1; y < A.H; y++) { const Y = Math.round(y * step) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(canvas.width, Y); }
         ctx.stroke();
       }
     }
   
     const updateOutSize = () => {
       const s = Number(scaleSel.value);
       outSize.textContent = S.art ? `${S.art.W * s} × ${S.art.H * s} px` : '—';
     };
   
     function renderInfo(A) {
       const used = A.counts.filter((c) => c > 0).length;
       info.textContent = `${A.W} × ${A.H} pixel · ${used} colori`;
       heightOut.textContent = String(A.H);
       gridOut.textContent = `${A.W} × ${A.H}`;
       updateOutSize();
       swatches.replaceChildren(...A.pal
         .map((c, j) => ({ c, n: A.counts[j] }))
         .filter((o) => o.n > 0)
         .sort((a, b) => b.n - a.n)
         .map(({ c, n }) => {
           const hex = toHex(...c);
           return h('li', { class: 'px-swatch', title: `${hex} · ${n} pixel` }, h('span', { style: `background:${hex}` }), hex);
         }));
     }
   
     /** Ricalcola tutto (chiamata quando cambia un'opzione) */
     function regenerate() {
       if (!S.src) return;
       const A = build();
       if (!A) return;
       S.art = A;
       renderPreview();
       renderInfo(A);
       downloadBtn.disabled = false;
     }
     let timer;
     const schedule = () => { clearTimeout(timer); timer = setTimeout(regenerate, 120); };
   
     function runDetect() {
       if (!S.src) return;
       const g = detectPixelSize(S.src);
       if (!g) {
         S.grid = null;
         detectInfo.textContent = 'Non sembra pixel art ingrandita: imposta la grandezza a mano.';
         return;
       }
       S.grid = g;
       cellIn.value = g.size;
       detectInfo.textContent = `Rilevato: 1 pixel = ${g.size} px`;
     }
   
     /* ---------- 10d. Controlli ---------- */
     $$('input[name="px-mode"]', ws).forEach((radio) => {
       radio.addEventListener('change', () => {
         S.mode = radio.value;
         $$('.tech-panel[data-show]', ws).forEach((panel) => { panel.hidden = panel.dataset.show !== S.mode; });
         if (S.mode === 'clean' && !S.grid) runDetect();
         schedule();
       });
     });
     paletteSel.addEventListener('change', () => { colorsPanel.hidden = paletteSel.value !== 'auto'; schedule(); });
     colorsIn.addEventListener('input', () => { colorsOut.textContent = colorsIn.value; schedule(); });
     [widthIn, cellIn].forEach((el) => el.addEventListener('input', schedule));
     [ditherSel, outlineIn].forEach((el) => el.addEventListener('change', schedule));
     scaleSel.addEventListener('change', updateOutSize);
     gridToggle.addEventListener('change', renderPreview);
     detectBtn.addEventListener('click', () => { runDetect(); regenerate(); });
   
     /* ---------- 10e. Caricamento ---------- */
     setupDropzone($('#px-dropzone'), async (files) => {
       const file = files.find(isImage);
       if (!file) { setStatus(status, '✖ Seleziona un\'immagine (JPG, PNG, WebP…).', 'error'); return; }
       try {
         setStatus(status, 'Leggo l\'immagine…');
         // Niente sfondo: la trasparenza dei PNG resta (serve per il contorno e per gli sprite)
         const c = await fileToCanvas(file, { maxSide: 2048 });
         S.src = c.getContext('2d').getImageData(0, 0, c.width, c.height);
         c.width = c.height = 0;
         S.hasAlpha = false;
         for (let i = 3; i < S.src.data.length; i += 4) { if (S.src.data[i] < 250) { S.hasAlpha = true; break; } }
         outlineIn.disabled = !S.hasAlpha;
         if (!S.hasAlpha) outlineIn.checked = false;
         S.fileName = file.name;
         S.grid = null;
         detectBtn.disabled = false;
         detectInfo.textContent = '';
         fileLabel.textContent = `🖼 ${file.name} · ${S.src.width}×${S.src.height} px`;
         fileLabel.hidden = false;
         stageEmpty.hidden = true;
         canvas.hidden = false;
         setStatus(status, S.hasAlpha
           ? '✔ Pronto. L\'immagine ha lo sfondo trasparente: puoi aggiungere il contorno.'
           : '✔ Pronto. Cambia dimensione e palette: l\'anteprima si aggiorna da sola.', 'success');
         if (S.mode === 'clean') runDetect();
         regenerate();
       } catch (err) {
         console.error(err);
         setStatus(status, `✖ ${err.message}`, 'error');
       }
     });
   
     /* ---------- 10f. Esportazione ---------- */
     downloadBtn.addEventListener('click', () => runTask(downloadBtn, status, async () => {
       const s = Number(scaleSel.value);
       const out = artToCanvas(S.art, s);
       const blob = await canvasToBlob(out, 'image/png');
       out.width = out.height = 0;
       downloadBlob(blob, `${baseName(S.fileName) || 'immagine'}_pixelart_x${s}.png`);
       setStatus(status, `✔ PNG scaricato: ${S.art.W * s} × ${S.art.H * s} px (${formatBytes(blob.size)}).`, 'success');
     }));
   
     /* ---------- 10g. Ridimensionamento e visibilità ---------- */
     let resizeTimer;
     window.addEventListener('resize', () => {
       clearTimeout(resizeTimer);
       resizeTimer = setTimeout(() => { if (!ws.hidden) renderPreview(); }, 150);
     });
     toolHooks.pixel = () => requestAnimationFrame(renderPreview);
   }
   
   /* =============================================================
      11. AVVIO
      ============================================================= */
   function checkLibraries() {
     const libs = [['PDFLib', 'pdf-lib'], ['JSZip', 'JSZip'], ['pdfjsLib', 'pdf.js']];
     const missing = libs
       .filter(([g]) => !(window[g] || (g === 'pdfjsLib' && window['pdfjs-dist/build/pdf'])))
       .map(([, label]) => label);
     if (missing.length) {
       const banner = $('#lib-warning');
       banner.textContent = `⚠ Non riesco a caricare: ${missing.join(', ')}. Le librerie arrivano da internet (CDN): controlla la connessione e ricarica.`;
       banner.hidden = false;
     }
   }
   
   // Se un file viene lasciato fuori da una dropzone, il browser NON deve aprirlo
   window.addEventListener('dragover', (e) => e.preventDefault());
   window.addEventListener('drop', (e) => e.preventDefault());
   
   // Con "defer" il DOM è già pronto quando questo script viene eseguito
   checkLibraries();
   initPixel();
   window.addEventListener('hashchange', route);
   route();