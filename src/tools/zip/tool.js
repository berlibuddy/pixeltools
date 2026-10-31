/* =============================================================
   PixelTools — src/tools/zip/tool.js
   TOOL — CREA ZIP: file e cartelle in un archivio .zip (JSZip).
   - view: il markup del tool (view.html), inserito nella pagina
           solo la prima volta che il tool viene aperto
   - init: collega i comandi (riceve la <section> del tool)
   ============================================================= */
   import { $ } from '../../core/dom.js';
   import { formatBytes, downloadBlob, uniqueName, pathOf } from '../../core/files.js';
   import { setStatus, requireLib, runTask, setupDropzone, FileQueue } from '../../core/ui.js';
   import view from './view.html?raw';
   
   export { view };
   
   export function init(ws) {
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