// ============================================================
//  State
// ============================================================
let activeOverlay     = null;
let currentWords      = [];
let currentLines      = [];
let currentScanId     = null;
let currentMode       = 'words'; // 'words' | 'lines'

// ============================================================
//  View management
// ============================================================
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ============================================================
//  File input → process
// ============================================================
document.getElementById('file-camera').addEventListener('change', onFileSelected);
document.getElementById('file-gallery').addEventListener('change', onFileSelected);
document.getElementById('btn-history').addEventListener('click', openHistory);
document.getElementById('btn-scan-back').addEventListener('click', () => showView('view-home'));
document.getElementById('btn-mode-words').addEventListener('click', () => setMode('words'));
document.getElementById('btn-mode-lines').addEventListener('click', () => setMode('lines'));
document.getElementById('btn-retranslate').addEventListener('click', retranslate);
document.getElementById('btn-history-back').addEventListener('click', () => showView('view-home'));
document.getElementById('popup-backdrop').addEventListener('click', closePopup);

// ============================================================
//  Device ID — generated once, stored in localStorage
// ============================================================
function getDeviceId() {
  let id = localStorage.getItem('hindi_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('hindi_device_id', id);
  }
  return id;
}

function onFileSelected(e) {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file
  if (!file) return;
  uploadAndProcess(file);
}

// ============================================================
//  Upload + process
// ============================================================
async function uploadAndProcess(file) {
  showView('view-processing');
  setProcessingStep('ocr');

  const formData = new FormData();
  formData.append('image', file);

  // Advance the step indicator mid-flight (approximate timing)
  const translateTimer = setTimeout(() => setProcessingStep('translate'), 5000);
  const doneTimer     = setTimeout(() => setProcessingStep('done'), 9000);

  try {
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'X-Device-Id': getDeviceId() },
      body: formData
    });
    clearTimeout(translateTimer);
    clearTimeout(doneTimer);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.error === 'quota_exceeded') {
        showQuotaMessage(err.contact);
        showView('view-home');
        return;
      }
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const data = await res.json();
    renderScan(data);
    showView('view-scan');
  } catch (err) {
    clearTimeout(translateTimer);
    clearTimeout(doneTimer);
    showToast(err.message);
    showView('view-home');
  }
}

function setProcessingStep(step) {
  const steps = { ocr: 0, translate: 1, done: 2 };
  const labels = {
    ocr:       ['Reading Hindi text...', 'Scanning the page for words'],
    translate: ['Translating words...',  'Finding English meanings'],
    done:      ['Almost ready!',         'Preparing the page']
  };

  document.getElementById('processing-status').textContent = labels[step][0];
  document.getElementById('processing-sub').textContent    = labels[step][1];

  const dots = document.querySelectorAll('.step-dot');
  const idx  = steps[step];
  dots.forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i < idx)  dot.classList.add('done');
    if (i === idx) dot.classList.add('active');
  });
}

// ============================================================
//  Render scan
// ============================================================
function renderScan(data) {
  currentWords      = data.words     || [];
  currentLines      = data.lines     || [];
  currentScanId     = data.id || null;
  currentMode       = 'words';

  const img      = document.getElementById('scan-image');
  const overlays = document.getElementById('word-overlays');
  overlays.innerHTML = '';

  // Reset toggle buttons
  document.getElementById('btn-mode-words').classList.add('active');
  document.getElementById('btn-mode-lines').classList.remove('active');
  updateHint();

  document.getElementById('scan-word-count').textContent =
    `${currentWords.length} word${currentWords.length !== 1 ? 's' : ''}`;

  img.onload = () => buildOverlays();
  img.src = data.imagePath;
  if (img.complete && img.naturalWidth > 0) buildOverlays();
}

function setMode(mode) {
  currentMode = mode;
  document.getElementById('btn-mode-words').classList.toggle('active', mode === 'words');
  document.getElementById('btn-mode-lines').classList.toggle('active', mode === 'lines');
  updateHint();
  closePopup();
  buildOverlays();
}

function updateHint() {
  // hint text removed from header — no-op kept for compatibility
}

function buildOverlays() {
  const overlays = document.getElementById('word-overlays');
  overlays.innerHTML = '';
  closePopup();

  const items = currentMode === 'words' ? currentWords : currentLines;

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'word-tap';
    el.style.left   = `${item.x}%`;
    el.style.top    = `${item.y}%`;
    el.style.width  = `${Math.max(item.w, 3)}%`;
    el.style.height = `${Math.max(item.h, 3)}%`;

    el.addEventListener('click', e => {
      e.stopPropagation();
      tapWord(el, item);
    });

    el.addEventListener('touchstart', e => {
      e.stopPropagation();
    }, { passive: true });

    overlays.appendChild(el);
  });
}

// ============================================================
//  Word popup
// ============================================================
function tapWord(el, item) {
  if (activeOverlay) activeOverlay.classList.remove('tapped');
  activeOverlay = el;
  el.classList.add('tapped');

  const hindiEl   = document.getElementById('popup-hindi');
  const meaningEl = document.getElementById('popup-meaning');

  hindiEl.textContent   = item.word || item.text;
  meaningEl.textContent = item.meaning;

  document.getElementById('popup-backdrop').classList.add('visible');
  document.getElementById('word-popup').classList.add('visible');
}

function closePopup() {
  document.getElementById('popup-backdrop').classList.remove('visible');
  document.getElementById('word-popup').classList.remove('visible');
  if (activeOverlay) {
    activeOverlay.classList.remove('tapped');
    activeOverlay = null;
  }
}

// Tapping the image background (not a word) also closes the popup
document.getElementById('scan-container').addEventListener('click', closePopup);

// ============================================================
//  Re-translate
// ============================================================
async function retranslate() {
  if (!currentScanId) { showToast('No scan loaded'); return; }

  const btn = document.getElementById('btn-retranslate');
  btn.disabled = true;
  btn.textContent = 'Translating…';

  try {
    const res = await fetch(`/api/history/${currentScanId}/retranslate`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }
    const data = await res.json();
    currentWords      = data.words     || [];
    currentLines      = data.lines     || [];
    document.getElementById('scan-word-count').textContent =
      `${currentWords.length} word${currentWords.length !== 1 ? 's' : ''}`;
    buildOverlays();
    showToast('Re-translated!');
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg> Re-translate';
  }
}

// ============================================================
//  History
// ============================================================
async function openHistory() {
  showView('view-history');
  await loadHistory();
}

async function loadHistory() {
  const list  = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  list.innerHTML = '';

  let scans;
  try {
    const res = await fetch('/api/history', {
      headers: { 'X-Device-Id': getDeviceId() }
    });
    scans = await res.json();
  } catch {
    showToast('Could not load history');
    return;
  }

  if (!scans.length) {
    list.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  list.style.display = 'grid';
  empty.style.display = 'none';

  scans.forEach(scan => {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <img class="history-card-thumb" src="${scan.imagePath}" alt="Scan from ${formatDate(scan.createdAt)}" loading="lazy">
      <div class="history-card-meta">
        <div class="history-card-date">${formatDate(scan.createdAt)}</div>
        <div class="history-card-count">${scan.wordCount} words</div>
      </div>
      <button class="history-card-delete" data-id="${scan.id}" title="Delete">✕</button>
    `;

    // Tap card → open scan (but not if the delete button was tapped)
    card.addEventListener('click', async e => {
      if (e.target.classList.contains('history-card-delete')) {
        await deleteScan(scan.id);
      } else {
        await openScanFromHistory(scan.id);
      }
    });

    list.appendChild(card);
  });
}

async function openScanFromHistory(id) {
  try {
    const res  = await fetch(`/api/history/${id}`);
    const data = await res.json();
    renderScan(data);
    showView('view-scan');
  } catch {
    showToast('Could not load this scan');
  }
}

function showConfirm() {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    overlay.classList.add('active');
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    function cleanup() {
      overlay.classList.remove('active');
      document.getElementById('confirm-ok').removeEventListener('click', onOk);
      document.getElementById('confirm-cancel').removeEventListener('click', onCancel);
    }
    document.getElementById('confirm-ok').addEventListener('click', onOk);
    document.getElementById('confirm-cancel').addEventListener('click', onCancel);
  });
}

async function deleteScan(id) {
  if (!await showConfirm()) return;
  try {
    await fetch(`/api/history/${id}`, { method: 'DELETE' });
    await loadHistory();
  } catch {
    showToast('Could not delete scan');
  }
}

// ============================================================
//  Helpers
// ============================================================
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function showQuotaMessage(contact) {
  const toast = document.getElementById('error-toast');
  if (contact) {
    const subject = encodeURIComponent('Hindi reader app needs more quota');
    const body    = encodeURIComponent('Hi,\n\nI have used up my 20-page quota on the Hindi Reader app and would like more access.\n\nDevice ID: ' + getDeviceId());
    const mailto  = `mailto:${contact}?subject=${subject}&body=${body}`;
    toast.innerHTML = `You've scanned 20 pages — that's the free limit! <a href="${mailto}" style="color:#fff;text-decoration:underline;">Tap here to request more access.</a>`;
  } else {
    toast.textContent = `You've scanned 20 pages — that's the free limit! Please contact the app owner to request more access.`;
  }
  toast.classList.add('visible');
  // Keep this one visible longer since it needs to be read and acted on
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 12000);
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('error-toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

// ============================================================
//  Boot
// ============================================================
showView('view-home');
