/* =============================================================
   PixelTools — src/tools/img2pdf/tool.js
   TOOL — IMMAGINI IN PDF: ogni immagine diventa una pagina (pdf-lib).
   - view: il markup del tool (view.html), inserito nella pagina
           solo la prima volta che il tool viene aperto
   - init: collega i comandi (riceve la <section> del tool)
   ============================================================= */
   import { $ } from '../../core/dom.js';
   import { formatBytes, isImage, downloadBlob } from '../../core/files.js';
   import { fileToCanvas, canvasToBlob } from '../../core/images.js';
   import { setStatus, requireLib, runTask, setupDropzone, FileQueue } from '../../core/ui.js';
   import { CONFIG } from '../../core/config.js';
   import view from './view.html?raw';
   
   export { view };
   
   export function init(ws) {
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