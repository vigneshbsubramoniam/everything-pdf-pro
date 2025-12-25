import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const { PDFDocument } = window.PDFLib;

// DOM
const pdfInput = document.getElementById("pdfInput");
const addInput = document.getElementById("addInput");
const newBtn = document.getElementById("newBtn");
const buildBtn = document.getElementById("buildBtn");
const downloadBtn = document.getElementById("downloadBtn");
const shareBtn = document.getElementById("shareBtn");
const queueEl = document.getElementById("queue");
const statusEl = document.getElementById("status");
const shareOut = document.getElementById("shareOut");
const dropZone = document.getElementById("dropZone");

// Plan UI
const upgradeBtn = document.getElementById("upgradeBtn");
const downgradeBtn = document.getElementById("downgradeBtn");
const planPill = document.getElementById("planPill");
const planNote = document.getElementById("planNote");

const FREE_UPLOAD_LIMIT = 2;

// Persist (demo)
let isPro = localStorage.getItem("everythingpdf_isPro") === "1";

// State
let basePdfBytes = null;
let queue = []; // { file, kind: 'pdf'|'image' }
let builtBlob = null;

// Firebase (optional)
let storage = null;

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function updatePlanUI() {
  planPill.textContent = isPro ? "Pro" : "Free";
  planPill.style.borderColor = isPro ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.18)";
  planPill.style.background = isPro ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.06)";
  planPill.style.color = "rgba(255,255,255,.92)";

  upgradeBtn.disabled = isPro;
  downgradeBtn.disabled = !isPro;

  planNote.textContent = isPro
    ? "Pro enabled (demo): unlimited uploads."
    : `Free enabled: max ${FREE_UPLOAD_LIMIT} uploads per build.`;
}

function renderQueue() {
  queueEl.innerHTML = "";
  queue.forEach((item, idx) => {
    const li = document.createElement("li");
    li.dataset.index = String(idx);

    li.innerHTML = `
      <div class="fileMeta">
        <div class="fileName">${idx + 1}. ${escapeHtml(item.file.name)}</div>
        <div class="fileSub">${item.kind.toUpperCase()} • ${(item.file.size/1024).toFixed(1)} KB</div>
      </div>
      <div class="actions">
        <button class="iconBtn" title="Remove" data-del="${idx}">✕</button>
      </div>
    `;
    queueEl.appendChild(li);
  });

  queueEl.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.del);
      if (Number.isFinite(i)) {
        queue.splice(i, 1);
        renderQueue();
        setStatus("Removed from queue.");
      }
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeFiles(fileList) {
  return Array.from(fileList || []);
}

async function addFilesToQueue(files) {
  const incoming = normalizeFiles(files);
  if (incoming.length === 0) return;

  // Free plan limit: max 2 uploads total in queue
  if (!isPro) {
    const remaining = FREE_UPLOAD_LIMIT - queue.length;

    if (remaining <= 0) {
      alert(`Free plan allows only ${FREE_UPLOAD_LIMIT} uploads.\nClick "Upgrade to Pro" to add more.`);
      return;
    }

    if (incoming.length > remaining) {
      alert(`Free plan limit: only ${remaining} more upload(s) allowed.\nExtra files won’t be added.`);
      incoming.length = remaining;
    }
  }

  let added = 0;

  for (const file of incoming) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isImage = file.type.startsWith("image/");

    if (!isPdf && !isImage) {
      alert(`Unsupported: ${file.name}\nTip: export/print documents to PDF first, then upload.`);
      continue;
    }

    queue.push({ file, kind: isPdf ? "pdf" : "image" });
    added++;
  }

  renderQueue();
  setStatus(`Added ${added} file(s) to queue.`);
}

// ---- Plan buttons ----
upgradeBtn.addEventListener("click", () => {
  isPro = true;
  localStorage.setItem("everythingpdf_isPro", "1");
  updatePlanUI();
  setStatus("Pro enabled (demo). Upload limit removed.");
});

downgradeBtn.addEventListener("click", () => {
  isPro = false;
  localStorage.setItem("everythingpdf_isPro", "0");

  if (queue.length > FREE_UPLOAD_LIMIT) {
    queue = queue.slice(0, FREE_UPLOAD_LIMIT);
    renderQueue();
  }

  updatePlanUI();
  setStatus(`Switched to Free. Max uploads: ${FREE_UPLOAD_LIMIT}.`);
});

// ---- Base PDF ----
pdfInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  basePdfBytes = new Uint8Array(await file.arrayBuffer());
  builtBlob = null;
  downloadBtn.disabled = true;
  shareBtn.disabled = true;
  shareOut.innerHTML = "";
  setStatus(`Loaded base PDF: ${file.name}`);
  pdfInput.value = "";
});

newBtn.addEventListener("click", () => {
  basePdfBytes = null;
  queue = [];
  builtBlob = null;
  renderQueue();
  downloadBtn.disabled = true;
  shareBtn.disabled = true;
  shareOut.innerHTML = "";
  setStatus("Started a new empty PDF.");
});

// ---- File picker ----
addInput.addEventListener("change", async (e) => {
  await addFilesToQueue(e.target.files);
  addInput.value = "";
});

// ---- Drag & drop ----
["dragenter", "dragover"].forEach(evtName => {
  dropZone.addEventListener(evtName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach(evtName => {
  dropZone.addEventListener(evtName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("dragover");
  });
});

dropZone.addEventListener("drop", async (e) => {
  const dt = e.dataTransfer;
  if (!dt) return;
  await addFilesToQueue(dt.files);
});

// ---- Drag-to-reorder (SortableJS) ----
Sortable.create(queueEl, {
  animation: 150,
  onEnd: (evt) => {
    const { oldIndex, newIndex } = evt;
    if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
    const moved = queue.splice(oldIndex, 1)[0];
    queue.splice(newIndex, 0, moved);
    renderQueue();
    setStatus("Reordered queue.");
  }
});

// ---- Build PDF ----
buildBtn.addEventListener("click", async () => {
  try {
    setStatus("Building PDF...");
    shareOut.innerHTML = "";
    builtBlob = null;
    downloadBtn.disabled = true;
    shareBtn.disabled = true;

    const outDoc = basePdfBytes
      ? await PDFDocument.load(basePdfBytes)
      : await PDFDocument.create();

    for (const item of queue) {
      const bytes = new Uint8Array(await item.file.arrayBuffer());

      if (item.kind === "pdf") {
        const donor = await PDFDocument.load(bytes);
        const pages = await outDoc.copyPages(donor, donor.getPageIndices());
        pages.forEach(p => outDoc.addPage(p));
      } else {
        const isPng = item.file.type === "image/png";
        const embedded = isPng ? await outDoc.embedPng(bytes) : await outDoc.embedJpg(bytes);

        const { width, height } = embedded.scale(1);
        const page = outDoc.addPage([width, height]);
        page.drawImage(embedded, { x: 0, y: 0, width, height });
      }
    }

    const outBytes = await outDoc.save();
    builtBlob = new Blob([outBytes], { type: "application/pdf" });

    downloadBtn.disabled = false;
    shareBtn.disabled = false;
    setStatus(`Done. Built PDF from ${queue.length} upload(s).`);
  } catch (err) {
    console.error(err);
    setStatus("Build failed. Some PDFs may be encrypted or corrupted.");
    alert("Build failed. Some PDFs may be encrypted or corrupted.");
  }
});

// ---- Download ----
downloadBtn.addEventListener("click", () => {
  if (!builtBlob) return;
  const url = URL.createObjectURL(builtBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "everythingpdf.pdf";
  a.click();
  URL.revokeObjectURL(url);
});

// ---- Firebase init (optional) ----
function initFirebaseIfConfigured() {
  const firebaseConfig = window.__EVERYTHINGPDF_FIREBASE_CONFIG__;
  if (!firebaseConfig) return null;
  const app = initializeApp(firebaseConfig);
  storage = getStorage(app);
  return storage;
}
initFirebaseIfConfigured();

// ---- Share link (Firebase Storage) ----
shareBtn.addEventListener("click", async () => {
  if (!builtBlob) return;

  try {
    if (!storage) {
      alert("Sharing not configured yet. Add Firebase config in index.html and set Storage rules.");
      return;
    }

    setStatus("Uploading for public sharing...");
    const file = new File([builtBlob], `everythingpdf-${Date.now()}.pdf`, { type: "application/pdf" });

    const path = `public/${file.name}`;
    const r = sRef(storage, path);
    await uploadBytes(r, file, { contentType: "application/pdf" });

    const url = await getDownloadURL(r);
    shareOut.innerHTML = `Public link: <a href="${url}" target="_blank" rel="noreferrer">${url}</a>`;
    setStatus("Uploaded. Share link ready.");
  } catch (err) {
    console.error(err);
    setStatus("Upload failed. Check Firebase config and Storage rules.");
    alert("Upload failed. Check Firebase config and Storage rules.");
  }
});

// ---- Initial UI ----
updatePlanUI();
renderQueue();
setStatus(isPro ? "Pro enabled (demo)." : "Free enabled. Max 2 uploads.");
