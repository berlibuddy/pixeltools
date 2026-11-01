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
     pixel: () => import('./src/tools/pixel/tool.js'),
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
      10. TOOL 7 — FOTO IN PIXEL ART → spostato in src/tools/pixel/ (tool.js + view.html + style.css)
      ============================================================= */
   
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
   window.addEventListener('hashchange', route);
   route();