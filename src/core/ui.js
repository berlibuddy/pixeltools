/* =============================================================
   PixelTools — src/core/ui.js
   Pezzi d'interfaccia riutilizzabili (condivisi da tutti i tool)
   - setStatus:     scrive un messaggio nella riga di stato
   - requireLib:    recupera una libreria globale (pdf-lib, JSZip, pdf.js)
   - runTask:       esegue un'operazione lunga bloccando il bottone
   - setupDropzone: collega una zona "trascina qui i file"
   - FileQueue:     lista di file con anteprima, riordino e rimozione
   ============================================================= */
   import { $, h } from './dom.js';
   import { formatBytes, extOf, isImage, pathOf, filesFromDrop } from './files.js';
   
   /** Mostra un messaggio nella riga di stato di uno strumento */
   export function setStatus(el, message = '', type = 'info') {
     el.textContent = message;
     el.dataset.type = type;
   }
   
   /** Recupera una libreria globale o lancia un errore chiaro */
   export function requireLib(globalName, label) {
     const lib = window[globalName] || (globalName === 'pdfjsLib' ? window['pdfjs-dist/build/pdf'] : null);
     if (!lib) throw new Error(`La libreria ${label} non è stata caricata. Controlla la connessione internet e ricarica la pagina.`);
     return lib;
   }
   
   /**
    * Esegue un'operazione "lunga" bloccando il bottone e gestendo gli errori
    * in un unico posto, così ogni tool resta semplice.
    */
   export async function runTask(button, statusEl, task) {
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
   
   /* =============================================================
      2. COMPONENTI RIUTILIZZABILI
      ============================================================= */
   
   /**
    * Collega una dropzone (<label class="dropzone"> con un <input type=file> dentro).
    * Gestisce sia il click (selettore file) sia il drag & drop.
    */
   export function setupDropzone(zone, onFiles, { allowFolders = false } = {}) {
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
   
   /**
    * Lista di file con anteprima, riordino (▲ ▼) e rimozione (✕).
    * È usata da tutti i tool con più file.
    */
   export class FileQueue {
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