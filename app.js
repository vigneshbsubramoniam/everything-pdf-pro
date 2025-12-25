import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const { PDFDocument } = window.PDFLib;

const pdfInput = document.getElementById("pdfInput");
const addInput = document.getElementById("addInput");
const newBtn = document.getElementById("newBtn");
const buildBtn = document.getElementById("buildBtn");
const downloadBtn = document.getElementById("downloadBtn");
const shareBtn = document.getElementById("shareBtn");
const queueEl = document.getElementById("queue");
const statusEl = document.getElementById("status");
const shareOut = document.getElementById("shareOut");

// Plan UI
const upgradeBtn = document.getElementById("upgradeBtn");
const downgradeBtn = document.getElementById("downgradeBtn");
const planPill = document.getElementById("planPill");
const planNote = document.getElementById("planNote");

const FREE_UPLOAD_LIMIT = 2;

// Persist plan choice (optional but nice)
let isPro = localStorage.getItem("everythingpdf_isPro") === "1";

let basePdfBytes = null;
let queue = []; // { file, kind: 'pdf'|'image' }
let builtBlob = null;

// ---------- UI helpers ----------
function setStatus(msg) { statusEl.textContent = msg; }

function updatePlanUI() {
  planPill.textContent = isPro ? "Pro" : "Free";
  planPill.style.borderColor = isPro ? "#111" : "#ddd";
  planPill.style.background = isPro ? "#111" : "#f1f3f8";
  planPill.style.color = isPro ? "#fff" : "#111";

  upgradeBtn.disabled = isPro;
  downgradeBtn.disabled = !isPro;

  planNote.textContent = isPro
    ? "Pro enabled: unlimited uploads."
    : `Free enabled: you can add up to ${FREE_UPLOAD_LIMIT} uploads.`;
}
updatePlanUI();

upgradeBtn.addEventListener("click", () => {
  isPro = true;
  localStorage.setItem("everythingpdf_isPro", "1");
  updatePlanUI();
  setStatus("Pro enabled (demo). Upload limit removed.");
});

downgradeBtn.addEventListener("click", () => {
  isPro = false;
  localStorage.setItem("everythingpdf_isPro", "0");

  // Trim queue if it exceeds free limit
  if (queue.length > FREE_UPLOAD_LIMIT) {
    queue = queue.slice(0, FREE_UPLOAD_LIMIT);
    renderQueue();
  }

  updatePlanUI();
  setStatus(`Switched to Free. Max uploads: ${FREE_UPLOAD_LIMIT}.`);
});

function renderQueue() {
  queueEl.innerHTML = "";
  queue.forEach((item, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <div><strong>${idx + 1}.</strong> ${item.file.name}</div>
        <div class="small">${item.kind.toUpperCase()} • ${(item.file.size/1024).toFixed(1)} KB</div>
      </div>
      <div class="row">
        <button class="btn" data-up="${idx}">↑</button>
        <button class="btn" data-down="${idx}">↓</button>
        <button class="btn" data-del="${idx}">Remove</button>
      </div>
    `;
    queueEl.appendChild(li);
  });

  queueEl.querySelectorAll("[data-up]").forEach(b => b.onclick = () => move(+b.dataset.up, -1));
  queueEl.querySelectorAll("[data-down]").forEach(b => b.onclick = () => move(+b.dataset.down, +1));
  queueEl.querySelectorAll("[data-del]").forEach(b => b.onclick = () => del(+b.dataset.del));
}

function move(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= queue.length) return;
  [queue[i], queue[j]] = [queue[j], queue[i]];
  renderQueue();
}

function del(i) {
  queue.splice(i, 1);
  renderQueue();
}

// ---------- base PDF ----------
pdfInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  basePdfBytes = new Uint8Array(await file.arrayBuffer());
  builtBlob = null;
  downloadBtn.disabled = true;
  shareBtn.disabled = true;
  shareOut.innerHTML = "";
  setStatus(`Loaded base PDF: ${file.name}`);
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

// ---------- add pages (enforce Free limit) ----------
addInput.addEventListener("change", async (e) => {
  const incoming = Array.from(e.target.files || []);
  if (incoming.length === 0) return;

  if (!isPro) {
    const remaining = FREE_UPLOAD_LIMIT - queue.length;

    if (remaining <= 0) {
      alert(`Free plan allows only ${FREE_UPLOAD_LIMIT} uploads.\nClick "Upgrade to Pro" to add more.`);
      addInput.value = "";
      return;
    }

    if (incoming.length > remaining) {
      alert(`Free plan limit: only ${remaining} more upload(s) allowed.\nExtra files won’t be added.`);
      incoming.length = remaining; // keep only allowed
    }
  }

  for (const file of incoming) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isImage = file.type.startsWith("image/");

    if (!isPdf && !isImage) {
      alert(`Unsupported: ${file.name}\nTip: export/print documents to PDF first, then upload.`);
      continue;
    }

    queue.push({ file, kind: isPdf ? "pdf" : "image" });
  }

  renderQueue();
  setStatus(`Added ${incoming.length} file(s) to queue.`);
  addInput.value = "";
});

// ---------- build merged pdf ----------
buildBtn.addEventListener("click", async () => {
  try {
    setStatus("Building PDF...");
    shareOut.innerHTML = "";

    const outDoc = basePdfBytes
      ? await PDFDocument.load(basePdfBytes)
      : await PDFDocument.create();

    for (const item of queue) {
      const bytes = new Uint8Array(await item.file.arrayBuffer());

      if (item.kind === "pdf") {
        const donor = await PDFDocument.load(bytes);
        const donorPages = await outDoc.copyPages(donor, donor.getPageIndices());
        donorPages.forEach(p => outDoc.addPage(p));
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
    setStatus(`Done. Appended ${queue.length} upload(s).`);
  } catch (err) {
    console.error(err);
    setStatus("Build failed. See console for details.");
    alert("Build failed. Some PDFs may be encrypted or corrupted.");
  }
});

downloadBtn.addEventListener("click", () => {
  if (!builtBlob) return;
  const url = URL.createObjectURL(builtBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "everythingpdf.pdf";
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- optional: public share link via Firebase ----------
let storage = null;

function initFirebaseIfConfigured() {
  const firebaseConfig = window.__EVERYTHINGPDF_FIREBASE_CONFIG__;
  if (!firebaseConfig) return null;

  const app = initializeApp(firebaseConfig);
  storage = getStorage(app);
  return storage;
}
initFirebaseIfConfigured();

shareBtn.addEventListener("click", async () => {
  if (!builtBlob) return;

  try {
    if (!storage) {
      alert("Sharing not configured yet. Do Step 12 (Firebase) or remove the Share feature.");
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
    setStatus("Upload failed. Check Firebase rules/config.");
    alert("Upload failed. Make sure Firebase Storage rules allow public read/write (Step 12).");
  }
});
