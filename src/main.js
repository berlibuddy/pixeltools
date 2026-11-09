/* =============================================================
   PixelTools — src/main.js
   -------------------------------------------------------------
   Tutto gira nel browser: nessun file viene inviato a un server.

   Questo file avvia l'app e fa da "router": mostra la dashboard
   oppure il tool indicato nell'URL (#merge, #sign…).
   Ogni tool vive in src/tools/<tool>/ (tool.js + view.html,
   a volte style.css) e viene scaricato solo quando lo apri.
   I pezzi comuni sono in src/core/, lo stile comune in src/styles/.

   Librerie da npm (importate solo dai tool che le usano):
     - jszip      (3.10.1)          → creare archivi .zip (Crea ZIP, Converti)
     - pdf-lib    (1.17.1)          → creare e modificare PDF (Unisci, Immagini
                                      in PDF, Firma, export PDF dell'Uncinetto)
     - pdfjs-dist (6.5.438, legacy) → SOLO anteprima pagine nel tool Firma
   Le immagini usano la Canvas API nativa del browser.

   L'elenco dei tool (nomi, icone, colori…) è in src/tools/registry.js.

   Indice:
     1. Dashboard (le card, create dal registro)
     2. Router (dashboard ↔ strumenti)
     3. Avvio
   ============================================================= */
   'use strict';

   import { $, $$, h } from './core/dom.js';
   import { TOOLS, SECTIONS } from './tools/registry.js';

   /* =============================================================
      1. DASHBOARD — una card per ogni tool del registro
      Card bianca con: linguetta colorata (disegnata dal CSS), quadratino
      colorato con l'icona, targhetta della categoria, nome, descrizione
      e freccia. Sul telefono il CSS lascia solo icona, targhetta e nome.
      ============================================================= */
   const ARROW = '<path d="M3 7h8v-2h1v1h1v1h1v2h-1v1h-1v1h-1v-2h-8z"/>';

   /** SVG pixel 16×16 da markup statico nostro (registry.js / ARROW): sicuro */
   function pixelSvg(cls, shapes) {
     const tpl = document.createElement('template');
     tpl.innerHTML = `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">${shapes}</svg>`;
     return tpl.content.firstElementChild;
   }

   function renderDashboard() {
     const cards = TOOLS.filter((tool) => !tool.hidden).map((tool) => {
       const card = h('a', { class: 'tool-card', href: `#${tool.id}` });
       card.style.setProperty('--accent', tool.accent); // così (e non con style="…") la CSP lo permette
       card.append(
         h('div', { class: 'card-body' },
           h('div', { class: 'card-top' },
             h('span', { class: 'card-tile' }, pixelSvg('px-icon', tool.icon)),
             h('span', { class: 'card-tag' }, SECTIONS[tool.section] ?? tool.section),
           ),
           h('h2', {}, tool.name),
           h('p', {}, tool.desc),
           h('span', { class: 'card-go' }, pixelSvg('card-arrow', ARROW)),
         ),
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
   // Se un file viene lasciato fuori da una dropzone, il browser NON deve aprirlo
   window.addEventListener('dragover', (e) => e.preventDefault());
   window.addEventListener('drop', (e) => e.preventDefault());
   
   // Con "defer" il DOM è già pronto quando questo script viene eseguito
   renderDashboard();
   window.addEventListener('hashchange', route);
   route();