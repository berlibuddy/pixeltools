/* =============================================================
   PixelTools — src/tools/merge/tool.js
   TOOL — UNISCI PDF
   Combina più PDF in un unico file, nell'ordine scelto (pdf-lib).
   - view: il markup del tool (view.html), inserito nella pagina
           solo la prima volta che il tool viene aperto
   - init: collega bottoni e lista file (riceve la <section> del tool)
   ============================================================= */
   import { $ } from '../../core/dom.js';
   import { formatBytes, isPdf, downloadBlob } from '../../core/files.js';
   import { setStatus, requireLib, runTask, setupDropzone, FileQueue } from '../../core/ui.js';
   import view from './view.html?raw';
   
   export { view };
   
   export function init(ws) {
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