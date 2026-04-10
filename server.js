require('dotenv').config();
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const rateLimit  = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust Cloud Run / GCP's load balancer so req.ip reflects the real client IP
app.set('trust proxy', true);

// IP-based rate limit per 24-hour window
const scanLimiter = rateLimit({
  windowMs:        24 * 60 * 60 * 1000,
  max:             parseInt(process.env.IP_RATE_LIMIT),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'rate_limit_exceeded', message: 'Daily scan limit reached from this network. Try again tomorrow.' }
});
app.use('/api/process', scanLimiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Image serving — proxy from GCS in production, static files locally
if (process.env.GCS_BUCKET) {
  const { Storage } = require('@google-cloud/storage');
  const storageClient = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? new Storage({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS })
    : new Storage();
  const bucket = storageClient.bucket(process.env.GCS_BUCKET);

  app.get('/uploads/:filename', (req, res) => {
    const file = bucket.file(`uploads/${req.params.filename}`);
    res.setHeader('Cache-Control', 'max-age=3600');
    file.createReadStream()
      .on('error', () => res.status(404).send('Image not found'))
      .pipe(res);
  });
} else {
  // Local mode — ensure uploads dir exists and serve statically
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));
}

app.use('/api/process', require('./routes/process'));
app.use('/api/history', require('./routes/history'));
app.use('/admin', require('./routes/admin'));

app.listen(PORT, '0.0.0.0', () => {
  const isGCS = !!process.env.GCS_BUCKET;
  console.log('');
  console.log('  Hindi Reader is running!');
  console.log('');
  if (isGCS) {
    console.log(`  URL:    http://localhost:${PORT}`);
    console.log(`  Mode:   Cloud (GCS bucket: ${process.env.GCS_BUCKET})`);
  } else {
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Tablet:  http://<your-computer-ip>:${PORT}`);
    console.log('');
    console.log('  To find your computer IP on Windows, run: ipconfig');
  }
  console.log('');
});
