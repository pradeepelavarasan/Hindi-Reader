const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const storage  = require('../storage');
const { analyzeImage } = require('../lib/analyze');

// GET /api/history — list scans for this device only
router.get('/', async (req, res) => {
  const deviceId = req.headers['x-device-id'] || 'unknown';
  const scans = await storage.listScans(deviceId);
  res.json(scans.map(s => ({
    id:          s.id,
    createdAt:   s.createdAt,
    imagePath:   `/uploads/${s.imageFilename}`,
    imageWidth:  s.imageWidth,
    imageHeight: s.imageHeight,
    wordCount:   s.wordCount
  })));
});

// GET /api/history/:id — single scan with words
router.get('/:id', async (req, res) => {
  const scan = await storage.getScan(req.params.id);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });
  res.json({
    id:          scan.id,
    createdAt:   scan.createdAt,
    imagePath:   `/uploads/${scan.imageFilename}`,
    imageWidth:  scan.imageWidth,
    imageHeight: scan.imageHeight,
    words:       scan.words,
    lines:       scan.lines
  });
});

// POST /api/history/:id/retranslate — re-run full OCR + translation on the stored image
router.post('/:id/retranslate', async (req, res) => {
  const scan = await storage.getScan(req.params.id);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });

  let tempFile = null;
  try {
    let imagePath;

    if (storage.USE_GCS) {
      // Download image from GCS to a temp file, analyze, then delete
      const { Storage } = require('@google-cloud/storage');
      const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const gcs    = credentials ? new Storage({ keyFilename: credentials }) : new Storage();
      tempFile     = path.join(os.tmpdir(), `retranslate_${scan.id}_${scan.imageFilename}`);
      await gcs.bucket(process.env.GCS_BUCKET).file(`uploads/${scan.imageFilename}`).download({ destination: tempFile });
      imagePath = tempFile;
    } else {
      imagePath = path.join(__dirname, '..', 'uploads', scan.imageFilename);
    }

    const { imageWidth, imageHeight, words, lines } = await analyzeImage(imagePath);

    await storage.updateScan(scan.id, { words, lines });

    res.json({
      id:          scan.id,
      imagePath:   `/uploads/${scan.imageFilename}`,
      imageWidth,
      imageHeight,
      words,
      lines
    });
  } catch (err) {
    console.error('Retranslate error:', err);
    res.status(500).json({ error: 'Retranslation failed', detail: err.message });
  } finally {
    if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

// DELETE /api/history/:id
router.delete('/:id', async (req, res) => {
  const scan = await storage.getScan(req.params.id);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });
  await storage.deleteImage(scan.imageFilename);
  await storage.deleteScan(req.params.id);
  res.json({ success: true });
});

module.exports = router;
