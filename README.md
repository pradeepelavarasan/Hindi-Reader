# Hindi Reader  — हिंदी पाठक 

> Scan any Hindi book page. Tap a word or line to instantly see its English meaning — without ever leaving the page.

🌐 **Live app:** https://tinyurl.com/hindi-reader

📹 **Watch the demo video - https://youtube.com/shorts/SpUKKbpu51g**

---

## 📖 "The What" — What is the product?

Hindi Reader is a web app built for children learning Hindi. A student takes a photo of any Hindi textbook page, and the app overlays interactive tap zones directly on the image. Tap a word to see its meaning. Tap a full line to translate the whole sentence. No switching apps, no typing, no interruption to reading flow.

It works on any phone — Android (Chrome) or iOS (Safari) — and can be installed on the home screen like a native app.

---

## 🤔 "The Why" — The Problem It Solves

Learning Hindi from a physical textbook is hard when you keep hitting unknown words. The typical workflow looks like this:

1. Encounter an unknown word while reading
2. Mentally note it, lose your place
3. Switch to AI Assistant or Google Translate or a dictionary app (Many of these apps are not available in kids login profile)
4. Type the word or scan the app
5. Get the meaning
6. Switch back to the book and try to find your place again

These constraints and context-switching kills comprehension and frustrates young readers. Every interruption breaks the story or the lesson. This also interrupts their ability to learn independently. 

**Hindi Reader collapses all five steps into one tap.** The meaning appears as an overlay right on top of the scanned page — the student never loses their place, and the reading flow stays intact. All of this independently.

---

## ❤️ "The Impact" — What Users Are Saying

> First major impact is enabling my own son who is 10 years old to learn all the mearnings by himself without depending on others. :)

> *"This is great, can a similar one be created for kannada  with  audio in click that spells the word and can be turned on and off"*

> "Need for kannada also pls 🙈"

The app was originally built for approx 20 students in a primary school Hindi class and shared via a parents' WhatsApp group. Now we are sharing with larger community.

Below was the usage among the class students:
Below was the usage among the class students in a week:
<img width="738" height="178" alt="image" src="https://github.com/user-attachments/assets/53a9358d-9bad-47fd-907e-cedadb12684a" />


---

## 🔧 "The Hard Parts" — Challenges & Learnings

Building this looked simple on paper — take a photo, run OCR, show translations. In practice, every step had a catch.

### Image quality from phone cameras
Phone cameras confuses with landscape mode sometimes, and EXIF rotation metadata is unreliable across Android and iOS. The app auto-detects landscape images and rotates them 90° server-side so every scan arrives in portrait orientation. Scanned book pages are also often darker than expected due to lighting and page curvature, so a brightness boost (1.2×) is applied before OCR to improve text detection accuracy.

### Memory and image processing
The Jimp image processing library loads the full image into memory. At 512 MB RAM (Cloud Run default), the container crashed on high-resolution phone photos. Bumping the memory limit to 1 GiB resolved the OOM errors.

### Hindi OCR accuracy and word boundaries
Google Cloud Vision's `documentTextDetection` mode is significantly more accurate than standard `textDetection` for Hindi script. However, bounding boxes from OCR are in absolute pixel coordinates, while the app needs percentage-based positions so overlays align correctly at any screen size or zoom level. Building a reliable coordinate mapping layer — and handling words that OCR splits or joins unexpectedly — required careful tuning.

### Stop words vs. content words
Translating every single word (including conjunctions, pronouns, postpositions) produced noisy, unhelpful popups. A curated Hindi stop-word list filters out ~60 common grammar words so only meaningful content words get a translation overlay. This made the word tap mode significantly more useful.

### Sentence detection
An attempt was made to let students tap and translate full sentences (split by the Hindi danda — the `।` character). OCR inconsistency in detecting the danda, combined with multi-line sentences producing bounding boxes that covered entire paragraphs, made the results misleading — partial sentence translations produced incorrect meanings. This feature was removed in favour of the line-tap mode, which reliably covers a full thought in most textbook formats.

### Cost protection for public sharing
Once shared beyond a small classroom, the app needed protection against API cost abuse. Safeguards were put in place at both the app layer and the cloud infrastructure layer to keep usage within safe limits.

---

## ⚙️ "The How" — Tech Architecture

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
│  1. Security checks (app + cloud layer)             │
│                                                     │
│  2. Image hash caching                              │
│     └─ Repeat scan? → return stored result          │
│                                                     │
│  3. Image normalisation                             │
│     ├─ Auto-rotate landscape → portrait             │
│     └─ Brightness boost                             │
│                                                     │
│  4. OCR  →  Google Cloud Vision                     │
│                                                     │
│  5. Group words into lines                          │
│                                                     │
│  6. Filter stop words                               │
│                                                     │
│  7. Batch translate → Google Cloud Translate        │
│                                                     │
│  8. Store result + image → Google Cloud Storage     │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│           Google Cloud Storage                      │
│                                                     │
│  ├─ Scanned images                                  │
│  ├─ Scan metadata per device                        │
│  └─ Translation cache                               │
└─────────────────────────────────────────────────────┘
```

### Key technology choices

| Layer | Technology | Why |
|---|---|---|
| Frontend | Vanilla JS PWA | No framework overhead; installable on home screen |
| Backend | Node.js + Express | Lightweight, fast cold starts on Cloud Run |
| OCR | Google Cloud Vision (`documentTextDetection`) | Best-in-class accuracy for Hindi script |
| Translation | Google Cloud Translate v2 | Batch API keeps cost low — one call per scan |
| Image processing | Jimp | Pure JS, no native dependencies — works in containers |
| Hosting | Google Cloud Run | Serverless, scales to zero when not in use |
| Storage | Google Cloud Storage | Durable, cheap, no database to manage |
| Rate limiting | `express-rate-limit` | IP-based defence against API cost abuse |

### Project structure

| File / Folder | What it does |
|---|---|
| `server.js` | Entry point — sets up Express, rate limiting, and routes |
| `storage.js` | All read/write to Google Cloud Storage |
| `lib/analyze.js` | OCR + translation pipeline (Vision → group lines → translate) |
| `routes/process.js` | POST /api/process — handles image upload and scan |
| `routes/history.js` | Scan history per device (list, open, delete, re-translate) |
| `routes/admin.js` | Usage stats page with 30-day chart |
| `public/index.html` | The app's single HTML page |
| `public/app.js` | All frontend logic |
| `public/style.css` | All styles |
| `public/manifest.json` | PWA install config (home screen icon, name, theme) |
| `Dockerfile` | Container definition for Cloud Run deployment |
| `.env.example` | Template of required environment variables |

---

*Built by [Pradeep Elavarasan](https://www.linkedin.com/in/pradeepelavarasan/) · Co-created with [Claude](https://claude.ai)*
