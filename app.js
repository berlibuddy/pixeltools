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
     1. Utility generiche (DOM, file, download, stato, immagini)
     2. Componenti riutilizzabili (Dropzone, FileQueue)
     3. Router (dashboard ↔ strumenti)
     4. Tool 1 — Unisci PDF
     5. Tool 2 — Firma & Annotazioni PDF
     6. Tool 3 — Immagini in PDF
     7. Tool 4 — Convertitore & Compressore immagini
     8. Tool 5 — Crea archivio ZIP
     9. Tool 6 — Foto in Uncinetto (motore pixel)
    10. Avvio
   ============================================================= */
   'use strict';

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
      1. UTILITY GENERICHE
      ============================================================= */
   
   /** Scorciatoie per selezionare elementi */
   const $ = (sel, root = document) => root.querySelector(sel);
   const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
   
   /**
    * Crea un elemento DOM in modo sicuro (niente innerHTML con dati utente).
    * h('button', { class: 'btn', type: 'button' }, 'Testo')
    */
   function h(tag, props = {}, ...children) {
     const el = document.createElement(tag);
     for (const [key, value] of Object.entries(props)) {
       if (value === false || value == null) continue;
       if (key === 'class') el.className = value;
       else if (key === 'dataset') Object.assign(el.dataset, value);
       else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
       else el.setAttribute(key, value === true ? '' : value);
     }
     el.append(...children.flat().filter((c) => c != null && c !== false));
     return el;
   }
   
   /** 1536000 → "1.5 MB" */
   function formatBytes(bytes) {
     if (bytes < 1024) return `${bytes} B`;
     const units = ['KB', 'MB', 'GB'];
     let value = bytes / 1024;
     let i = 0;
     while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
     return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
   }
   
   const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));
   const baseName = (name) => name.replace(/\.[^./]+$/, '');            // "foto.jpg" → "foto"
   const extOf = (name) => (name.match(/\.([^./]+)$/)?.[1] || '').toLowerCase();
   const isPdf = (f) => f.type === 'application/pdf' || extOf(f.name) === 'pdf';
   const isImage = (f) => f.type.startsWith('image/');
   
   /** Fa scaricare un Blob come file */
   function downloadBlob(blob, filename) {
     const url = URL.createObjectURL(blob);
     const a = h('a', { href: url, download: filename });
     document.body.append(a);
     a.click();
     a.remove();
     // Il browser ha bisogno di un attimo prima di poter liberare l'URL
     setTimeout(() => URL.revokeObjectURL(url), 10_000);
   }
   
   /** Mostra un messaggio nella riga di stato di uno strumento */
   function setStatus(el, message = '', type = 'info') {
     el.textContent = message;
     el.dataset.type = type;
   }
   
   /** Recupera una libreria globale o lancia un errore chiaro */
   function requireLib(globalName, label) {
     const lib = window[globalName] || (globalName === 'pdfjsLib' ? window['pdfjs-dist/build/pdf'] : null);
     if (!lib) throw new Error(`La libreria ${label} non è stata caricata. Controlla la connessione internet e ricarica la pagina.`);
     return lib;
   }
   
   /**
    * Esegue un'operazione "lunga" bloccando il bottone e gestendo gli errori
    * in un unico posto, così ogni tool resta semplice.
    */
   async function runTask(button, statusEl, task) {
     if (button.disabled) return;
     const originalLabel = button.innerHTML; // markup statico nostro: sicuro
     button.disabled = true;
     button.textContent = '⏳ Attendi…';
     try {
       await task();
     } catch (err) {
       console.error(err);
       setStatus(statusEl, `✖ ${err.message || err}`, 'error');
     } finally {
       button.disabled = false;
       button.innerHTML = originalLabel;
     }
   }
   
   /** Evita nomi duplicati: "foto.jpg" → "foto (2).jpg" */
   function uniqueName(name, used) {
     if (!used.has(name)) { used.add(name); return name; }
     const dot = name.lastIndexOf('.');
     const slash = name.lastIndexOf('/');
     const hasExt = dot > slash + 1;
     const stem = hasExt ? name.slice(0, dot) : name;
     const ext = hasExt ? name.slice(dot) : '';
     let i = 2;
     let candidate;
     do { candidate = `${stem} (${i++})${ext}`; } while (used.has(candidate));
     used.add(candidate);
     return candidate;
   }
   
   /* ---------- Utility per immagini (Canvas API) ---------- */
   
   /**
    * Decodifica un file immagine. createImageBitmap è veloce e applica
    * l'orientamento EXIF (foto da smartphone); in caso di problemi usa <img>.
    */
   async function loadBitmap(file) {
     if ('createImageBitmap' in window) {
       try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fallback sotto */ }
     }
     return new Promise((resolve, reject) => {
       const url = URL.createObjectURL(file);
       const img = new Image();
       img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
       img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Impossibile leggere l'immagine "${file.name}".`)); };
       img.src = url;
     });
   }
   
   /**
    * Disegna un'immagine su un canvas, opzionalmente ridimensionandola
    * (maxSide = lato lungo massimo in px) e con uno sfondo (utile per JPG,
    * che non supporta la trasparenza).
    */
   async function fileToCanvas(file, { maxSide = 0, background = null } = {}) {
     const src = await loadBitmap(file);
     let w = src.naturalWidth || src.width;
     let hgt = src.naturalHeight || src.height;
     const longest = Math.max(w, hgt);
     if (maxSide > 0 && longest > maxSide) {
       const ratio = maxSide / longest;
       w = Math.round(w * ratio);
       hgt = Math.round(hgt * ratio);
     }
     const canvas = document.createElement('canvas');
     canvas.width = w;
     canvas.height = hgt;
     const ctx = canvas.getContext('2d');
     if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, hgt); }
     ctx.imageSmoothingQuality = 'high';
     ctx.drawImage(src, 0, 0, w, hgt);
     src.close?.(); // libera memoria (solo ImageBitmap)
     return canvas;
   }
   
   /** canvas.toBlob in versione Promise */
   function canvasToBlob(canvas, type, quality) {
     return new Promise((resolve, reject) => {
       canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Conversione immagine fallita.'))), type, quality);
     });
   }
   
   /** Il browser sa codificare questo formato? (es. WebP su vecchi Safari no) */
   function canEncode(type) {
     const c = document.createElement('canvas');
     c.width = c.height = 1;
     return c.toDataURL(type).startsWith(`data:${type}`);
   }
   
   /* =============================================================
      2. COMPONENTI RIUTILIZZABILI
      ============================================================= */
   
   /* Percorsi relativi dei file presi da cartelle trascinate (per lo ZIP) */
   const relPaths = new WeakMap();
   const pathOf = (f) => relPaths.get(f) || f.webkitRelativePath || f.name;
   
   /**
    * Collega una dropzone (<label class="dropzone"> con un <input type=file> dentro).
    * Gestisce sia il click (selettore file) sia il drag & drop.
    */
   function setupDropzone(zone, onFiles, { allowFolders = false } = {}) {
     const input = $('input[type="file"]', zone);
   
     input.addEventListener('change', () => {
       const files = Array.from(input.files);
       input.value = ''; // permette di riselezionare lo stesso file
       if (files.length) onFiles(files);
     });
   
     zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-dragover'); });
     zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
     zone.addEventListener('drop', async (e) => {
       e.preventDefault();
       zone.classList.remove('is-dragover');
       const files = allowFolders ? await filesFromDrop(e.dataTransfer) : Array.from(e.dataTransfer.files);
       if (files.length) onFiles(files);
     });
   }
   
   /** Legge ricorsivamente le cartelle trascinate, salvando il percorso relativo */
   async function filesFromDrop(dataTransfer) {
     // Le "entry" vanno lette SUBITO: dopo il primo await il DataTransfer non è più valido
     const entries = Array.from(dataTransfer.items || [])
       .map((item) => item.webkitGetAsEntry?.())
       .filter(Boolean);
     if (!entries.length) return Array.from(dataTransfer.files);
   
     const out = [];
     const readFile = (entry) => new Promise((res, rej) => entry.file(res, rej));
     const readBatch = (reader) => new Promise((res, rej) => reader.readEntries(res, rej));
   
     async function walk(entry, prefix) {
       if (entry.isFile) {
         const file = await readFile(entry);
         relPaths.set(file, prefix + file.name);
         out.push(file);
       } else if (entry.isDirectory) {
         const reader = entry.createReader();
         const dir = `${prefix}${entry.name}/`;
         let batch;
         do { // readEntries restituisce al massimo ~100 voci per volta
           batch = await readBatch(reader);
           for (const child of batch) await walk(child, dir);
         } while (batch.length);
       }
     }
     for (const entry of entries) await walk(entry, '');
     return out;
   }
   
   /**
    * Lista di file con anteprima, riordino (▲ ▼) e rimozione (✕).
    * È usata da tutti i tool con più file.
    */
   class FileQueue {
     constructor(listEl, { reorderable = true, thumbnails = false, onChange = () => {} } = {}) {
       this.listEl = listEl;
       this.reorderable = reorderable;
       this.thumbnails = thumbnails;
       this.onChange = onChange;
       this.items = [];
       this.nextId = 1;
   
       // Un solo listener per tutta la lista (event delegation)
       listEl.addEventListener('click', (e) => {
         const btn = e.target.closest('button[data-act]');
         if (!btn) return;
         const id = Number(btn.closest('li').dataset.id);
         if (btn.dataset.act === 'up') this.move(id, -1);
         if (btn.dataset.act === 'down') this.move(id, 1);
         if (btn.dataset.act === 'remove') this.remove(id);
       });
     }
   
     get files() { return this.items.map((it) => it.file); }
     get size() { return this.items.length; }
     get totalBytes() { return this.items.reduce((sum, it) => sum + it.file.size, 0); }
   
     add(files) {
       for (const file of files) {
         this.items.push({
           id: this.nextId++,
           file,
           thumb: this.thumbnails && isImage(file) ? URL.createObjectURL(file) : null,
         });
       }
       this.render();
     }
   
     remove(id) {
       const i = this.items.findIndex((it) => it.id === id);
       if (i < 0) return;
       const [removed] = this.items.splice(i, 1);
       if (removed.thumb) URL.revokeObjectURL(removed.thumb);
       this.render();
     }
   
     move(id, delta) {
       const i = this.items.findIndex((it) => it.id === id);
       const j = i + delta;
       if (i < 0 || j < 0 || j >= this.items.length) return;
       [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
       this.render();
     }
   
     clear() {
       this.items.forEach((it) => it.thumb && URL.revokeObjectURL(it.thumb));
       this.items = [];
       this.render();
     }
   
     render() {
       const last = this.items.length - 1;
       this.listEl.replaceChildren(...this.items.map((it, idx) => {
         const label = pathOf(it.file);
         return h('li', { class: 'file-item', dataset: { id: it.id } },
           h('span', { class: 'file-index' }, String(idx + 1)),
           it.thumb
             ? h('img', { class: 'file-thumb', src: it.thumb, alt: '' })
             : h('span', { class: 'file-type', 'aria-hidden': 'true' }, (extOf(it.file.name) || 'file').slice(0, 4).toUpperCase()),
           h('div', { class: 'file-info' },
             h('span', { class: 'file-name', title: label }, label),
             h('span', { class: 'file-meta' }, formatBytes(it.file.size))),
           h('div', { class: 'file-actions' },
             this.reorderable && h('button', { class: 'btn btn-icon', type: 'button', 'data-act': 'up', 'aria-label': 'Sposta su', disabled: idx === 0 }, '▲'),
             this.reorderable && h('button', { class: 'btn btn-icon', type: 'button', 'data-act': 'down', 'aria-label': 'Sposta giù', disabled: idx === last }, '▼'),
             h('button', { class: 'btn btn-icon btn-danger', type: 'button', 'data-act': 'remove', 'aria-label': `Rimuovi ${it.file.name}` }, '✕')));
       }));
       this.onChange(this);
     }
   }
   
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
   };
   const toolHooks = {}; // funzioni da chiamare quando un tool diventa visibile
   
   function route() {
     const id = location.hash.slice(1);
     const active = id in TOOL_TITLES ? id : null;
   
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
      4. TOOL 1 — UNISCI PDF
      ============================================================= */
   function initMerge() {
     const ws = $('#tool-merge');
     const status = $('.status', ws);
     const runBtn = $('[data-action="run"]', ws);
   
     const queue = new FileQueue($('.file-list', ws), {
       onChange: (q) => { runBtn.disabled = q.size < 2; },
     });
   
     setupDropzone($('.dropzone', ws), (files) => {
       const pdfs = files.filter(isPdf);
       const skipped = files.length - pdfs.length;
       setStatus(status, skipped ? `⚠ ${skipped} file ignorati: non sono PDF.` : '', 'warn');
       queue.add(pdfs);
     });
   
     $('[data-action="clear"]', ws).addEventListener('click', () => { queue.clear(); setStatus(status); });
   
     runBtn.addEventListener('click', () => runTask(runBtn, status, async () => {
       const { PDFDocument } = requireLib('PDFLib', 'pdf-lib');
       const merged = await PDFDocument.create();
       const files = queue.files;
   
       for (const [i, file] of files.entries()) {
         setStatus(status, `Elaboro ${i + 1}/${files.length}: ${file.name}…`);
         let src;
         try {
           src = await PDFDocument.load(await file.arrayBuffer());
         } catch {
           throw new Error(`"${file.name}" non si può aprire (forse è protetto da password o danneggiato).`);
         }
         // copyPages porta le pagine (con font e immagini) dal PDF sorgente a quello nuovo
         const pages = await merged.copyPages(src, src.getPageIndices());
         pages.forEach((page) => merged.addPage(page));
       }
   
       const bytes = await merged.save();
       downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'pdf-uniti.pdf');
       setStatus(status, `✔ Fatto! ${merged.getPageCount()} pagine in totale · ${formatBytes(bytes.length)}.`, 'success');
     }));
   }
   
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
   
     /* ---------- 9a. Calcoli ---------- */
     const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b; // luminosità percepita
     const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
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
   
     /** Riduce la foto a W×H celle: ogni cella = media dei pixel che copre */
     function boxSample(W, H) {
       const { width: sw, height: sh, data: sd } = S.srcData;
       const out = new Float32Array(W * H * 3);
       for (let y = 0; y < H; y++) {
         const y0 = Math.floor((y * sh) / H);
         const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / H));
         for (let x = 0; x < W; x++) {
           const x0 = Math.floor((x * sw) / W);
           const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / W));
           let r = 0, g = 0, b = 0, n = 0;
           for (let yy = y0; yy < y1; yy++) {
             let i = (yy * sw + x0) * 4;
             for (let xx = x0; xx < x1; xx++, i += 4) { r += sd[i]; g += sd[i + 1]; b += sd[i + 2]; n++; }
           }
           const o = (y * W + x) * 3;
           out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
         }
       }
       return out;
     }
   
     /**
      * k-means: trova k colori rappresentativi.
      * Partenza: colore medio + i colori "più lontani" (risultato sempre uguale);
      * poi si ripete: assegna ogni cella al colore più vicino → ricalcola le medie.
      */
     function quantize(px, n, k) {
       // distanza pesata: l'occhio è più sensibile al verde
       const d2 = (i, c) => {
         const dr = px[i * 3] - c[0], dg = px[i * 3 + 1] - c[1], db = px[i * 3 + 2] - c[2];
         return 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
       };
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
         if (best < 1) break; // la foto ha meno colori di quelli richiesti
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
   
     /** Calcola lo schema completo: celle + palette ordinata dal colore più usato */
     function buildPattern() {
       const { W, H } = gridSize();
       const n = W * H;
       const px = boxSample(W, H);
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
      10. AVVIO
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
   initMerge();
   initSign();
   initImg2Pdf();
   initConvert();
   initZip();
   initCrochet();
   window.addEventListener('hashchange', route);
   route();