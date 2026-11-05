/* =============================================================
   PixelTools — src/tools/credits/tool.js
   PAGINA — CREDITI E LICENZE: tutto il codice e i font di altri
   autori inclusi nel sito, con il testo completo della licenza.
   I dati (licenses.json) li scrive lo script scripts/crediti.mjs:
   va rilanciato quando si aggiunge o aggiorna una libreria.
   - view: il markup (view.html) · init: riempie l'elenco
   ============================================================= */
   import { $, h } from '../../core/dom.js';
   import licenses from './licenses.json';
   import './style.css';
   import view from './view.html?raw';

   export { view };

   export function init(ws) {
     const card = (it) => h('article', { class: 'credit' },
       h('h4', {}, it.name, ' ', h('span', { class: 'credit-version' }, /^\d/.test(it.version) ? `v${it.version}` : it.version)),
       h('p', { class: 'credit-meta' },
         h('span', { class: 'tag' }, it.license),
         it.copyright && h('span', {}, it.copyright),
       ),
       it.note && h('p', { class: 'hint' }, it.note),
       it.url && h('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, 'Sito del progetto ↗'),
       h('details', {},
         h('summary', {}, 'Mostra licenza'),
         h('pre', {}, it.text), // testo semplice (textContent): sicuro
       ),
     );

     $('#credits-main', ws).append(...licenses.filter((it) => it.main).map(card));
     $('#credits-deps', ws).append(...licenses.filter((it) => !it.main).map(card));
   }
