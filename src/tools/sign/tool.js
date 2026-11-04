/* =============================================================
   PixelTools — src/tools/sign/tool.js
   TOOL — FIRMA & ANNOTA: firma, data e testo posizionati sul PDF (pdf.js + pdf-lib).
   - view: il markup del tool (view.html), inserito nella pagina
           solo la prima volta che il tool viene aperto
   - init: collega i comandi (riceve la <section> del tool)
   ============================================================= */
   import { $, $$, h, clamp } from '../../core/dom.js';
   import { baseName, isPdf, downloadBlob } from '../../core/files.js';
   import { setStatus, requireLib, runTask, setupDropzone } from '../../core/ui.js';
   import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'; // libreria da npm (prima arrivava dalla CDN)
   import { CONFIG } from '../../core/config.js';
   import './style.css';
   import view from './view.html?raw';
   
   export { view };
   
   /* 5. TOOL 2 — FIRMA & ANNOTAZIONI PDF
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
   export function init(ws, toolHooks) {
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
       return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
     }
   
     exportBtn.addEventListener('click', () => runTask(exportBtn, status, async () => {
   
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