const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { Jimp } = require('jimp');
const storage  = require('../storage');
const { analyzeImage } = require('../lib/analyze');

const os = require('os');

// Always save to OS temp dir first — works both locally and on Cloud Run
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `scan_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ============================================================
//  POST /api/process
// ============================================================
const PAGE_LIMIT         = parseInt(process.env.PAGE_LIMIT);
const GLOBAL_DAILY_LIMIT = parseInt(process.env.GLOBAL_DAILY_LIMIT);

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  const imagePath     = req.file.path;
  const imageFilename = req.file.filename;
  const deviceId      = req.headers['x-device-id'] || 'unknown';

  // --- Check 1: Per-device quota ---
  const existing = await storage.listScans(deviceId);
  if (existing.length >= PAGE_LIMIT) {
    fs.unlinkSync(imagePath);
    return res.status(403).json({ error: 'quota_exceeded', contact: process.env.CONTACT_EMAIL || '' });
  }

  try {
    // --- Check 2: Hash the raw upload and look for a cached result ---
    // Cache hit = skip Vision + Translate entirely (no API cost)
    const rawBuffer = fs.readFileSync(imagePath);
    const imageHash = crypto.createHash('sha256').update(rawBuffer).digest('hex');
    let analysisResult = await storage.getCachedResult(imageHash);
    const fromCache    = !!analysisResult;

    // --- Check 3: Global daily cap (only for cache misses — cache hits are free) ---
    if (!fromCache) {
      const dailyCount = await storage.getDailyCount();
      if (dailyCount >= GLOBAL_DAILY_LIMIT) {
        fs.unlinkSync(imagePath);
        return res.status(503).json({
          error:   'service_busy',
          message: 'Daily scan limit reached. Please try again tomorrow.'
        });
      }
    }

    // --- Step 0: Normalize orientation (always — needed for image stored in history) ---
    const image = await Jimp.read(imagePath);
    if (image.width > image.height) {
      image.rotate(-90);
    }
    image.brightness(1.2);
    await image.write(imagePath);

    // --- Steps 1–5: OCR + group + translate (skipped on cache hit) ---
    if (!fromCache) {
      analysisResult = await analyzeImage(imagePath);
      // Save to cache and increment counter — fire-and-forget, don't block response
      storage.setCachedResult(imageHash, analysisResult).catch(err => console.error('Cache write failed:', err));
      storage.incrementDailyCount().catch(err => console.error('Counter increment failed:', err));
    }

    const { imageWidth, imageHeight, words, lines } = analysisResult;

    // --- Step 6: Upload image to GCS or move to local uploads/ ---
    await storage.uploadImage(imagePath, imageFilename);

    // --- Step 7: Save scan metadata to storage ---
    const scan = await storage.saveScan({ imageFilename, imageWidth, imageHeight, words, lines, deviceId });

    res.json({
      id:          scan.id,
      imagePath:   `/uploads/${imageFilename}`,
      imageWidth,
      imageHeight,
      words,
      lines
    });

  } catch (err) {
    console.error('Processing error:', err);
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    const status = err.message.includes('No text detected') ? 422 : 500;
    res.status(status).json({ error: err.message || 'Failed to process image' });
  }
});

module.exports = router;
