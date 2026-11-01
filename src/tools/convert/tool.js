/* =============================================================
   PixelTools — src/tools/convert/tool.js
   TOOL — CONVERTI & COMPRIMI: JPG/PNG/WebP e riduzione del peso (Canvas API).
   - view: il markup del tool (view.html), inserito nella pagina
           solo la prima volta che il tool viene aperto
   - init: collega i comandi (riceve la <section> del tool)
   ============================================================= */
   import { $, h } from '../../core/dom.js';
   import { formatBytes, baseName, isImage, downloadBlob, uniqueName } from '../../core/files.js';
   import { fileToCanvas, canvasToBlob, canEncode } from '../../core/images.js';
   import { setStatus, runTask, setupDropzone, FileQueue } from '../../core/ui.js';
   import JSZip from 'jszip'; // libreria da npm (prima arrivava dalla CDN)
   import view from './view.html?raw';
   
   export { view };
   
   export function init(ws) {
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
       const zip = new JSZip();
       results.forEach((r) => zip.file(r.name, r.blob));
       // Le immagini sono già compresse: STORE (senza ricompressione) è più veloce
       const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
       downloadBlob(blob, 'immagini-convertite.zip');
     }));
   }