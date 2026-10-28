import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import './style.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const GRIDS = { 2: { cols: 1, rows: 2 }, 4: { cols: 1, rows: 4 }, 6: { cols: 1, rows: 6 } };
let pages = [];
let pdfBlob = null;

const $ = id => document.getElementById(id);
const fileInput = $('fileInput'), dropzone = $('dropzone'), statusEl = $('status');
const thumbStrip = $('thumbStrip'), buildBtn = $('buildBtn'), clearBtn = $('clearBtn');
const downloadBtn = $('downloadBtn'), sheetsPreview = $('sheetsPreview'), sheetsNote = $('sheetsNote');
const autoInvertChk = $('autoInvert'), pdfFilenameInput = $('pdfFilename');

dropzone.onclick = () => fileInput.click();
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('drag'); handleFiles(e.dataTransfer.files); });

const progressWrap = $('progressWrap'), progressBar = $('progressBar');
function setProgress(frac) {
  if (frac === null) { progressWrap.classList.remove('active'); progressBar.style.width = '0%'; return; }
  progressWrap.classList.add('active');
  progressBar.style.width = Math.round(frac * 100) + '%';
}

function detectDark(canvas) {
  const s = document.createElement('canvas'); s.width = 32; s.height = 32;
  const sc = s.getContext('2d'); sc.drawImage(canvas, 0, 0, 32, 32);
  const data = sc.getImageData(0, 0, 32, 32).data;
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { sum += (data[i] + data[i + 1] + data[i + 2]) / 3; n++; }
  return (sum / n) < 110;
}

function addThumb(idx) {
  const p = pages[idx];
  p.thumbUrl = p.thumbUrl || p.canvas.toDataURL('image/jpeg', 0.5);
  const wrap = document.createElement('div');
  wrap.className = 'thumb' + (p.invert ? ' inv' : '');
  const img = document.createElement('img');
  img.src = p.thumbUrl;
  wrap.appendChild(img);
  const label = document.createElement('span'); label.className = 'num'; label.textContent = idx + 1;
  wrap.appendChild(label);
  const rm = document.createElement('button');
  rm.type = 'button'; rm.className = 'rm'; rm.textContent = '×';
  rm.onclick = (e) => { e.stopPropagation(); removeSlide(idx); };
  wrap.appendChild(rm);
  wrap.onclick = () => { p.invert = !p.invert; wrap.classList.toggle('inv', p.invert); };
  thumbStrip.appendChild(wrap);
}

function removeSlide(idx) {
  pages.splice(idx, 1);
  thumbStrip.innerHTML = '';
  pages.forEach((_, i) => addThumb(i));
  statusEl.textContent = pages.length ? `${pages.length} slide(s) loaded.` : 'No slides loaded.';
  buildBtn.disabled = pages.length === 0;
}

async function loadPdfFile(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  for (let i = 1; i <= pdf.numPages; i++) {
    statusEl.textContent = `Rendering page ${i} of ${pdf.numPages}…`;
    setProgress(i / pdf.numPages);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const invert = autoInvertChk.checked && detectDark(canvas);
    pages.push({ canvas, invert });
    addThumb(pages.length - 1);
  }
}

async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im); im.onerror = rej;
    im.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const invert = autoInvertChk.checked && detectDark(canvas);
  pages.push({ canvas, invert });
  addThumb(pages.length - 1);
}

async function handleFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  buildBtn.disabled = true;
  for (const f of files) {
    if (f.type === 'application/pdf') await loadPdfFile(f);
    else if (f.type.startsWith('image/')) await loadImageFile(f);
  }
  setProgress(null);
  statusEl.textContent = `${pages.length} slide(s) loaded. Ready to build.`;
  buildBtn.disabled = pages.length === 0;
}

fileInput.onchange = (e) => { handleFiles(e.target.files); fileInput.value = ''; };

clearBtn.onclick = () => {
  pages = []; thumbStrip.innerHTML = ''; sheetsPreview.innerHTML = '';
  pdfBlob = null; downloadBtn.disabled = true; buildBtn.disabled = true;
  setProgress(null);
  statusEl.textContent = 'No slides loaded.'; sheetsNote.textContent = 'Build the PDF to preview layout sheets.';
};

function padOrder(list, perSheet, mode) {
  const arr = list.slice();
  const rem = arr.length % perSheet;
  if (rem === 0) return arr;
  const need = perSheet - rem;
  for (let i = 0; i < need; i++) {
    if (mode === 'blank') arr.push(null);
    else if (mode === 'first') arr.push(list[0]);
    else arr.push(list[list.length - 1]);
  }
  return arr;
}

buildBtn.onclick = async () => {
  if (!pages.length) return;
  buildBtn.disabled = true;
  const perSheet = +$('perSheet').value;
  const { cols, rows } = GRIDS[perSheet];
  const padMode = $('padMode').value;
  const paper = $('paper').value;
  const ordered = padOrder(pages, perSheet, padMode);

  const doc = new jsPDF({ unit: 'mm', format: paper });
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
  const margin = 5, cellW = (pageW - margin * 2) / cols, cellH = (pageH - margin * 2) / rows;
  const pxPerMm = 7.5;

  sheetsPreview.innerHTML = '';
  let sheetCount = 0;
  const totalSheets = Math.ceil(ordered.length / perSheet);
  for (let s = 0; s < ordered.length; s += perSheet) {
    sheetCount++;
    statusEl.textContent = `Composing sheet ${sheetCount} of ${totalSheets}…`;
    setProgress(sheetCount / totalSheets);
    const chunk = ordered.slice(s, s + perSheet);
    const sc = document.createElement('canvas');
    sc.width = Math.round(pageW * pxPerMm); sc.height = Math.round(pageH * pxPerMm);
    const ctx = sc.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sc.width, sc.height);

    chunk.forEach((p, i) => {
      const col = Math.floor(i / rows), row = i % rows;
      const cx = (margin + col * cellW) * pxPerMm, cy = (margin + row * cellH) * pxPerMm;
      const cw = cellW * pxPerMm, ch = cellH * pxPerMm;
      ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1; ctx.strokeRect(cx, cy, cw, ch);
      if (!p) return;
      const pad = 2 * pxPerMm, availW = cw - pad * 2, availH = ch - pad * 2;
      const scale = Math.min(availW / p.canvas.width, availH / p.canvas.height);
      const dw = p.canvas.width * scale, dh = p.canvas.height * scale;
      const dx = cx + pad + (availW - dw) / 2, dy = cy + pad + (availH - dh) / 2;
      ctx.save();
      if (p.invert) ctx.filter = 'invert(1)';
      ctx.drawImage(p.canvas, dx, dy, dw, dh);
      ctx.restore();
    });

    const imgData = sc.toDataURL('image/jpeg', 0.9);
    if (s > 0) doc.addPage();
    doc.addImage(imgData, 'JPEG', 0, 0, pageW, pageH);

    const thumb = document.createElement('img');
    thumb.src = sc.toDataURL('image/jpeg', 0.5);
    sheetsPreview.appendChild(thumb);
  }

  pdfBlob = doc.output('blob');
  downloadBtn.disabled = false;
  setProgress(null);
  sheetsNote.textContent = `${sheetCount} printable page(s) built from ${pages.length} slide(s).`;
  statusEl.textContent = `Done — ${sheetCount} page(s) ready.`;
  buildBtn.disabled = false;
};

downloadBtn.onclick = () => {
  if (!pdfBlob) return;
  let filename = pdfFilenameInput.value.trim() || 'deckpress.pdf';
  if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};