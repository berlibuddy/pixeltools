/* =============================================================
   PixelTools — src/main.js
   -------------------------------------------------------------
   Tutto gira nel browser: nessun file viene inviato a un server.

   Questo file avvia l'app e fa da "router": mostra la dashboard
   oppure il tool indicato nell'URL (#merge, #sign…).
   Ogni tool vive in src/tools/<tool>/ (tool.js + view.html,
   a volte style.css) e viene scaricato solo quando lo apri.
   I pezzi comuni sono in src/core/, lo stile comune in src/styles/.

   Librerie caricate via CDN in index.html (variabili globali):
     - PDFLib    (pdf-lib 1.17.1)   → creare e modificare PDF
     - JSZip     (3.10.1)           → creare archivi .zip
     - pdfjsLib  (pdf.js 3.11.174)  → SOLO anteprima pagine nel tool Firma
   Le immagini usano la Canvas API nativa del browser.

   Indice:
     1. Router (dashboard ↔ strumenti)
     2. Avvio
   ============================================================= */
   'use strict';

   import { $, $$ } from './core/dom.js';

   /* =============================================================
      1. ROUTER — mostra la dashboard o lo strumento indicato nell'URL (#merge, #sign…)
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
    */
   const LAZY_TOOLS = {
     merge: () => import('./tools/merge/tool.js'),
     img2pdf: () => import('./tools/img2pdf/tool.js'),
     convert: () => import('./tools/convert/tool.js'),
     zip: () => import('./tools/zip/tool.js'),
     sign: () => import('./tools/sign/tool.js'),
     crochet: () => import('./tools/crochet/tool.js'),
     pixel: () => import('./tools/pixel/tool.js'),
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
      2. AVVIO
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