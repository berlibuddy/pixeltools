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

   /* =============================================================
      0. CONFIGURAZIONE
      ============================================================= */
   const CONFIG = {
     // pdf.js lavora in un "worker" separato: deve avere la STESSA versione del file principale
     pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
     // A4 in punti PDF (1 pt = 1/72 di pollice)
     a4: [595.28, 841.89],
   };
   
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
    *   view → il markup (view.html) · init(ws) → collega i comandi
    * I tool non ancora spostati restano qui sotto in app.js e in index.html.
    */
   const LAZY_TOOLS = {
     merge: () => import('./src/tools/merge/tool.js'),
   };
   const loadingTools = {}; // id → Promise: ogni tool si carica una volta sola
   
   function loadTool(id) {
     if (!LAZY_TOOLS[id]) return Promise.resolve();
     loadingTools[id] ??= LAZY_TOOLS[id]().then(({ view, init }) => {
       const tpl = document.createElement('template');
       tpl.innerHTML = view; // markup statico nostro (view.html): sicuro
       const ws = tpl.content.querySelector('.workspace');
       $('main').append(ws);
       init(ws);
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
      5. TOOL 2 — FIRMA & ANNOTAZIONI PDF
      -------------------------------------------------------------
      Come funziona:
      - pdf.js disegna la pagina in un <canvas> (solo anteprima).
      - Sopra c'è un livello trasparente: cliccando si crea un elemento
        (firma / data / testo) salvato in "punti PDF" (pt), con origine in
        ALTO a sinistra della pagina visualizzata.
      - All'esportazione, pdf-lib apre il PDF originale e disegna gli elementi.
        viewport.convertToPdfPoint() di pdf.js converte le coordinate dello
        schermo in coordinate PDF (origine in BASSO a sinistra), gestendo anche
        pagine ruotate e con margini (CropBox).
      ============================================================= */
   function initSign() {
     const ws = $('#tool-sign');
     const status = $('.status', ws);
     const stageEmpty = $('.stage-empty', ws);
     const pageWrap = $('.page-wrap', ws);
     const pdfCanvas = $('#pdf-canvas');
     const layer = $('#overlay-layer');
     const pageInfo = $('#page-info');
     const prevBtn = $('#page-prev');
     const nextBtn = $('#page-next');
     const exportBtn = $('#sign-export');
     const resetBtn = $('#sign-reset');
     const fileLabel = $('#sign-filename');
   
     const pad = $('#sig-pad');
     const padWrap = pad.parentElement;
     const padCtx = pad.getContext('2d');
     const thickness = $('#sig-thickness');
     const sigWidth = $('#sig-width');
     const sigWidthOut = $('#sig-width-out');
     const fontSize = $('#font-size');
     const fontSizeOut = $('#font-size-out');
     const inkSelect = $('#ink-color');
     const dateFormat = $('#date-format');
     const textValue = $('#text-value');
   
     /** Stato del tool */
     const S = {
       pdfBytes: null,        // byte originali (per pdf-lib)
       fileName: '',
       pdfjsDoc: null,        // documento pdf.js (per l'anteprima)
       pageIndex: 0,          // pagina visualizzata (da 0)
       viewports: new Map(),  // pagina → viewport pdf.js a scala 1 (dimensioni in pt)
       placements: [],        // elementi posizionati
       selectedId: null,
       nextId: 1,
       mode: 'signature',     // 'signature' | 'date' | 'text'
       signature: null,       // { dataUrl, ratio } firma ritagliata
       hasInk: false,
       renderTask: null,
     };
   
     /* ---------- 5a. Formati della data di oggi ---------- */
     const now = new Date();
     const pad2 = (n) => String(n).padStart(2, '0');
     const dateOptions = [
       now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }), // 17/10/2026
       now.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }),    // 17 ottobre 2026
       `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,              // 2026-10-17
     ];
     dateFormat.replaceChildren(...dateOptions.map((d) => h('option', { value: d }, d)));
   
     /* ---------- 5b. Scelta della modalità (firma / data / testo) ---------- */
     $$('input[name="sign-mode"]', ws).forEach((radio) => {
       radio.addEventListener('change', () => {
         S.mode = radio.value;
         $$('.mode-panel', ws).forEach((panel) => {
           panel.hidden = !panel.dataset.mode.split(' ').includes(S.mode);
         });
         if (S.mode === 'text') textValue.focus();
       });
     });
   
     /* ---------- 5c. Canvas della firma ---------- */
   
     // Il canvas deve avere una risoluzione interna = dimensione a schermo × densità pixel,
     // altrimenti il tratto risulta sfocato. Lo ridimensioniamo solo se è vuoto
     // (ridimensionare un canvas lo cancella).
     function sizePad() {
       if (S.hasInk) return;
       const dpr = window.devicePixelRatio || 1;
       const w = Math.round(pad.clientWidth * dpr);
       const hgt = Math.round(pad.clientHeight * dpr);
       if (!w || (pad.width === w && pad.height === hgt)) return;
       pad.width = w;
       pad.height = hgt;
     }
   
     // Coordinate del puntatore → coordinate interne del canvas
     function padPoint(e) {
       const r = pad.getBoundingClientRect();
       return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) };
     }
   
     let drawing = false;
     let last = null;     // ultimo punto
     let lastMid = null;  // ultimo punto medio (per curve morbide)
   
     pad.addEventListener('pointerdown', (e) => {
       e.preventDefault();
       sizePad();
       pad.setPointerCapture(e.pointerId); // continua a disegnare anche se esci dal riquadro
       drawing = true;
       last = lastMid = padPoint(e);
   
       const dpr = window.devicePixelRatio || 1;
       padCtx.lineCap = 'round';
       padCtx.lineJoin = 'round';
       padCtx.strokeStyle = padCtx.fillStyle = inkSelect.value;
       padCtx.lineWidth = Number(thickness.value) * dpr;
   
       // un puntino, così anche un semplice "tap" lascia il segno
       padCtx.beginPath();
       padCtx.arc(last.x, last.y, padCtx.lineWidth / 2, 0, Math.PI * 2);
       padCtx.fill();
     });
   
     pad.addEventListener('pointermove', (e) => {
       if (!drawing) return;
       const p = padPoint(e);
       const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
       // Curva quadratica tra i punti medi = tratto morbido, senza spigoli
       padCtx.beginPath();
       padCtx.moveTo(lastMid.x, lastMid.y);
       padCtx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
       padCtx.stroke();
       last = p;
       lastMid = mid;
     });
   
     const endStroke = () => {
       if (!drawing) return;
       drawing = false;
       S.hasInk = true;
       padWrap.classList.add('has-ink');
       captureSignature();
     };
     pad.addEventListener('pointerup', endStroke);
     pad.addEventListener('pointercancel', endStroke);
   
     // Ritaglia la firma eliminando lo spazio vuoto attorno → PNG trasparente
     function captureSignature() {
       const { width: w, height: hgt } = pad;
       const data = padCtx.getImageData(0, 0, w, hgt).data;
       let minX = w, minY = hgt, maxX = -1, maxY = -1;
       for (let y = 0; y < hgt; y++) {
         for (let x = 0; x < w; x++) {
           if (data[(y * w + x) * 4 + 3] > 0) { // canale alpha: c'è inchiostro
             if (x < minX) minX = x;
             if (x > maxX) maxX = x;
             if (y < minY) minY = y;
             if (y > maxY) maxY = y;
           }
         }
       }
       if (maxX < 0) { S.signature = null; return; }
   
       const margin = 4;
       minX = Math.max(0, minX - margin); minY = Math.max(0, minY - margin);
       maxX = Math.min(w - 1, maxX + margin); maxY = Math.min(hgt - 1, maxY + margin);
       const cw = maxX - minX + 1;
       const ch = maxY - minY + 1;
   
       const out = document.createElement('canvas');
       out.width = cw;
       out.height = ch;
       out.getContext('2d').drawImage(pad, minX, minY, cw, ch, 0, 0, cw, ch);
       S.signature = { dataUrl: out.toDataURL('image/png'), ratio: ch / cw };
     }
   
     $('#sig-clear').addEventListener('click', () => {
       padCtx.clearRect(0, 0, pad.width, pad.height);
       S.hasInk = false;
       S.signature = null;
       padWrap.classList.remove('has-ink');
       sizePad();
     });
   
     /* ---------- 5d. Caricamento e anteprima del PDF (pdf.js) ---------- */
     setupDropzone($('#sign-dropzone'), async (files) => {
       const file = files.find(isPdf);
       if (!file) { setStatus(status, '✖ Seleziona un file PDF.', 'error'); return; }
       try {
         await loadPdf(file);
       } catch (err) {
         console.error(err);
         setStatus(status, `✖ ${err.message}`, 'error');
       }
     });
   
     async function loadPdf(file) {
       const pdfjs = requireLib('pdfjsLib', 'pdf.js');
       pdfjs.GlobalWorkerOptions.workerSrc = CONFIG.pdfjsWorker;
       setStatus(status, 'Apro il PDF…');
   
       const bytes = new Uint8Array(await file.arrayBuffer());
       let doc;
       try {
         // .slice(): pdf.js "consuma" il buffer che riceve, a noi serve intatto per pdf-lib
         doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
       } catch (err) {
         throw new Error(err?.name === 'PasswordException' ? 'Il PDF è protetto da password.' : 'Impossibile leggere questo PDF.');
       }
   
       S.pdfjsDoc?.destroy();
       Object.assign(S, {
         pdfBytes: bytes, fileName: file.name, pdfjsDoc: doc,
         pageIndex: 0, placements: [], viewports: new Map(), selectedId: null,
       });
   
       fileLabel.textContent = `📄 ${file.name} · ${doc.numPages} pag.`;
       fileLabel.hidden = false;
       stageEmpty.hidden = true;
       pageWrap.hidden = false;
   
       await renderPage();
       updateButtons();
       setStatus(status, 'PDF caricato. Scegli Firma, Data o Testo e clicca sulla pagina.', 'info');
     }
   
     async function renderPage() {
       if (!S.pdfjsDoc) return;
       const page = await S.pdfjsDoc.getPage(S.pageIndex + 1);
       const base = page.getViewport({ scale: 1 }); // scala 1 → dimensioni in punti PDF
       S.viewports.set(S.pageIndex, base);
   
       // Risoluzione adatta allo schermo (nitida anche su display retina)
       const targetPx = (pageWrap.clientWidth || 800) * (window.devicePixelRatio || 1);
       const viewport = page.getViewport({ scale: Math.min(3, targetPx / base.width) });
   
       S.renderTask?.cancel(); // annulla un rendering precedente ancora in corso
       pdfCanvas.width = Math.floor(viewport.width);
       pdfCanvas.height = Math.floor(viewport.height);
       renderOverlays();
   
       const task = page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport });
       S.renderTask = task;
       try {
         await task.promise;
       } catch (err) {
         if (err?.name !== 'RenderingCancelledException') throw err;
       }
     }
   
     function goToPage(delta) {
       const n = S.pdfjsDoc?.numPages || 0;
       const next = S.pageIndex + delta;
       if (next < 0 || next >= n) return;
       S.pageIndex = next;
       S.selectedId = null;
       renderPage().catch((err) => setStatus(status, `✖ ${err.message}`, 'error'));
     }
     prevBtn.addEventListener('click', () => goToPage(-1));
     nextBtn.addEventListener('click', () => goToPage(1));
   
     /* ---------- 5e. Elementi posizionati sopra la pagina ---------- */
   
     /** Pixel a schermo per ogni punto PDF */
     const pxPerPt = () => pdfCanvas.clientWidth / S.viewports.get(S.pageIndex).width;
     const selected = () => S.placements.find((p) => p.id === S.selectedId);
   
     function renderOverlays() {
       const base = S.viewports.get(S.pageIndex);
       if (!base) return;
       const k = pxPerPt();
   
       layer.replaceChildren(...S.placements.filter((p) => p.page === S.pageIndex).map((p) => {
         const el = h('div', {
           class: `placed${p.id === S.selectedId ? ' is-selected' : ''}`,
           dataset: { id: p.id },
           tabindex: 0,
           'aria-label': p.type === 'signature' ? 'Firma' : `Testo: ${p.text}`,
         });
         el.style.left = `${p.x * k}px`;
         el.style.top = `${p.y * k}px`;
   
         if (p.type === 'signature') {
           el.style.width = `${p.w * k}px`;
           el.style.height = `${p.h * k}px`;
           el.append(h('img', { src: p.dataUrl, alt: '', draggable: 'false' }));
         } else {
           el.style.fontSize = `${p.size * k}px`;
           el.style.color = p.color;
           el.append(p.text);
         }
         el.append(h('button', { class: 'placed-del', type: 'button', 'data-del': '', 'aria-label': 'Elimina elemento' }, '×'));
         return el;
       }));
       updatePager();
     }
   
     function updatePager() {
       const n = S.pdfjsDoc?.numPages || 0;
       const here = S.placements.filter((p) => p.page === S.pageIndex).length;
       pageInfo.textContent = n ? `Pagina ${S.pageIndex + 1} / ${n}${here ? ` · ${here} elem.` : ''}` : '—';
       prevBtn.disabled = S.pageIndex <= 0;
       nextBtn.disabled = S.pageIndex >= n - 1;
     }
   
     function updateButtons() {
       const empty = S.placements.length === 0;
       exportBtn.disabled = empty;
       resetBtn.disabled = empty;
     }
   
     function markSelected(id) {
       S.selectedId = id;
       $$('.placed', layer).forEach((n) => n.classList.toggle('is-selected', Number(n.dataset.id) === id));
       // Allinea i controlli all'elemento selezionato
       const p = selected();
       if (p?.type === 'signature') { sigWidth.value = Math.round(p.w); sigWidthOut.textContent = `${sigWidth.value} pt`; }
       if (p?.type === 'text') { fontSize.value = p.size; fontSizeOut.textContent = `${p.size} pt`; inkSelect.value = p.color; }
     }
   
     /** Crea un nuovo elemento centrato nel punto cliccato (cx, cy in pt) */
     function addPlacement(cx, cy) {
       const base = S.viewports.get(S.pageIndex);
       let p;
   
       if (S.mode === 'signature') {
         if (!S.signature) { setStatus(status, '✎ Prima disegna la firma nel riquadro a sinistra.', 'warn'); return; }
         const w = Number(sigWidth.value);
         const hgt = w * S.signature.ratio;
         // ogni elemento conserva la SUA copia della firma
         p = { type: 'signature', dataUrl: S.signature.dataUrl, w, h: hgt, x: cx - w / 2, y: cy - hgt / 2 };
         p.x = clamp(p.x, 0, base.width - w);
         p.y = clamp(p.y, 0, base.height - hgt);
       } else {
         const text = S.mode === 'date' ? dateFormat.value : textValue.value.trim();
         if (!text) { setStatus(status, '✎ Scrivi prima il testo da inserire.', 'warn'); textValue.focus(); return; }
         const size = Number(fontSize.value);
         p = { type: 'text', text, size, color: inkSelect.value, x: cx, y: cy - size / 2 };
         p.x = clamp(p.x, 0, base.width - size);
         p.y = clamp(p.y, 0, base.height - size);
       }
   
       p.id = S.nextId++;
       p.page = S.pageIndex;
       S.placements.push(p);
       S.selectedId = p.id;
       renderOverlays();
       updateButtons();
       setStatus(status, `✔ Elemento aggiunto (${S.placements.length} in totale). Trascinalo per spostarlo.`, 'success');
     }
   
     function removePlacement(id) {
       S.placements = S.placements.filter((p) => p.id !== id);
       if (S.selectedId === id) S.selectedId = null;
       renderOverlays();
       updateButtons();
     }
   
     // Click su un punto vuoto della pagina → posiziona; click su ✕ → elimina
     layer.addEventListener('click', (e) => {
       const del = e.target.closest('[data-del]');
       if (del) { removePlacement(Number(del.closest('.placed').dataset.id)); return; }
       if (e.target.closest('.placed')) return; // click su un elemento esistente: gestito dal drag
       if (!S.viewports.has(S.pageIndex)) return;
       const r = layer.getBoundingClientRect();
       const k = pxPerPt();
       addPlacement((e.clientX - r.left) / k, (e.clientY - r.top) / k);
     });
   
     // Trascinamento (mouse, dito o penna grazie ai Pointer Events)
     layer.addEventListener('pointerdown', (e) => {
       const el = e.target.closest('.placed');
       if (!el || e.target.closest('[data-del]')) return;
       e.preventDefault();
   
       const p = S.placements.find((x) => x.id === Number(el.dataset.id));
       markSelected(p.id);
       el.focus({ preventScroll: true });
   
       const base = S.viewports.get(S.pageIndex);
       const k = pxPerPt();
       const wPt = el.offsetWidth / k;   // dimensioni reali dell'elemento in pt
       const hPt = el.offsetHeight / k;
       const start = { x: e.clientX, y: e.clientY, px: p.x, py: p.y };
       el.setPointerCapture(e.pointerId);
   
       const onMove = (ev) => {
         p.x = clamp(start.px + (ev.clientX - start.x) / k, 0, base.width - wPt);
         p.y = clamp(start.py + (ev.clientY - start.y) / k, 0, base.height - hPt);
         el.style.left = `${p.x * k}px`;
         el.style.top = `${p.y * k}px`;
       };
       const onUp = () => {
         el.removeEventListener('pointermove', onMove);
         el.removeEventListener('pointerup', onUp);
         el.removeEventListener('pointercancel', onUp);
       };
       el.addEventListener('pointermove', onMove);
       el.addEventListener('pointerup', onUp);
       el.addEventListener('pointercancel', onUp);
     });
   
     // Tasto Canc/Backspace elimina l'elemento selezionato
     document.addEventListener('keydown', (e) => {
       if (ws.hidden || S.selectedId == null) return;
       if (e.target.matches('input, textarea, select')) return;
       if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePlacement(S.selectedId); }
     });
   
     // I controlli modificano anche l'elemento selezionato
     sigWidth.addEventListener('input', () => {
       sigWidthOut.textContent = `${sigWidth.value} pt`;
       const p = selected();
       if (p?.type === 'signature') {
         const ratio = p.h / p.w;
         p.w = Number(sigWidth.value);
         p.h = p.w * ratio;
         renderOverlays();
       }
     });
     fontSize.addEventListener('input', () => {
       fontSizeOut.textContent = `${fontSize.value} pt`;
       const p = selected();
       if (p?.type === 'text') { p.size = Number(fontSize.value); renderOverlays(); }
     });
     inkSelect.addEventListener('change', () => {
       const p = selected();
       if (p?.type === 'text') { p.color = inkSelect.value; renderOverlays(); }
     });
   
     resetBtn.addEventListener('click', () => {
       S.placements = [];
       S.selectedId = null;
       renderOverlays();
       updateButtons();
       setStatus(status, 'Tutti gli elementi sono stati rimossi.', 'info');
     });
   
     /* ---------- 5f. Esportazione con pdf-lib ---------- */
     function hexToRgb(hex) {
       const n = parseInt(hex.slice(1), 16);
       return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
     }
   
     exportBtn.addEventListener('click', () => runTask(exportBtn, status, async () => {
       const { PDFDocument, StandardFonts, degrees } = requireLib('PDFLib', 'pdf-lib');
   
       let doc;
       try {
         doc = await PDFDocument.load(S.pdfBytes);
       } catch {
         throw new Error('pdf-lib non riesce a modificare questo PDF (forse è protetto).');
       }
   
       const font = await doc.embedFont(StandardFonts.Helvetica);
       const embedded = new Map(); // la stessa firma usata più volte viene incorporata una volta sola
   
       for (const p of S.placements) {
         const page = doc.getPage(p.page);
         const vp = S.viewports.get(p.page);
         // Se la pagina è ruotata, ruotiamo anche l'elemento così appare dritto
         const rotate = degrees(page.getRotation().angle);
   
         if (p.type === 'signature') {
           if (!embedded.has(p.dataUrl)) embedded.set(p.dataUrl, await doc.embedPng(p.dataUrl));
           // pdf-lib disegna le immagini a partire dall'angolo in BASSO a sinistra
           const [x, y] = vp.convertToPdfPoint(p.x, p.y + p.h);
           page.drawImage(embedded.get(p.dataUrl), { x, y, width: p.w, height: p.h, rotate });
         } else {
           // drawText usa la "linea di base" del testo: ~85% dell'altezza dall'alto
           const [x, y] = vp.convertToPdfPoint(p.x, p.y + p.size * 0.85);
           try {
             page.drawText(p.text, { x, y, size: p.size, font, color: hexToRgb(p.color), rotate });
           } catch {
             throw new Error(`Il testo "${p.text}" contiene caratteri non supportati dal font standard (es. emoji).`);
           }
         }
       }
   
       const out = await doc.save();
       downloadBlob(new Blob([out], { type: 'application/pdf' }), `${baseName(S.fileName)}_firmato.pdf`);
       setStatus(status, `✔ PDF scaricato con ${S.placements.length} elementi inseriti.`, 'success');
     }));
   
     /* ---------- 5g. Ridimensionamento finestra e visibilità ---------- */
     let resizeTimer;
     window.addEventListener('resize', () => {
       clearTimeout(resizeTimer);
       resizeTimer = setTimeout(() => { if (!ws.hidden) { renderOverlays(); sizePad(); } }, 120);
     });
   
     // Quando il tool diventa visibile i canvas hanno finalmente una dimensione reale
     toolHooks.sign = () => requestAnimationFrame(() => { sizePad(); renderOverlays(); });
   }
   
   /* =============================================================
      6. TOOL 3 — IMMAGINI IN PDF
      ============================================================= */
   function initImg2Pdf() {
     const ws = $('#tool-img2pdf');
     const status = $('.status', ws);
     const runBtn = $('[data-action="run"]', ws);
     const recompress = $('#i2p-recompress');
     const quality = $('#i2p-quality');
     const qualityOut = $('#i2p-quality-out');
   
     const queue = new FileQueue($('.file-list', ws), {
       thumbnails: true,
       onChange: (q) => { runBtn.disabled = q.size === 0; },
     });
   
     setupDropzone($('.dropzone', ws), (files) => {
       const images = files.filter(isImage);
       const skipped = files.length - images.length;
       setStatus(status, skipped ? `⚠ ${skipped} file ignorati: non sono immagini.` : '', 'warn');
       queue.add(images);
     });
   
     $('[data-action="clear"]', ws).addEventListener('click', () => { queue.clear(); setStatus(status); });
     quality.addEventListener('input', () => { qualityOut.textContent = `${quality.value}%`; });
     recompress.addEventListener('change', () => { quality.disabled = !recompress.checked; });
   
     /**
      * Prepara i byte da dare a pdf-lib, che accetta solo JPG e PNG.
      * - senza ricompressione: JPG/PNG passano così come sono (qualità originale)
      * - con ricompressione o formati diversi (WebP, GIF…): passano dal canvas
      */
     async function prepareImage(file, { recompress: reencode, quality: q }) {
       const isJpg = file.type === 'image/jpeg';
       const isPng = file.type === 'image/png';
       if (!reencode && (isJpg || isPng)) return { bytes: await file.arrayBuffer(), kind: isJpg ? 'jpg' : 'png' };
   
       if (reencode) {
         const canvas = await fileToCanvas(file, { background: '#ffffff' }); // sfondo bianco al posto della trasparenza
         const blob = await canvasToBlob(canvas, 'image/jpeg', q);
         return { bytes: await blob.arrayBuffer(), kind: 'jpg' };
       }
       const canvas = await fileToCanvas(file);
       const blob = await canvasToBlob(canvas, 'image/png');
       return { bytes: await blob.arrayBuffer(), kind: 'png' };
     }
   
     /** Aggiunge una pagina con l'immagine centrata */
     function addImagePage(pdf, img, { size, orient, margin }) {
       if (size === 'fit') {
         const page = pdf.addPage([img.width + margin * 2, img.height + margin * 2]);
         page.drawImage(img, { x: margin, y: margin, width: img.width, height: img.height });
         return;
       }
       const landscape = orient === 'landscape' || (orient === 'auto' && img.width > img.height);
       const [pw, ph] = landscape ? [CONFIG.a4[1], CONFIG.a4[0]] : CONFIG.a4;
       const page = pdf.addPage([pw, ph]);
       const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
       const w = img.width * scale;
       const hgt = img.height * scale;
       page.drawImage(img, { x: (pw - w) / 2, y: (ph - hgt) / 2, width: w, height: hgt });
     }
   
     runBtn.addEventListener('click', () => runTask(runBtn, status, async () => {
       const { PDFDocument } = requireLib('PDFLib', 'pdf-lib');
       const pdf = await PDFDocument.create();
       const opt = {
         size: $('#i2p-size').value,
         orient: $('#i2p-orient').value,
         margin: Number($('#i2p-margin').value),
         recompress: recompress.checked,
         quality: Number(quality.value) / 100,
       };
       const embed = ({ bytes, kind }) => (kind === 'jpg' ? pdf.embedJpg(bytes) : pdf.embedPng(bytes));
       const files = queue.files;
   
       for (const [i, file] of files.entries()) {
         setStatus(status, `Elaboro immagine ${i + 1}/${files.length}…`);
         let img;
         try {
           img = await embed(await prepareImage(file, opt));
         } catch {
           // Alcuni JPG/PNG "strani" (es. CMYK) non piacciono a pdf-lib: riprova passando dal canvas
           img = await embed(await prepareImage(file, { ...opt, recompress: true }));
         }
         addImagePage(pdf, img, opt);
       }
   
       const bytes = await pdf.save();
       downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'immagini.pdf');
       setStatus(status, `✔ PDF creato: ${files.length} pagine · ${formatBytes(bytes.length)}.`, 'success');
     }));
   }
   
   /* =============================================================
      7. TOOL 4 — CONVERTITORE & COMPRESSORE IMMAGINI (Canvas API)
      ============================================================= */
   function initConvert() {
     const ws = $('#tool-convert');
     const status = $('.status', ws);
     const runBtn = $('[data-action="run"]', ws);
     const format = $('#cv-format');
     const quality = $('#cv-quality');
     const qualityOut = $('#cv-quality-out');
     const maxSide = $('#cv-maxside');
     const resultList = $('.result-list', ws);
     const zipBtn = $('#cv-zip');
   
     const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
     let results = []; // { name, blob, url }
   
     const queue = new FileQueue($('.file-list', ws), {
       thumbnails: true,
       reorderable: false,
       onChange: (q) => { runBtn.disabled = q.size === 0; },
     });
   
     // Se il browser non sa creare WebP, disattiviamo l'opzione
     const webpOption = $('option[value="image/webp"]', format);
     if (!canEncode('image/webp')) {
       webpOption.disabled = true;
       webpOption.textContent += ' (non supportato da questo browser)';
       format.value = 'image/jpeg';
     }
   
     const syncQuality = () => { quality.disabled = format.value === 'image/png'; };
     format.addEventListener('change', syncQuality);
     syncQuality();
     quality.addEventListener('input', () => { qualityOut.textContent = `${quality.value}%`; });
   
     setupDropzone($('.dropzone', ws), (files) => {
       const images = files.filter(isImage);
       const skipped = files.length - images.length;
       setStatus(status, skipped ? `⚠ ${skipped} file ignorati: non sono immagini.` : '', 'warn');
       queue.add(images);
     });
   
     function clearResults() {
       results.forEach((r) => URL.revokeObjectURL(r.url));
       results = [];
       resultList.replaceChildren();
       zipBtn.hidden = true;
     }
   
     $('[data-action="clear"]', ws).addEventListener('click', () => { queue.clear(); clearResults(); setStatus(status); });
   
     function renderResult({ name, blob, url }, originalSize) {
       const diff = Math.round((1 - blob.size / originalSize) * 100);
       return h('li', { class: 'result-item' },
         h('img', { class: 'file-thumb', src: url, alt: '' }),
         h('div', { class: 'file-info' },
           h('span', { class: 'file-name', title: name }, name),
           h('span', { class: 'file-meta' }, `${formatBytes(originalSize)} → ${formatBytes(blob.size)}`)),
         h('span', { class: `tag${diff < 0 ? ' tag-bad' : ''}` }, diff >= 0 ? `−${diff}%` : `+${-diff}%`),
         h('a', { class: 'btn btn-small', href: url, download: name }, 'Scarica'));
     }
   
     runBtn.addEventListener('click', () => runTask(runBtn, status, async () => {
       clearResults();
       const type = format.value;
       const q = Number(quality.value) / 100;
       const limit = Number(maxSide.value) || 0;
       const used = new Set();
       let totalIn = 0;
       let totalOut = 0;
       let fallback = false;
       const files = queue.files;
   
       for (const [i, file] of files.entries()) {
         setStatus(status, `Converto ${i + 1}/${files.length}: ${file.name}…`);
         const canvas = await fileToCanvas(file, {
           maxSide: limit,
           background: type === 'image/jpeg' ? '#ffffff' : null, // JPG non ha trasparenza
         });
         const blob = await canvasToBlob(canvas, type, type === 'image/png' ? undefined : q);
         canvas.width = canvas.height = 0; // libera subito la memoria del canvas
         if (blob.type !== type) fallback = true; // il browser ha usato un altro formato
   
         const name = uniqueName(`${baseName(file.name)}.${EXT[blob.type] || EXT[type]}`, used);
         const result = { name, blob, url: URL.createObjectURL(blob) };
         results.push(result);
         resultList.append(renderResult(result, file.size));
         totalIn += file.size;
         totalOut += blob.size;
       }
   
       zipBtn.hidden = results.length < 2;
       const saved = Math.round((1 - totalOut / totalIn) * 100);
       setStatus(status,
         `✔ ${results.length} immagini: ${formatBytes(totalIn)} → ${formatBytes(totalOut)}`
         + (saved > 0 ? ` (−${saved}%)` : ' (nessun risparmio: prova un formato o una qualità diversa)')
         + (fallback ? ' ⚠ Il browser non supporta il formato scelto: usato PNG.' : ''),
         saved > 0 ? 'success' : 'warn');
     }));
   
     zipBtn.addEventListener('click', () => runTask(zipBtn, status, async () => {
       const JSZipLib = requireLib('JSZip', 'JSZip');
       const zip = new JSZipLib();
       results.forEach((r) => zip.file(r.name, r.blob));
       // Le immagini sono già compresse: STORE (senza ricompressione) è più veloce
       const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
       downloadBlob(blob, 'immagini-convertite.zip');
     }));
   }
   
   /* =============================================================
      8. TOOL 5 — CREA ARCHIVIO ZIP (JSZip)
      ============================================================= */
   function initZip() {
     const ws = $('#tool-zip');
     const status = $('.status', ws);
     const runBtn = $('[data-action="run"]', ws);
     const summary = $('#zip-summary');
     const level = $('#zip-level');
     const levelOut = $('#zip-level-out');
     const nameInput = $('#zip-name');
     const progress = $('.progress', ws);
     const bar = $('.progress-bar', ws);
   
     const queue = new FileQueue($('.file-list', ws), {
       reorderable: false,
       onChange: (q) => {
         runBtn.disabled = q.size === 0;
         summary.textContent = q.size ? `${q.size} file · ${formatBytes(q.totalBytes)}` : '';
       },
     });
   
     setupDropzone($('.dropzone', ws), (files) => queue.add(files), { allowFolders: true });
   
     // Selettore cartella: i file hanno già webkitRelativePath ("cartella/sotto/file.txt")
     const folderInput = $('#zip-folder');
     folderInput.addEventListener('change', () => {
       const files = Array.from(folderInput.files);
       folderInput.value = '';
       queue.add(files);
     });
   
     level.addEventListener('input', () => {
       levelOut.textContent = level.value === '0' ? '0 (nessuna)' : level.value;
     });
   
     $('[data-action="clear"]', ws).addEventListener('click', () => {
       queue.clear();
       setStatus(status);
       progress.hidden = true;
     });
   
     runBtn.addEventListener('click', () => runTask(runBtn, status, async () => {
       const JSZipLib = requireLib('JSZip', 'JSZip');
       const zip = new JSZipLib();
       const used = new Set();
   
       for (const file of queue.files) {
         // JSZip accetta direttamente File/Blob: il contenuto viene letto solo alla generazione
         zip.file(uniqueName(pathOf(file), used), file, { date: new Date(file.lastModified) });
       }
   
       const lvl = Number(level.value);
       progress.hidden = false;
       bar.style.width = '0%';
   
       const blob = await zip.generateAsync(
         {
           type: 'blob',
           compression: lvl === 0 ? 'STORE' : 'DEFLATE',
           compressionOptions: { level: Math.max(1, lvl) },
         },
         (meta) => { // callback di avanzamento
           bar.style.width = `${meta.percent.toFixed(0)}%`;
           setStatus(status, `Compressione… ${meta.percent.toFixed(0)}%`);
         },
       );
   
       // Nome file sicuro: niente caratteri vietati, estensione .zip una sola volta
       const safeName = (nameInput.value.trim() || 'archivio').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.zip$/i, '');
       downloadBlob(blob, `${safeName}.zip`);
   
       const ratio = Math.round((1 - blob.size / queue.totalBytes) * 100);
       setStatus(status,
         `✔ Archivio creato: ${queue.size} file · ${formatBytes(queue.totalBytes)} → ${formatBytes(blob.size)}${ratio > 0 ? ` (−${ratio}%)` : ''}.`,
         'success');
     }));
   }
   
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
   function initCrochet() {
     const ws = $('#tool-crochet');
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
       const { PDFDocument, StandardFonts, rgb } = requireLib('PDFLib', 'pdf-lib');
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
   initSign();
   initImg2Pdf();
   initConvert();
   initZip();
   initCrochet();
   initPixel();
   window.addEventListener('hashchange', route);
   route();