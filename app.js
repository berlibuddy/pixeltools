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
     9. Avvio
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
   9. AVVIO
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
window.addEventListener('hashchange', route);
route();
