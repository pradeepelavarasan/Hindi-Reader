/**
 * Storage abstraction.
 * - Local mode (default):  reads/writes to ./data/ and ./uploads/
 * - GCS mode (production): reads/writes to gs://GCS_BUCKET/data/ and gs://GCS_BUCKET/uploads/
 *
 * Set the GCS_BUCKET environment variable to enable GCS mode.
 * All public functions are async so both modes share the same calling interface.
 */
const fs   = require('fs');
const path = require('path');

const USE_GCS   = !!process.env.GCS_BUCKET;
const dataDir   = path.join(__dirname, 'data');
const indexFile = path.join(dataDir, 'index.json');

// ---- GCS helpers ------------------------------------------------

function gcsClient() {
  const { Storage } = require('@google-cloud/storage');
  const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return keyFilename ? new Storage({ keyFilename }) : new Storage();
}

function gcsBucket() {
  return gcsClient().bucket(process.env.GCS_BUCKET);
}

async function gcsRead(filePath) {
  const [contents] = await gcsBucket().file(filePath).download();
  return contents.toString('utf8');
}

async function gcsWrite(filePath, content) {
  await gcsBucket().file(filePath).save(content, { contentType: 'application/json' });
}

// ---- Local helpers ----------------------------------------------

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

// ---- Index (list of scans) --------------------------------------

async function readIndex() {
  if (USE_GCS) {
    try { return JSON.parse(await gcsRead('data/index.json')); }
    catch { return []; }
  }
  ensureDataDir();
  if (!fs.existsSync(indexFile)) return [];
  try { return JSON.parse(fs.readFileSync(indexFile, 'utf8')); }
  catch { return []; }
}

async function writeIndex(scans) {
  if (USE_GCS) {
    await gcsWrite('data/index.json', JSON.stringify(scans, null, 2));
    return;
  }
  ensureDataDir();
  fs.writeFileSync(indexFile, JSON.stringify(scans, null, 2));
}

// ---- Public API -------------------------------------------------

async function saveScan({ imageFilename, imageWidth, imageHeight, words, lines = [], sentences = [], deviceId = 'unknown' }) {
  const id        = Date.now();
  const createdAt = new Date().toISOString();
  const wordsData = JSON.stringify({ words, lines, sentences });

  if (USE_GCS) {
    await gcsWrite(`data/scan_${id}_words.json`, wordsData);
  } else {
    ensureDataDir();
    fs.writeFileSync(path.join(dataDir, `scan_${id}_words.json`), wordsData);
  }

  const entry = { id, createdAt, imageFilename, imageWidth, imageHeight, wordCount: words.length, lineCount: lines.length, deviceId };
  const index = await readIndex();
  index.unshift(entry);
  await writeIndex(index);
  return entry;
}

async function listScans(deviceId) {
  const index = await readIndex();
  if (!deviceId || deviceId === 'unknown') return index;
  return index.filter(s => s.deviceId === deviceId);
}

async function listAllScans() {
  return readIndex();
}

async function getScan(id) {
  const numId = Number(id);
  const index = await readIndex();
  const entry = index.find(s => s.id === numId);
  if (!entry) return null;

  let words = [], lines = [], sentences = [];
  try {
    let raw;
    if (USE_GCS) {
      raw = await gcsRead(`data/scan_${numId}_words.json`);
    } else {
      raw = fs.readFileSync(path.join(dataDir, `scan_${numId}_words.json`), 'utf8');
    }
    const data = JSON.parse(raw);
    if (Array.isArray(data)) { words = data; }
    else {
      words     = data.words     || [];
      lines     = data.lines     || [];
      // support both old 'paragraphs' key and new 'sentences' key
      sentences = data.sentences || data.paragraphs || [];
    }
  } catch { /* missing — return empty */ }

  return { ...entry, words, lines, sentences };
}

async function updateScan(id, { words, lines, sentences }) {
  const numId = Number(id);
  const wordsData = JSON.stringify({ words, lines, sentences });
  if (USE_GCS) {
    await gcsWrite(`data/scan_${numId}_words.json`, wordsData);
  } else {
    ensureDataDir();
    fs.writeFileSync(path.join(dataDir, `scan_${numId}_words.json`), wordsData);
  }
}

async function deleteScan(id) {
  const numId = Number(id);

  if (USE_GCS) {
    try { await gcsBucket().file(`data/scan_${numId}_words.json`).delete(); } catch {}
  } else {
    const wordsFile = path.join(dataDir, `scan_${numId}_words.json`);
    if (fs.existsSync(wordsFile)) fs.unlinkSync(wordsFile);
  }

  const index = (await readIndex()).filter(s => s.id !== numId);
  await writeIndex(index);
}

async function uploadImage(localPath, filename) {
  if (USE_GCS) {
    await gcsBucket().upload(localPath, { destination: `uploads/${filename}` });
  } else {
    const dest = path.join(__dirname, 'uploads', filename);
    if (localPath !== dest) fs.renameSync(localPath, dest);
  }
}

async function deleteImage(filename) {
  if (USE_GCS) {
    try { await gcsBucket().file(`uploads/${filename}`).delete(); } catch {}
  } else {
    const p = path.join(__dirname, 'uploads', filename);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

// ---- Hash cache (avoids re-calling Vision+Translate for duplicate images) ----

async function getCachedResult(hash) {
  const filePath = `data/cache/${hash}.json`;
  if (USE_GCS) {
    try { return JSON.parse(await gcsRead(filePath)); }
    catch { return null; }
  }
  const localPath = path.join(dataDir, 'cache', `${hash}.json`);
  if (!fs.existsSync(localPath)) return null;
  try { return JSON.parse(fs.readFileSync(localPath, 'utf8')); }
  catch { return null; }
}

async function setCachedResult(hash, result) {
  const filePath = `data/cache/${hash}.json`;
  const content  = JSON.stringify(result);
  if (USE_GCS) {
    await gcsWrite(filePath, content);
    return;
  }
  const cacheDir = path.join(dataDir, 'cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, `${hash}.json`), content);
}

// ---- Global daily counter (tracks API-calling scans only) ------------------

async function getDailyCount() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  if (USE_GCS) {
    try {
      const data = JSON.parse(await gcsRead('data/daily-counter.json'));
      return data.date === today ? data.count : 0;
    } catch { return 0; }
  }
  ensureDataDir();
  const localPath = path.join(dataDir, 'daily-counter.json');
  if (!fs.existsSync(localPath)) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    return data.date === today ? data.count : 0;
  } catch { return 0; }
}

async function incrementDailyCount() {
  const today    = new Date().toISOString().slice(0, 10);
  const count    = await getDailyCount();
  const newCount = count + 1;
  const content  = JSON.stringify({ date: today, count: newCount });
  if (USE_GCS) {
    await gcsWrite('data/daily-counter.json', content);
    return newCount;
  }
  ensureDataDir();
  fs.writeFileSync(path.join(dataDir, 'daily-counter.json'), content);
  return newCount;
}

module.exports = {
  saveScan, listScans, listAllScans, getScan, updateScan, deleteScan,
  uploadImage, deleteImage,
  getCachedResult, setCachedResult,
  getDailyCount, incrementDailyCount,
  USE_GCS
};
