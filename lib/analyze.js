/**
 * Core OCR + translation pipeline.
 * Takes a local image path, returns { imageWidth, imageHeight, words, lines }.
 * Used by both the upload route (process.js) and the retranslate route (history.js).
 */
const vision        = require('@google-cloud/vision');
const { Translate } = require('@google-cloud/translate').v2;

// ============================================================
//  Hindi stop words — only content words get translated
// ============================================================
const STOP_WORDS = new Set([
  'है','हैं','था','थे','थी','थीं','हो','हूँ','होना','होता','होती','होते',
  'हुआ','हुई','हुए','हुईं','रहा','रही','रहे','रहीं',
  'और','या','किंतु','परंतु','लेकिन','मगर','बल्कि','तथा','एवं','व',
  'कि','जो','जब','तो','फिर','अगर','यदि','तब','क्योंकि',
  'का','की','के','में','से','को','पर','तक','पे','ने','द्वारा',
  'लिए','लिये','साथ','बिना','पास','बारे',
  'यह','वह','ये','वे','मैं','हम','तुम','आप','वो',
  'मुझे','मुझको','मेरा','मेरी','मेरे',
  'तुम्हें','तुम्हारा','तुम्हारी','तुम्हारे',
  'उसे','उसको','उसका','उसकी','उसके',
  'इसे','इसको','इसका','इसकी','इसके',
  'इन्हें','उन्हें','हमें','हमारा','हमारी','हमारे',
  'आपको','आपका','आपकी','आपके',
  'इस','उस','इन','उन','यहाँ','वहाँ','इधर','उधर','जहाँ',
  'एक','सब','सभी','कोई','कुछ','कई','अन्य','दूसरा','दूसरी','दूसरे',
  'ही','भी','न','ना','नहीं','नही','हाँ','जी',
  'अब','फिर','कभी','सदा','हमेशा','अक्सर',
  'क्या','कैसे','कहाँ','कब','कौन','कितना','कितनी','कितने','क्यों',
  'अपना','अपनी','अपने','अपनो',
  'अंदर','बाहर','ऊपर','नीचे','आगे','पीछे','पहले','बाद',
  'वाला','वाली','वाले',
  'जैसा','जैसी','जैसे','जितना','जितनी','जितने',
  'सा','सी'
]);

function isHindi(text) {
  return /[\u0900-\u097F]/.test(text);
}

function extractBBox(vertices) {
  const xs = vertices.map(v => v.x || 0);
  const ys = vertices.map(v => v.y || 0);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys)
  };
}

function groupIntoLines(words) {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) =>
    (a.bbox.y + a.bbox.h / 2) - (b.bbox.y + b.bbox.h / 2)
  );
  const lines = [];
  let group = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev  = sorted[i - 1];
    const curr  = sorted[i];
    const prevCY = prev.bbox.y + prev.bbox.h / 2;
    const currCY = curr.bbox.y + curr.bbox.h / 2;
    const avgH   = (prev.bbox.h + curr.bbox.h) / 2;
    if (Math.abs(currCY - prevCY) < avgH * 0.75) {
      group.push(curr);
    } else {
      lines.push(group);
      group = [curr];
    }
  }
  lines.push(group);
  return lines.map(lineWords => {
    const ltr  = lineWords.sort((a, b) => a.bbox.x - b.bbox.x);
    const text = ltr.map(w => w.text).join(' ').trim();
    const pts  = ltr.flatMap(w => [
      { x: w.bbox.x,            y: w.bbox.y },
      { x: w.bbox.x + w.bbox.w, y: w.bbox.y + w.bbox.h }
    ]);
    return { text, bbox: extractBBox(pts) };
  });
}

// ============================================================
//  Main export
// ============================================================
async function analyzeImage(imagePath) {
  const credentials     = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const authOpts        = credentials ? { keyFilename: credentials } : {};
  const visionClient    = new vision.ImageAnnotatorClient(authOpts);
  const translateClient = new Translate(authOpts);

  // --- OCR ---
  const [result] = await visionClient.documentTextDetection(imagePath);
  const fullText  = result.fullTextAnnotation;

  if (!fullText || !fullText.pages || fullText.pages.length === 0) {
    throw new Error('No text detected. Make sure the photo is clear and well-lit.');
  }

  const page        = fullText.pages[0];
  const imageWidth  = page.width;
  const imageHeight = page.height;

  // --- Extract words ---
  const rawWords = [];
  for (const block of page.blocks) {
    for (const paragraph of block.paragraphs) {
      for (const word of paragraph.words) {
        const text     = word.symbols.map(s => s.text).join('');
        const vertices = word.boundingBox && word.boundingBox.vertices;
        if (!vertices || vertices.length < 4) continue;
        const hasDanda = /[।॥]/.test(text);
        if (!hasDanda && (!isHindi(text) || text.length < 2)) continue;
        rawWords.push({ text, bbox: extractBBox(vertices) });
      }
    }
  }

  const rawLines     = groupIntoLines(rawWords).filter(l => l.text.length >= 4);
  const contentWords = rawWords.filter(w => !STOP_WORDS.has(w.text.trim()));

  // --- Batch translate ---
  const uniqueWords    = [...new Set(contentWords.map(w => w.text))];
  const uniqueLines    = [...new Set(rawLines.map(l => l.text))];
  const allToTranslate = [...uniqueWords, ...uniqueLines];
  const translationMap  = {};

  if (allToTranslate.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < allToTranslate.length; i += BATCH) {
      const batch = allToTranslate.slice(i, i + BATCH);
      const [translations] = await translateClient.translate(batch, { from: 'hi', to: 'en' });
      const arr = Array.isArray(translations) ? translations : [translations];
      batch.forEach((text, idx) => { translationMap[text] = arr[idx] || ''; });
    }
  }

  // --- Build output with % coords ---
  const toPercent = (val, dim) => parseFloat(((val / dim) * 100).toFixed(3));

  const words = contentWords
    .map(w => ({
      word:    w.text,
      meaning: translationMap[w.text] || '',
      x: toPercent(w.bbox.x, imageWidth),
      y: toPercent(w.bbox.y, imageHeight),
      w: toPercent(w.bbox.w, imageWidth),
      h: toPercent(w.bbox.h, imageHeight)
    }))
    .filter(w => w.meaning);

  const lines = rawLines
    .map(l => ({
      text:    l.text,
      meaning: translationMap[l.text] || '',
      x: toPercent(l.bbox.x, imageWidth),
      y: toPercent(l.bbox.y, imageHeight),
      w: toPercent(l.bbox.w, imageWidth),
      h: toPercent(l.bbox.h, imageHeight)
    }))
    .filter(l => l.meaning);

  return { imageWidth, imageHeight, words, lines };
}

module.exports = { analyzeImage };
