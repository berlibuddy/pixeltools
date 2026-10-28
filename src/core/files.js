/* =============================================================
   PixelTools — src/core/files.js
   Aiuti per i file (condivisi da tutti i tool)
   - formatBytes, baseName, extOf: nomi e dimensioni
   - isPdf, isImage:               che tipo di file è?
   - downloadBlob:                 fa scaricare un file
   - uniqueName:                   evita nomi doppi ("foto (2).jpg")
   - pathOf, filesFromDrop:        cartelle trascinate (per lo ZIP)
   ============================================================= */
   import { h } from './dom.js';

   /** 1536000 → "1.5 MB" */
   export function formatBytes(bytes) {
     if (bytes < 1024) return `${bytes} B`;
     const units = ['KB', 'MB', 'GB'];
     let value = bytes / 1024;
     let i = 0;
     while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
     return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
   }
   
   export const baseName = (name) => name.replace(/\.[^./]+$/, '');            // "foto.jpg" → "foto"
   export const extOf = (name) => (name.match(/\.([^./]+)$/)?.[1] || '').toLowerCase();
   export const isPdf = (f) => f.type === 'application/pdf' || extOf(f.name) === 'pdf';
   export const isImage = (f) => f.type.startsWith('image/');
   
   /** Fa scaricare un Blob come file */
   export function downloadBlob(blob, filename) {
     const url = URL.createObjectURL(blob);
     const a = h('a', { href: url, download: filename });
     document.body.append(a);
     a.click();
     a.remove();
     // Il browser ha bisogno di un attimo prima di poter liberare l'URL
     setTimeout(() => URL.revokeObjectURL(url), 10_000);
   }
   
   /** Evita nomi duplicati: "foto.jpg" → "foto (2).jpg" */
   export function uniqueName(name, used) {
     if (!used.has(name)) { used.add(name); return name; }
     const dot = name.lastIndexOf('.');
     const slash = name.lastIndexOf('/');
     const hasExt = dot > slash + 1;
     const stem = hasExt ? name.slice(0, dot) : name;
     const ext = hasExt ? name.slice(dot) : '';
     let i = 2;
     let candidate;
     do { candidate = `${stem} (${i++})${ext}`; } while (used.has(candidate));
     used.add(candidate);
     return candidate;
   }
   
   /* Percorsi relativi dei file presi da cartelle trascinate (per lo ZIP) */
   const relPaths = new WeakMap();
   export const pathOf = (f) => relPaths.get(f) || f.webkitRelativePath || f.name;
   
   /** Legge ricorsivamente le cartelle trascinate, salvando il percorso relativo */
   export async function filesFromDrop(dataTransfer) {
     // Le "entry" vanno lette SUBITO: dopo il primo await il DataTransfer non è più valido
     const entries = Array.from(dataTransfer.items || [])
       .map((item) => item.webkitGetAsEntry?.())
       .filter(Boolean);
     if (!entries.length) return Array.from(dataTransfer.files);
   
     const out = [];
     const readFile = (entry) => new Promise((res, rej) => entry.file(res, rej));
     const readBatch = (reader) => new Promise((res, rej) => reader.readEntries(res, rej));
   
     async function walk(entry, prefix) {
       if (entry.isFile) {
         const file = await readFile(entry);
         relPaths.set(file, prefix + file.name);
         out.push(file);
       } else if (entry.isDirectory) {
         const reader = entry.createReader();
         const dir = `${prefix}${entry.name}/`;
         let batch;
         do { // readEntries restituisce al massimo ~100 voci per volta
           batch = await readBatch(reader);
           for (const child of batch) await walk(child, dir);
         } while (batch.length);
       }
     }
     for (const entry of entries) await walk(entry, '');
     return out;
   }