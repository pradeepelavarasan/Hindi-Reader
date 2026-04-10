# हिंदी पाठक — Hindi Reader

> Scan any Hindi book page. Tap a word or line to instantly see its English meaning — without ever leaving the page.

**Live app:** https://tinyurl.com/hindi-reader

---

## 1. What It Is

Hindi Reader is a Progressive Web App (PWA) built for children learning Hindi. A student takes a photo of any Hindi textbook page, and the app overlays interactive tap zones directly on the image. Tap a word to see its meaning. Tap a full line to translate the whole sentence. No switching apps, no typing, no interruption to reading flow.

It works on any phone — Android (Chrome) or iOS (Safari) — and can be installed on the home screen like a native app.

📹 **[Watch the demo video](<!-- add YouTube or Drive link here -->)**

---

## 2. The Problem It Solves

Learning Hindi from a physical textbook is hard when you keep hitting unknown words. The typical workflow looks like this:

1. Encounter an unknown word while reading
2. Mentally note it, lose your place
3. Switch to Google Translate or a dictionary app
4. Type the word (hard on a touchscreen for Devanagari script)
5. Get the meaning
6. Switch back to the book and try to find your place again

This context-switching kills comprehension and frustrates young readers. Every interruption breaks the story or the lesson.

**Hindi Reader collapses all five steps into one tap.** The meaning appears as an overlay right on top of the scanned page — the student never loses their place, and the reading flow stays intact.

---

## 3. User Love

> *"My daughter used to give up whenever she hit difficult words. Now she reads the whole page on her own."*

> *"Really useful for exam revision — we can go through the chapter quickly without getting stuck."*

> *"Simple and fast. Exactly what was needed."*

The app was initially built for 20 students in a primary school Hindi class and shared via a parents' WhatsApp group. It was later shared with an AI practitioners community (~350 members) and on LinkedIn.

---

## 4. Challenges & Learnings

Building this looked simple on paper — take a photo, run OCR, show translations. In practice, every step had a catch.

### Image quality from phone cameras
Phone cameras shoot in landscape by default, and EXIF rotation metadata is unreliable across Android and iOS. The app auto-detects landscape images and rotates them 90° server-side so every scan arrives in portrait orientation. Scanned book pages are also often darker than expected due to lighting and page curvature, so a brightness boost (1.2×) is applied before OCR to improve text detection accuracy.

### Memory and image processing
The Jimp image processing library loads the full image into memory. At 512 MB RAM (Cloud Run default), the container crashed on high-resolution phone photos. Bumping the memory limit to 1 GiB resolved the OOM errors.

### Hindi OCR accuracy and word boundaries
Google Cloud Vision's `documentTextDetection` mode is significantly more accurate than standard `textDetection` for Devanagari script. However, bounding boxes from OCR are in absolute pixel coordinates, while the app needs percentage-based positions so overlays align correctly at any screen size or zoom level. Building a reliable coordinate mapping layer — and handling words that OCR splits or joins unexpectedly — required careful tuning.

### Stop words vs. content words
Translating every single word (including conjunctions, pronouns, postpositions) produced noisy, unhelpful popups. A curated Hindi stop-word list filters out ~60 common grammar words so only meaningful content words get a translation overlay. This made the word tap mode significantly more useful.

### Sentence detection
An attempt was made to let students tap and translate full sentences (split by the Hindi danda — the `।` character). OCR inconsistency in detecting the danda, combined with multi-line sentences producing bounding boxes that covered entire paragraphs, made the results misleading — partial sentence translations produced incorrect meanings. This feature was removed in favour of the line-tap mode, which reliably covers a full thought in most textbook formats.

### Cost protection for public sharing
Once shared beyond a small classroom, the app was exposed to potential API cost abuse (the Vision and Translate APIs are paid per call). A layered defence was built: image hash caching to skip repeat scans, IP-based rate limiting, a global daily cap, Cloud Run instance limits, GCP API quota overrides, and a billing budget alert.

---

## 5. Tech Architecture

```
┌─────────────────────────────────────────────────────┐
│                    User's Phone                     │
│                                                     │
│  PWA (HTML / CSS / JS)                              │
│  ┌─────────────┐   ┌──────────────────────────┐    │
│  │  Camera /   │   │  Tap overlay on image    │    │
│  │  Gallery    │   │  → word or line popup    │    │
│  └──────┬──────┘   └──────────────────────────┘    │
│         │ HTTPS POST (image upload)                 │
└─────────┼───────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────┐
│              Google Cloud Run                       │
│              Node.js + Express                      │
│                                                     │
│  1. Security checks                                 │
│     ├─ IP rate limit  (30 req / IP / day)           │
│     ├─ Device quota   (20 pages / device)           │
│     └─ Global cap     (500 scans / day)             │
│                                                     │
│  2. Image hash (SHA-256)                            │
│     └─ Cache hit? → return stored result            │
│                                                     │
│  3. Image normalisation (Jimp)                      │
│     ├─ Auto-rotate landscape → portrait             │
│     └─ Brightness boost (1.2×)                      │
│                                                     │
│  4. OCR  →  Google Cloud Vision                     │
│     └─ documentTextDetection (Devanagari)           │
│                                                     │
│  5. Group words into lines                          │
│     └─ Y-centre proximity clustering                │
│                                                     │
│  6. Filter stop words                               │
│     └─ ~60 Hindi grammar words removed             │
│                                                     │
│  7. Batch translate → Google Cloud Translate        │
│     └─ Words + lines in one API call               │
│                                                     │
│  8. Store result + image → Google Cloud Storage     │
└─────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────┐
│           Google Cloud Storage                      │
│                                                     │
│  gs://hindi-reader-uploads/                         │
│  ├─ uploads/        ← scanned images                │
│  ├─ data/index.json ← scan metadata per device      │
│  ├─ data/cache/     ← hash → translation cache      │
│  └─ data/daily-counter.json ← global rate cap       │
└─────────────────────────────────────────────────────┘
```

### Key technology choices

| Layer | Technology | Why |
|---|---|---|
| Frontend | Vanilla JS PWA | No framework overhead; installable on home screen |
| Backend | Node.js + Express | Lightweight, fast cold starts on Cloud Run |
| OCR | Google Cloud Vision (`documentTextDetection`) | Best-in-class accuracy for Devanagari script |
| Translation | Google Cloud Translate v2 | Batch API keeps cost low — one call per scan |
| Image processing | Jimp | Pure JS, no native dependencies — works in containers |
| Hosting | Google Cloud Run | Serverless, scales to zero when not in use |
| Storage | Google Cloud Storage | Durable, cheap, no database to manage |
| Rate limiting | `express-rate-limit` | IP-based defence against API cost abuse |

---

*Built by Pradeep Elavarasan · [tinyurl.com/hindi-reader](https://tinyurl.com/hindi-reader)*
