/* =============================================================
   PixelTools — src/tools/crochet/tool.js
   TOOL — FOTO IN UNCINETTO: foto → schema C2C / Filet / Punto basso (PNG e PDF).
   - view: il markup del tool (view.html), inserito nella pagina
           solo la prima volta che il tool viene aperto
   - init: collega i comandi (riceve la <section> del tool)
   ============================================================= */
   import { luma, toHex, boxSample, quantize } from '../../core/pixel-engine.js';
   import { $, $$, h, clamp } from '../../core/dom.js';
   import { formatBytes, baseName, isImage, downloadBlob } from '../../core/files.js';
   import { fileToCanvas, canvasToBlob } from '../../core/images.js';
   import { setStatus, runTask, setupDropzone } from '../../core/ui.js';
   import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'; // libreria da npm (prima arrivava dalla CDN)
   import { CONFIG } from '../../core/config.js';
   import './style.css';
   import view from './view.html?raw';
   
   export { view };
   
   /* =============================================================
      9. TOOL 6 — FOTO IN UNCINETTO
      -------------------------------------------------------------
      Il "motore pixel" (lo riuseremo per il tool Pixel Art):
      1. La foto viene ridotta a una griglia: 1 cella = 1 punto.
         Ogni cella prende il colore MEDIO dei pixel che copre.
      2. I colori vengono ridotti a N con il "k-means": si cercano N
         colori rappresentativi e ogni cella prende il più vicino.
      3. Lo schema viene disegnato su un <canvas> con griglia, numeri
         e lettere; da lì si esporta in PNG o in PDF (pdf-lib).
      Tecniche:
      - C2C / Tapestry: celle quadrate, N colori
      - Filet: solo pieno/vuoto, decide una soglia di luminosità
      - Punto basso: il punto è più largo che alto → servono più
        righe; le calcoliamo dal campione (punti e righe in 10 cm)
      ============================================================= */
   export function init(ws, toolHooks) {
     const status = $('.status', ws);
     const fileLabel = $('#cr-filename');
     const widthIn = $('#cr-width');
     const rowsOut = $('#cr-rows');
     const colorsIn = $('#cr-colors');
     const colorsOut = $('#cr-colors-out');
     const threshIn = $('#cr-threshold');
     const threshOut = $('#cr-threshold-out');
     const invertIn = $('#cr-invert');
     const gaugeSt = $('#cr-gauge-st');
     const gaugeRows = $('#cr-gauge-rows');
     const symbolsIn = $('#cr-symbols');
     const techHint = $('#cr-tech-hint');
     const canvas = $('#cr-canvas');
     const stage = $('.cr-stage', ws);
     const stageEmpty = $('.stage-empty', ws);
     const info = $('#cr-info');
     const legendEl = $('#cr-legend');
     const pngBtn = $('#cr-png');
     const pdfBtn = $('#cr-pdf');
   
     const TECH = {
       c2c: { label: 'C2C / Tapestry', hint: 'Ogni quadretto è un blocco (C2C) o un punto (tapestry). Le lettere indicano il colore.' },
       filet: { label: 'Filet', hint: 'Nero = quadretto pieno, bianco = quadretto vuoto. Con la soglia scegli cosa diventa pieno.' },
       sc: { label: 'Punto basso', hint: 'Il punto basso è più largo che alto: lo schema ha più righe, così il lavoro finito non esce schiacciato.' },
     };
     const LETTERS = 'ABCDEFGHIJKLMNOP'; // una lettera per colore (max 16)
     const MAX_ROWS = 400;
   
     /** Stato del tool */
     const S = {
       srcData: null,   // ImageData della foto (ridotta a max 800 px)
       fileName: '',
       tech: 'c2c',     // 'c2c' | 'filet' | 'sc'
       pattern: null,   // schema calcolato
     };
   
     /* ---------- 9a. Calcoli (boxSample, quantize, luma, toHex: vedi src/core/pixel-engine.js) ---------- */
     const gauge = () => ({
       st: clamp(Number(gaugeSt.value) || 20, 1, 100),
       rows: clamp(Number(gaugeRows.value) || 24, 1, 100),
     });
   
     /** Altezza ÷ larghezza di un punto (1 = quadrato) */
     function stitchRatio() {
       if (S.tech !== 'sc') return 1;
       const g = gauge();
       return g.st / g.rows; // larghezza punto = 10/st cm, altezza = 10/rows cm
     }
   
     /** Colonne e righe dello schema */
     function gridSize() {
       const W = clamp(Math.round(Number(widthIn.value) || 40), 10, 200);
       const { width: sw, height: sh } = S.srcData;
       const raw = Math.round((W * sh) / sw / stitchRatio());
       return { W, H: clamp(raw, 1, MAX_ROWS), capped: raw > MAX_ROWS };
     }
   
     /** Calcola lo schema completo: celle + palette ordinata dal colore più usato */
     function buildPattern() {
       const { W, H } = gridSize();
       const n = W * H;
       const px = boxSample(S.srcData, W, H).rgb;
       let colors;
       let labels;
   
       if (S.tech === 'filet') {
         const t = Number(threshIn.value);
         labels = new Uint8Array(n);
         for (let i = 0; i < n; i++) {
           const dark = luma(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]) < t;
           labels[i] = dark !== invertIn.checked ? 1 : 0; // 1 = pieno
         }
         colors = [{ rgb: [255, 255, 255], name: 'Vuoto' }, { rgb: [17, 17, 17], name: 'Pieno' }];
       } else {
         const q = quantize(px, n, Number(colorsIn.value));
         labels = q.labels;
         colors = q.centers.map((c) => ({ rgb: c.map(Math.round) }));
       }
   
       // Conta i punti per colore, ordina dal più usato e rinumera
       const counts = new Array(colors.length).fill(0);
       labels.forEach((l) => { counts[l]++; });
       const order = colors.map((_, j) => j).filter((j) => counts[j] > 0).sort((a, b) => counts[b] - counts[a]);
       const remap = new Uint8Array(colors.length);
       order.forEach((j, idx) => { remap[j] = idx; });
   
       const palette = order.map((j, idx) => {
         const [r, g, b] = colors[j].rgb;
         return {
           r, g, b,
           hex: toHex(r, g, b),
           count: counts[j],
           letter: LETTERS[idx],
           name: colors[j].name || `Colore ${idx + 1}`,
           ink: luma(r, g, b) > 140 ? '#111111' : '#ffffff', // lettera leggibile sul colore
         };
       });
       return { W, H, ratio: stitchRatio(), cells: labels.map((l) => remap[l]), palette, tech: S.tech };
     }
   
     /* ---------- 9b. Disegno dello schema ---------- */
     /**
      * Disegna lo schema su un canvas.
      * cell = larghezza di un punto in px; dpr = densità pixel dello schermo.
      * Righe numerate dal basso (riga 1), colonne da sinistra.
      */
     function drawPattern(target, P, { cell = 16, symbols = true, dpr = 1 } = {}) {
       const cw = cell;
       const ch = Math.max(4, Math.round(cell * P.ratio));
       const pad = 6;
       const num = Math.max(24, Math.round(cell * 2)); // spazio per i numeri
       const gw = P.W * cw;
       const gh = P.H * ch;
       const cssW = pad + gw + num;
       const cssH = pad + gh + num;
   
       target.width = Math.round(cssW * dpr);
       target.height = Math.round(cssH * dpr);
       const ctx = target.getContext('2d');
       ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
       ctx.fillStyle = '#ffffff';
       ctx.fillRect(0, 0, cssW, cssH);
   
       // Celle colorate
       for (let y = 0; y < P.H; y++) {
         for (let x = 0; x < P.W; x++) {
           ctx.fillStyle = P.palette[P.cells[y * P.W + x]].hex;
           ctx.fillRect(pad + x * cw, pad + y * ch, cw, ch);
         }
       }
   
       // Lettere dei colori (solo se le celle sono abbastanza grandi; nel filet bastano pieno/vuoto)
       if (symbols && P.tech !== 'filet' && cw >= 10 && ch >= 9) {
         ctx.font = `600 ${Math.round(Math.min(cw, ch) * 0.62)}px system-ui, sans-serif`;
         ctx.textAlign = 'center';
         ctx.textBaseline = 'middle';
         for (let y = 0; y < P.H; y++) {
           for (let x = 0; x < P.W; x++) {
             const c = P.palette[P.cells[y * P.W + x]];
             ctx.fillStyle = c.ink;
             ctx.fillText(c.letter, pad + x * cw + cw / 2, pad + y * ch + ch / 2 + 0.5);
           }
         }
       }
   
       // Griglia: sottile ogni punto, grigia ogni 5, nera ogni 10 (e sui bordi)
       const LINE = [[1, 'rgba(17,17,17,.18)'], [1, 'rgba(17,17,17,.55)'], [2, '#111111']];
       const level = (k, max) => (k === 0 || k === max || k % 10 === 0 ? 2 : k % 5 === 0 ? 1 : 0);
       const stroke = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
       for (const lv of [0, 1, 2]) { // prima le sottili, poi le spesse sopra
         const [w, color] = LINE[lv];
         const off = w === 1 ? 0.5 : 0; // linee da 1px nitide
         ctx.lineWidth = w;
         ctx.strokeStyle = color;
         for (let x = 0; x <= P.W; x++) {
           if (level(x, P.W) === lv) stroke(pad + x * cw + off, pad, pad + x * cw + off, pad + gh);
         }
         for (let y = 0; y <= P.H; y++) {
           if (level(P.H - y, P.H) === lv) stroke(pad, pad + y * ch + off, pad + gw, pad + y * ch + off);
         }
       }
   
       // Numeri: righe a destra (dal basso), colonne sotto
       ctx.fillStyle = '#111111';
       ctx.font = `${clamp(Math.round(cell * 0.6), 9, 13)}px system-ui, sans-serif`;
       ctx.textAlign = 'left';
       ctx.textBaseline = 'middle';
       for (let r = 1; r <= P.H; r++) {
         if (r === 1 || r % 5 === 0) ctx.fillText(String(r), pad + gw + 6, pad + (P.H - r) * ch + ch / 2);
       }
       ctx.textAlign = 'center';
       ctx.textBaseline = 'top';
       for (let c = 1; c <= P.W; c++) {
         if (c === 1 || c % 5 === 0) ctx.fillText(String(c), pad + (c - 1) * cw + cw / 2, pad + gh + 6);
       }
     }
   
     /** Anteprima: celle grandi quanto basta per stare nel riquadro */
     function renderPreview() {
       const P = S.pattern;
       if (!P) return;
       const avail = Math.max(240, stage.clientWidth - 40);
       const cell = clamp(Math.floor((avail - 40) / P.W), 6, 22);
       const dpr = window.devicePixelRatio || 1;
       drawPattern(canvas, P, { cell, symbols: symbolsIn.checked, dpr });
       canvas.style.width = `${canvas.width / dpr}px`;
       canvas.style.height = `${canvas.height / dpr}px`;
     }
   
     function renderLegend(P) {
       legendEl.replaceChildren(...P.palette.map((c) => h('li', { class: 'legend-item' },
         h('span', { class: 'legend-swatch', style: `background:${c.hex}`, 'aria-hidden': 'true' }),
         h('span', { class: 'legend-letter' }, c.letter),
         h('span', { class: 'legend-name' }, c.name, h('small', {}, c.hex)),
         h('span', { class: 'legend-count' }, `${c.count} punti`))));
     }
   
     function renderInfo(P) {
       let txt = `${P.W} × ${P.H} punti · ${P.palette.length} colori · ${P.W * P.H} punti totali`;
       if (P.tech === 'sc') {
         const g = gauge();
         txt += ` · circa ${Math.round((P.W * 10) / g.st)} × ${Math.round((P.H * 10) / g.rows)} cm`;
       }
       info.textContent = txt;
     }
   
     /** Ricalcola tutto (chiamata quando cambia un'opzione) */
     function regenerate() {
       if (!S.srcData) { rowsOut.textContent = '—'; return; }
       const size = gridSize();
       rowsOut.textContent = String(size.H);
       S.pattern = buildPattern();
       renderPreview();
       renderLegend(S.pattern);
       renderInfo(S.pattern);
       pngBtn.disabled = false;
       pdfBtn.disabled = false;
       if (size.capped) setStatus(status, `⚠ Altezza limitata a ${MAX_ROWS} righe: riduci la larghezza.`, 'warn');
     }
     let timer;
     const schedule = () => { clearTimeout(timer); timer = setTimeout(regenerate, 120); };
   
     /* ---------- 9c. Controlli ---------- */
     $$('input[name="cr-tech"]', ws).forEach((radio) => {
       radio.addEventListener('change', () => {
         S.tech = radio.value;
         $$('.tech-panel', ws).forEach((panel) => {
           panel.hidden = !panel.dataset.show.split(' ').includes(S.tech);
         });
         techHint.textContent = TECH[S.tech].hint;
         schedule();
       });
     });
     techHint.textContent = TECH.c2c.hint;
   
     colorsIn.addEventListener('input', () => { colorsOut.textContent = colorsIn.value; schedule(); });
     threshIn.addEventListener('input', () => { threshOut.textContent = threshIn.value; schedule(); });
     [widthIn, gaugeSt, gaugeRows].forEach((el) => el.addEventListener('input', schedule));
     invertIn.addEventListener('change', schedule);
     symbolsIn.addEventListener('change', renderPreview);
   
     /* ---------- 9d. Caricamento foto ---------- */
     setupDropzone($('#cr-dropzone'), async (files) => {
       const file = files.find(isImage);
       if (!file) { setStatus(status, '✖ Seleziona un\'immagine (JPG, PNG, WebP…).', 'error'); return; }
       try {
         setStatus(status, 'Leggo la foto…');
         // max 800 px: più che sufficiente per uno schema da 200 punti, e veloce
         const c = await fileToCanvas(file, { maxSide: 800, background: '#ffffff' });
         S.srcData = c.getContext('2d').getImageData(0, 0, c.width, c.height);
         c.width = c.height = 0;
         S.fileName = file.name;
         fileLabel.textContent = `🖼 ${file.name} · ${formatBytes(file.size)}`;
         fileLabel.hidden = false;
         stageEmpty.hidden = true;
         canvas.hidden = false;
         setStatus(status, '✔ Schema pronto. Cambia larghezza e colori: l\'anteprima si aggiorna da sola.', 'success');
         regenerate();
       } catch (err) {
         console.error(err);
         setStatus(status, `✖ ${err.message}`, 'error');
       }
     });
   
     /* ---------- 9e. Esportazione ---------- */
     /** Celle grandi per la stampa, senza superare ~4000 px */
     const exportCell = (P) => clamp(Math.floor(4000 / Math.max(P.W, P.H * P.ratio)), 8, 24);
     const fileStem = () => `${baseName(S.fileName) || 'foto'}_schema-uncinetto`;
   
     pngBtn.addEventListener('click', () => runTask(pngBtn, status, async () => {
       const out = document.createElement('canvas');
       drawPattern(out, S.pattern, { cell: exportCell(S.pattern), symbols: symbolsIn.checked });
       const blob = await canvasToBlob(out, 'image/png');
       out.width = out.height = 0;
       downloadBlob(blob, `${fileStem()}.png`);
       setStatus(status, `✔ PNG scaricato (${formatBytes(blob.size)}).`, 'success');
     }));
   
     pdfBtn.addEventListener('click', () => runTask(pdfBtn, status, async () => {
       const P = S.pattern;
       const pdf = await PDFDocument.create();
       const font = await pdf.embedFont(StandardFonts.Helvetica);
       const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
       const [pw, ph] = CONFIG.a4;
       const m = 36;
       const black = rgb(0.07, 0.07, 0.07);
   
       // Pagina 1: lo schema (sempre con le lettere, utili in stampa)
       let page = pdf.addPage([pw, ph]);
       page.drawText('Schema uncinetto', { x: m, y: ph - m - 18, size: 20, font: bold, color: black });
       page.drawText(`${TECH[P.tech].label}  -  ${P.W} x ${P.H} punti  -  ${P.palette.length} colori`,
         { x: m, y: ph - m - 36, size: 10, font, color: black });
       const img = document.createElement('canvas');
       drawPattern(img, P, { cell: exportCell(P), symbols: true });
       const png = await pdf.embedPng(await (await canvasToBlob(img, 'image/png')).arrayBuffer());
       img.width = img.height = 0;
       const top = ph - m - 50;
       const scale = Math.min((pw - 2 * m) / png.width, (top - m) / png.height, 1);
       page.drawImage(png, { x: m, y: top - png.height * scale, width: png.width * scale, height: png.height * scale });
   
       // Pagina 2: legenda filati
       page = pdf.addPage([pw, ph]);
       let y = ph - m - 18;
       page.drawText('Legenda filati', { x: m, y, size: 18, font: bold, color: black });
       y -= 36;
       for (const c of P.palette) {
         if (y < m + 40) { page = pdf.addPage([pw, ph]); y = ph - m - 18; }
         page.drawRectangle({
           x: m, y: y - 5, width: 18, height: 18,
           color: rgb(c.r / 255, c.g / 255, c.b / 255), borderColor: black, borderWidth: 0.8,
         });
         page.drawText(c.letter, { x: m + 28, y, size: 12, font: bold, color: black });
         page.drawText(`${c.name}   ${c.hex}`, { x: m + 50, y, size: 11, font, color: black });
         page.drawText(`${c.count} punti`, { x: pw - m - 90, y, size: 11, font, color: black });
         y -= 28;
       }
   
       // Note in fondo (con a capo automatico)
       const wrap = (text, size, maxW) => {
         const lines = [];
         let cur = '';
         for (const word of text.split(' ')) {
           const test = cur ? `${cur} ${word}` : word;
           if (cur && font.widthOfTextAtSize(test, size) > maxW) { lines.push(cur); cur = word; } else cur = test;
         }
         if (cur) lines.push(cur);
         return lines;
       };
       const notes = [
         'Le righe si contano dal basso (riga 1). Linee grigie ogni 5 punti, linee nere ogni 10.',
         TECH[P.tech].hint,
       ];
       if (P.tech === 'sc') {
         const g = gauge();
         notes.push(`Campione: ${g.st} punti x ${g.rows} righe in 10 cm. Misura finale circa ${Math.round((P.W * 10) / g.st)} x ${Math.round((P.H * 10) / g.rows)} cm.`);
       }
       notes.push('Creato con PixelTools - tutto nel browser, nessun upload.');
       y -= 12;
       for (const note of notes) {
         for (const line of wrap(note, 9, pw - 2 * m)) {
           if (y < m) { page = pdf.addPage([pw, ph]); y = ph - m - 18; }
           page.drawText(line, { x: m, y, size: 9, font, color: black });
           y -= 13;
         }
         y -= 4;
       }
   
       const bytes = await pdf.save();
       downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${fileStem()}.pdf`);
       setStatus(status, `✔ PDF scaricato: schema + legenda (${formatBytes(bytes.length)}).`, 'success');
     }));
   
     /* ---------- 9f. Ridimensionamento e visibilità ---------- */
     let resizeTimer;
     window.addEventListener('resize', () => {
       clearTimeout(resizeTimer);
       resizeTimer = setTimeout(() => { if (!ws.hidden) renderPreview(); }, 150);
     });
     // Quando il tool diventa visibile il riquadro ha la sua larghezza reale
     toolHooks.crochet = () => requestAnimationFrame(renderPreview);
   }