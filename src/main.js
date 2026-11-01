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
     - pdfjsLib  (pdf.js 3.11.174)  → SOLO anteprima pagine nel tool Firma
   Librerie da npm (importate solo dai tool che le usano):
     - jszip     (3.10.1)           → creare archivi .zip (Crea ZIP, Converti)
   Le immagini usano la Canvas API nativa del browser.

   L'elenco dei tool (nomi, icone, colori…) è in src/tools/registry.js.

   Indice:
     1. Dashboard (le card, create dal registro)
     2. Router (dashboard ↔ strumenti)
     3. Avvio
   ============================================================= */
   'use strict';

   import { $, $$, h } from './core/dom.js';
   import { TOOLS } from './tools/registry.js';

   /* =============================================================
      1. DASHBOARD — una card per ogni tool del registro
      ============================================================= */
   function renderDashboard() {
     const cards = TOOLS.map((tool) => {
       const card = h('a', { class: 'tool-card', href: `#${tool.id}`, style: `--accent: ${tool.accent}` });
       // l'icona è markup statico nostro (registry.js): sicuro
       const tpl = document.createElement('template');
       tpl.innerHTML = `<svg class="px-icon" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">${tool.icon}</svg>`;
       card.append(
         tpl.content.firstElementChild,
         h('h2', {}, tool.name),
         h('p', {}, tool.desc),
         h('span', { class: 'cta' }, 'Apri →'),
       );
       return card;
     });
     $('#dashboard .tool-grid').append(...cards);
   }

   /* =============================================================
      2. ROUTER — mostra la dashboard o lo strumento indicato nell'URL (#merge, #sign…)
      Usare l'hash fa funzionare anche il tasto "indietro" del browser.
      ============================================================= */
   const TOOL_BY_ID = Object.fromEntries(TOOLS.map((tool) => [tool.id, tool])); // 'merge' → { id, name, … }
   const toolHooks = {}; // funzioni da chiamare quando un tool diventa visibile
   
   /**
    * Tool "a richiesta": ognuno vive in src/tools/<tool>/ e viene
    * scaricato solo la prima volta che lo apri (tool.load() del registro). tool.js esporta:
    *   view → il markup (view.html) · init(ws, toolHooks) → collega i comandi
    * Se il tool ha uno stile suo (style.css), Vite lo carica insieme al tool.
    */
   const loadingTools = {}; // id → Promise: ogni tool si carica una volta sola
   
   function loadTool(id) {
     if (!Object.hasOwn(TOOL_BY_ID, id)) return Promise.resolve();
     loadingTools[id] ??= TOOL_BY_ID[id].load().then(({ view, init }) => {
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
     let active = Object.hasOwn(TOOL_BY_ID, id) ? id : null; // hasOwn: #constructor & co. non sono tool
   
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
     document.title = active ? `${TOOL_BY_ID[active].title} — PixelTools` : 'PixelTools — PDF, Immagini e ZIP nel browser';
     window.scrollTo(0, 0);
   
     if (active) {
       $(`#tool-${active} h2`)?.focus({ preventScroll: true }); // accessibilità: annuncia il tool
       toolHooks[active]?.();
     }
   }
   
   /* =============================================================
      3. AVVIO
      ============================================================= */
   function checkLibraries() {
     const libs = [['PDFLib', 'pdf-lib'], ['pdfjsLib', 'pdf.js']];
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
   renderDashboard();
   window.addEventListener('hashchange', route);
   route();