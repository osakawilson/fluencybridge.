# FluencyBridge Inspector — Research Inspector PoC

Dual-view speaking-assessment workbench for university ESL research.

* **Student Mode (default, `http://localhost:3000`):** one focused column — a
  four-step **Practice Library** picker (Movies/Songs → generation window →
  category/era → sentence) over the movie lines, song lyrics and six
  **generational cohorts** plus an *All Generations* pool and a shuffle option
  (**276 targets**), the **scripted target card** (“Target Sentence to Read
  Aloud” with a “Listen to Model”
  button — Azure Neural TTS at 0.85×, female/male voice selector, browser-voice
  fallback — sitting directly above the mic), **scripted scoring ON by default**,
  the colour-coded transcript, and the per-word **IPA phoneme breakdown directly
  underneath**. Every word (and every phoneme chip) is clickable to hear it
  isolated, and **Vowel Practice** turns the sentence’s vowel nuclei into
  tappable IPA sounds anchored to the word’s *lexical* pronunciation. The
  Bridge/DeepSeek conversation bubble is hidden here.
* **Inspector Mode (`?mode=inspector` or the header switch):** the full
  researcher view — Azure GOP data, DeepSeek recast payload, latency KPIs, raw
  JSON payloads and the session log (plus the Bridge bubble for reference).

```
Public lab UI  ──►  Node/Express proxy (keys stay server-side)
                     ├── POST /api/assess : WAV → Azure Pronunciation Assessment
                     ├── POST /api/chat   : transcript → DeepSeek JSON mode
                     ├── POST /api/tts    : optional Azure Neural TTS (MP3)
                     ├── POST /api/auth/login|guest : LinguaBridge roster identity
                     └── POST /api/interactions     : scored-turn telemetry
```

## What's new in v1.1.0

* **LinguaBridge roster sign-in.** Students keep the participant ID + 4-digit PIN
  printed on their LinguaBridge login card (`LB-001` / `1887`); there is also a
  one-click **Guest** tab. The header shows `AmberBeacon (LB-001)` or `Guest`
  with **Switch / Logout**.
* **Hybrid telemetry.** Every scored turn is POSTed to `/api/interactions`
  (Netlify Blobs store `fluency_interactions` in production, the gitignored
  `data/interactions.json` locally) and the whole log exports as CSV at
  `GET /api/admin/export-csv` for a direct Google Sheets import.
* **Generation window.** The media tabs are now **Movies** and **Songs** only,
  filtered by a dual-range release-era slider (Boomer 1960–1979, Gen X
  1980–1995, Millennial 1996–2010, Gen Z 2011–2025) with one-click cohort chips
  and a **🎲 Summon Mystery Line** button.
* **Gamified mystery reveal.** The film title / band name is hidden behind
  `🎬 ? ? ? ? ? ? (Mystery Movie)` or `🎵 ? ? ? ? ? ? (Mystery Artist)` until the
  learner scores **accuracy ≥ 80** (or overall ≥ 80): the card then shows
  `🎉 Decoded!`, the title with its release year and a confetti celebration.
  Below 80 the title stays hidden and the card asks for another take.

## Quick start

```bash
npm install
cp .env.example .env      # add your keys (optional — see MOCK mode)
npm start                 # http://localhost:3000  (Student Mode)
```

| URL | View |
| --- | --- |
| `http://localhost:3000/` | **Student Mode** (default): model sentence + mic + transcript + phonemes |
| `http://localhost:3000/?mode=inspector` | Researcher Inspector (also via the header switch) |
| `http://localhost:3000/?scripted=0` | Student Mode starting in Free Speech mode (the sentence remains as an optional prompt) |

With **no keys** the app still runs end-to-end in *MOCK mode*: a deterministic
synthetic Azure payload and a template recast are returned, and the UI shows a
loud `MOCK DATA` banner + per-provider `mock` pills. Nothing fabricated is ever
presented as live data.

```bash
npm run build             # regenerates public/scenarios.json (all 276 targets)
npm run dev               # node --watch server.js (runs build first)
npm run test              # unit + security + quota + Netlify checks, then the smoke test
npm run test:unit         # offline calibration unit tests (no server, no keys)
npm run test:security     # offline gate + rate-limit checks (boots a mock server)
npm run test:usage        # offline per-student quota + Azure circuit-breaker checks
npm run test:netlify      # invokes netlify/functions/api.js with Lambda events
npm run test:auth         # offline roster auth + telemetry/CSV checks
npm run check:vowels      # offline IPA/vowel-alignment check (no keys needed)
npm run check:selection   # offline three-tier picker check + CDN bank parity (276)
npm run check:live        # Azure TTS -> 16 kHz WAV -> /api/assess (verifies keys)
```

Requires **Node ≥ 18.17** (native `fetch`, `AbortSignal.timeout`) and a Chromium
or Firefox browser on `localhost`/HTTPS for microphone access.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `AZURE_SPEECH_KEY` | Azure Speech resource key (Pronunciation Assessment + optional TTS) |
| `AZURE_SPEECH_REGION` | e.g. `eastus`, `japaneast` |
| `AZURE_SPEECH_LANGUAGE` | default `en-US` |
| `AZURE_TTS_VOICE` | default `en-US-JennyNeural` |
| `AZURE_PHONEME_ALPHABET` | default `IPA` |
| `DEEPSEEK_API_KEY` | DeepSeek key (OpenAI-compatible) |
| `DEEPSEEK_MODEL` | default `deepseek-chat` (e.g. `deepseek-flash` if enabled) |
| `DEEPSEEK_BASE_URL` | default `https://api.deepseek.com/v1/chat/completions` |
| `DEEPSEEK_TEMPERATURE` | default `0.6` |
| `PORT` / `MAX_AUDIO_MB` / `FORCE_MOCK` | server port, upload cap, force mock |
| `ACCESS_CODE` | optional shared passcode for `/api` (see *Deployment hardening*) |
| `ACCESS_CODE_TTL_MS` / `ACCESS_ATTEMPT_LIMIT` / `SECURE_COOKIES` | session lifetime (12 h), passcode attempts per 15 min (10), force `Secure` cookie |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_TTS_MAX` | per-IP limits (30 / 60 s; TTS raises independently) |
| `TRUST_PROXY` | proxy hops to trust for the real client IP (`1` behind nginx/Caddy/Netlify) |
| `USER_DAILY_CALL_LIMIT` | practice calls per student per UTC day (default `60`, `0` = paused) |
| `DAILY_AZURE_CALL_LIMIT` | site-wide outbound Azure calls per UTC day (default `1500`, `0` = paused) |
| `USAGE_STORE` / `USAGE_STORE_NAME` | counter storage (`memory` forces the local fallback; default Blobs) |
| `NETLIFY_SITE_ID` / `NETLIFY_BLOBS_TOKEN` | Blobs credentials when running outside Netlify |
| `STUDENT_ROSTER_JSON` | v1.1.0 roster as one JSON string (`{"LB-001":{"name":"AmberBeacon","pin":"1887"}}`); use this on Netlify |
| `STUDENT_ROSTER_PATH` | optional local roster path (default `data/students.json`, gitignored) |
| `INTERACTIONS_STORE` / `INTERACTIONS_STORE_NAME` | telemetry storage (`blobs` \| `file` \| `memory`; Blobs store `fluency_interactions`) |
| `INTERACTIONS_FILE` | optional local JSON log path (default `data/interactions.json`, gitignored) |
| `ADMIN_KEY` | extra key for `GET /api/admin/export-csv` (`X-Admin-Key` or `?key=`) |

| `http://localhost:3000/?vowels=1` | Student Mode starting in Vowel Practice |

## Student Mode interactions

* **Practice picker with a generation window** (`public/js/library.js` holds the
  pure filter):
  1. **Medium / Type** — `🎬 Movies` (default) or `🎵 Songs`. Scenarios stay in
     the bank for the API/assessment pipeline but are hidden in v1.1.0.
  2. **Generation Window** — a dual-range slider over the release years present
     in the bank (1939–2023) plus cohort chips **Boomer 1960–1979**, **Gen X
     1980–1995**, **Millennial 1996–2010**, **Gen Z 2011–2025** (and *All eras*).
     The readout names every cohort the window overlaps.
  3. **Category / Era** — rebuilt from the tier; counts reflect the current
     generation window.
  4. **Target sentence** — medium + window + category must all match. Labels stay
     mysterious before scoring (`🎬 [Mystery Movie] "…"`,
     `🎵 [Mystery Artist] "…"`), so the dropdown never leaks the title.
  **🎲 Summon Mystery Line** picks a random target inside the active media +
  window and resets the practice card.
  Every sentence carries `medium: 'scenario' | 'movie' | 'song'`, a `year` and
  the hidden work/artist `title` (`source` stays the human "Title · Year"
  string), so filters are a single array pass — no guessing from labels.
* **Mystery reveal.** Before scoring, the model card hides the work behind
  `🎬 ? ? ? ? ? ? (Mystery Movie)` / `🎵 ? ? ? ? ? ? (Mystery Artist)` while the
  English line stays readable. Azure accuracy ≥ 80 (or overall ≥ 80) triggers
  `🎉 Decoded!`, the title + release year and a confetti celebration; below 80
  the title stays hidden and the badge suggests another attempt.
* **Scripted scoring switch (ON by default)** drives the target card:
  * **ON → “Target Sentence to Read Aloud”** with the subtext *“Read this exact
    sentence aloud. The system will grade your pronunciation directly against
    it.”* The sentence, **Listen to Model** and **Vowel Practice** are shown, and
    `referenceText` is sent to Azure for phoneme alignment (miscue, omissions,
    insertions).
  * **OFF → “Free Speech / Open Topic Practice”** with the subtext *“Speak
    freely in your own words. The system will transcribe what you say and assess
    your natural speech.”* The sentence stays as a dimmed, italic **optional
    prompt** and `referenceText: ""` switches Azure to the open decoder.
* **Listen to Model** plays the target at 0.85× with Azure Neural TTS, using the
  **voice selector** beside it: `en-US-JennyNeural` (female, default) or
  `en-US-GuyNeural` (male). The browser voice is used automatically if Azure
  TTS is unavailable, and the note shows the active engine/voice.
* **Click any word** in “What the system heard” or in “Words & phonemes” to hear
  that word in isolation at 0.85× with the selected voice — useful for
  comparing the learner’s production with the target word.
* **Click any phoneme chip** to hear that single IPA phone via SSML
  `<phoneme alphabet="ipa">`.
* **Vowel Practice** bolds the primary vowel nuclei of the model sentence
  (e.g. “m**e**d**i**um l**a**tt**e** with **oa**t m**i**lk”); each highlighted
  vowel is a button that plays the isolated vowel sound. Hovering shows
  `grapheme → /IPA/ in “word”`. The sound is anchored to the **true lexical
  pronunciation**, not to spelling rules: `src/wordPhonemes.js` ships a curated
  word → vowel table (113 irregular spellings, loanwords and proper nouns) with
  `GET /api/scenarios`, and every target also carries its own `wordVowels` map.
  So clicking **ou** in “H**ou**ston” plays **/juː/** (`<phoneme alphabet="ipa"
  ph="juː">Houston</phoneme>`), “l**a**tte” plays **/ɑː/**, and “rec**ei**pt”
  plays **/iː/**. Regular spellings still fall back to the grapheme rules in
  `public/js/vowels.js`, and the offline mirror in that file keeps the bundled
  demo sentences working without the API.
* **日本語 (translation)** sits next to “Listen to Model” and reveals a static
  Japanese translation beneath the English sentence. It is hidden by default
  (learners read English first), toggles on demand, and resets whenever a new
  target is selected. Translations ship with the library — no API call or
  latency.

## Inspector Mode: scoring engine badge

The inspector header always states which Azure path the turn will use, colour
coded green (reference alignment) or amber (open decoder) and mirrored in
`state.scripted` / the exported `scripted_mode`:

| Badge | Subtitle | What Azure receives |
| --- | --- | --- |
| **🎯 SCRIPTED ALIGNMENT ACTIVE** | *Acoustic Reference Alignment (`referenceText` bound). Azure evaluates exact phoneme accuracy, omissions, and insertions against ground truth.* | audio + the target sentence (`referenceText`), `EnableMiscue` on |
| **🎙️ OPEN ASR ACTIVE** | *Automated Speech Recognition (`referenceText: ""` open decoder). Azure decodes speech to text first, then grades recognized words.* | audio only (`referenceText: ""`), completeness reported as 100 by convention |

The badge follows the **Scripted scoring** switch in real time (and the
automatic scripted fallback offered when open-decoder audio is unrecognised).

## API contract

### `POST /api/assess`

```jsonc
// request
{ "audio": "<base64 PCM WAV, 16-bit mono>", "scenarioId": "cafe-1",
  "scripted": false, "referenceText": "", "language": "en-US" }

// response (abridged)
{
  "ok": true,
  "recognized_text": "I want a big coffee with milk and no sugar.",
  "accuracy_score": 71.2,              // Azure's own aggregate (raw)
  "calibrated_accuracy_score": 61.8,   // mean of calibrated word scores
  "fluency_score": 86.4, "completeness_score": 100,
  "pronunciation_score": 78.9, "prosody_score": 81.0,
  "words": [
    { "word": "coffee", "accuracy_score": 58, "azure_accuracy_score": 83.0,
      "error_type": "None", "min_phoneme_score": 41, "phoneme_cap_applied": true,
      "phoneme_cap_binding": false, "phoneme_cap_tier": "fail",
      "failed_phonemes": [{ "phoneme": "f", "accuracy_score": 41 }],
      "weakest_phoneme": { "phoneme": "f", "accuracy_score": 41, "duration_ms": 80 },
      "penalties": [], "offset_ms": 480, "duration_ms": 520,
      "calibration": { "composite": 57.8, "azure_word_score": 83.0, "penalty_total": 0,
                       "capped_at": 64, "cap_tier": "fail" },
      "phonemes": [{ "phoneme": "f", "accuracy_score": 41.0, "is_failed": true, "is_weakest": true,
                     "offset_ms": 480, "duration_ms": 80 }] }
  ],
  "word_scoring": { "rule": "...", "words": 8, "words_capped": 1, "words_penalised": 0,
                    "mean_azure_accuracy": 71.2, "mean_calibrated_accuracy": 61.8 },
  "mode": "unscripted", "audio_duration_ms": 2560, "source": "azure",
  "raw": { "RecognitionStatus": "Success", "NBest": [ /* full Azure result */ ] },
  "timing": { "assess_ms": 812, "audio_bytes": 82160, "sample_rate": 16000 }
}
```

* Audio is captured as **raw PCM at 16 kHz** with the Web Audio API and encoded
  as RIFF/WAV in the browser — `MediaRecorder` produces WebM/Opus, which
  pronunciation assessment cannot decode.
* Grading is `HundredMark`, granularity `Phoneme`; scripted mode adds
  `EnableMiscue` so `error_type` / `completeness` become meaningful.
* `ok: false, no_speech: true` is returned (HTTP 200) when Azure detects no
  speech, so the inspector still receives the raw payload. Provider failures
  return **502 with the Azure error**, never silent mock data.

### `POST /api/chat`

```jsonc
{ "transcript": "...", "scenarioId": "cafe-1",
  "history": [{ "role": "user", "content": "..." }],
  "assessment": { "words": [{ "word": "coffee", "accuracy_score": 55 }] } }
```

Returns the normalised `payload` (`recast`, `reply`, `detected_errors`,
`reasoning`, `chips[3]`, `cefr_note`), a server-side `constraint_check`
(reply word count ≤ 25, exactly one question, three chips, tense warnings),
provenance (`source: live|fallback|mock`, `model`, `usage`) and timings
(`ttft_ms`, `total_ms`). The request is **streamed** so TTFT is real.

### `POST /api/tts`

`{ text, rate: 0.85, voice, phoneme }` → `audio/mpeg` plus
`X-TTS-Ms` / `X-TTS-Voice` / `X-TTS-Phoneme` headers, or `501` when Azure is not
configured (the client falls back to `window.speechSynthesis`).

* `voice` — neural voice name, e.g. `en-US-JennyNeural` (female, default) or
  `en-US-GuyNeural` (male). Names are validated against a Neural-voice pattern
  before being placed in SSML.
* `phoneme` — optional IPA phone (`iː`, `eɪ`, `juː`…), spoken through
  `<phoneme alphabet="ipa" ph="…">`. Vowel Practice sends the source word as the
  element's text (`<phoneme alphabet="ipa" ph="juː">Houston</phoneme>`), so the
  vowel of that specific word is synthesised instead of a bare grapheme read out
  of context. Unsafe or unknown values return `400`.
* `rate` 0.85 → SSML `prosody rate="-15%"`.

### `POST /api/auth/login` (v1.1.0)

```jsonc
// request
{ "studentId": "LB-001", "pin": "1887" }          // `password` is accepted too
// 200
{ "ok": true, "app_version": "1.1.0", "studentId": "LB-001",
  "pseudonym": "AmberBeacon", "role": "student" }
```

The roster comes from `STUDENT_ROSTER_JSON` (Netlify) or the gitignored
`data/students.json` (`{ "LB-001": { "name": "AmberBeacon", "pin": "1887" } }`);
see `data/.students.example.json`. IDs are case-insensitive and the PIN is
compared in constant time. Errors: `400 missing_credentials`,
`401 invalid_credentials`, `503 roster_unavailable`, `429` after 10 attempts per
15 minutes per IP. PINs are never echoed back or present in `/api/health`.

### `POST /api/auth/guest` (v1.1.0)

```jsonc
{ "ok": true, "app_version": "1.1.0", "studentId": "guest_UaAP0n",
  "pseudonym": "Guest", "role": "guest" }
```

One-click practice identity (`guest_` + six URL-safe random characters).

### `POST /api/interactions` (v1.1.0)

One record per scored turn; the browser sends this automatically after
`/api/assess` returns (fire-and-forget, never blocks the UI):

```jsonc
{ "studentId": "LB-001", "pseudonym": "AmberBeacon", "role": "student",
  "targetId": "gen-z-1", "medium": "movie", "sentence": "I am inevitable.",
  "overallScore": 91, "accuracyScore": 88, "fluencyScore": 82,
  "completenessScore": 100, "revealed": true }
```

The server normalises the payload (role/media whitelist, scores clamped 0–100),
adds `id` (`int_<timestamp>_<id>`), `timestamp` and `app_version` and stores it:

| Runtime | Storage |
| --- | --- |
| Netlify Function | Netlify Blobs, store **`fluency_interactions`** |
| local `npm start` | appended to the gitignored **`data/interactions.json`** |
| tests / CI | `INTERACTIONS_STORE=memory` (RAM only) |

`201 { ok: true, id, stored, record }`.

### `GET /api/admin/export-csv` (v1.1.0)

Streams every stored interaction as CSV for a direct Google Sheets import
(`text/csv`, `Content-Disposition: attachment`), header:

```
id,timestamp,app_version,studentId,pseudonym,role,targetId,medium,sentence,overallScore,accuracyScore,fluencyScore,completenessScore,revealed
```

Gated by the deployment `ACCESS_CODE` and, when `ADMIN_KEY` is set, by
`X-Admin-Key: <key>` (or `?key=`). `?format=json` returns the same rows as JSON
for the inspector.

### `GET /api/scenarios`

```jsonc
{ "default": "cafe-1",
  "groups":   [{ "id": "scenario", "label": "Practice Scenarios" }, …,
               { "id": "generations", "label": "Generations" }],
  "categories": [{ "id": "cafe", "label": "Cafe & Dining", "emoji": "☕",
                   "group": "scenario", "medium": "scenario", "media": ["scenario"],
                   "shortLabel": "Cafe", "tip": "ordering, ingredients, paying",
                   "keywords": ["latte", …], "sentenceCount": 14,
                   "mix": false, "combined": false }, …,
                 { "id": "boomers", "label": "Boomers (1946–1954)",
                   "medium": "song", "media": ["song", "movie"], … }],
  "scenarios": [{ "id": "movies-3", "label": "Houston, we have a problem.",
                  "referenceText": "Houston, we have a problem.",
                  "medium": "movie",              // scenario | movie | song
                  "ja": "ヒューストン、問題が発生しました。",
                  "category": "movies", "categoryLabel": "Famous Movie Lines",
                  "group": "movie", "source": "Apollo 13 · 1995",
                  // v1.1.0 mystery metadata (hidden until accuracy >= 80)
                  "title": "Apollo 13", "year": 1995,
                  "focus": "…",
                  "keywords": [...], "starters": [...],
                  // per-sentence lexical vowel alignment (irregular words only)
                  "wordVowels": { "houston": [["ou", "juː"], ["o", "ə"]],
                                  "have": [["a", "æ"]] } }, …],
  // global word -> vowel table behind wordVowels (src/wordPhonemes.js)
  "vowels": { "houston": [["ou", "juː"], ["o", "ə"]], "latte": [["a", "ɑː"], ["e", "eɪ"]], … } }
```

276 targets in four collections: 74 communicative sentences across six
categories (Cafe & Dining 14, Airport & Travel 12, Clinic & Health 12,
Shopping & Sizes 12, Hotel & Accommodations 12, Train & Transit 12), 12 iconic
movie lines, 10 song lyrics, and 180 generational rows (6 cohorts × 10, plus the
60-line *All Generations (Combined)* pool and the 60-line *Shuffle / Mix*
pool). Every sentence declares a `medium`, which is what the three-tier picker
filters on (`public/js/library.js`).

The identical payload is mirrored at **`GET /scenarios.json`** (static, served by
the CDN, no access code) by `npm run build`; the client falls back to it when
the gated endpoint is unavailable, so the picker never degrades below 276
targets.

### Generational cohorts (Practice Library)

`src/practiceDataGenerations.js` keeps the cohort data out of `scenarios.js` and
holds 10 lines per cohort; each item declares `text`, `source`,
`medium: 'movie' | 'song'` and a Japanese `ja` translation:

| Cohort | Years | Category id | Medium | Flavour |
| --- | --- | --- | --- | --- |
| Boomers | ~1946–1954 | `boomers` | song (6) / movie (4) | classic cinema, rock & folk (Beatles, Dylan, Casablanca, The Graduate, The Sound of Music) |
| Gen Jones | ~1955–1964 | `gen-jones` | song (7) / movie (3) | new wave, arena rock, late-70s film (Queen, Star Wars, The Police, Journey, Apocalypse Now) |
| Gen X | ~1965–1980 | `gen-x` | movie (8) / song (2) | 80s/90s cinema, grunge & alt-rock (Terminator 2, Nirvana, Pulp Fiction, Back to the Future, The Matrix, Green Day) |
| Millennials | ~1981–1996 | `millennials` | movie (8) / song (2) | late-90s/2000s culture (Titanic, Britney Spears, The Lord of the Rings, Mean Girls, Eminem, Finding Nemo) |
| Gen Z | ~1997–2012 | `gen-z` | movie (6) / song (4) | 2010s hits, MCU & streaming (Avengers, Billie Eilish, Interstellar, Spider-Verse, Olivia Rodrigo, Taylor Swift) |
| Gen Alpha | ~2013+ | `gen-alpha` | song (6) / movie (4) | viral animated lines & current hooks (Frozen, Encanto, Super Mario Movie, Moana, Baby Shark) |
| **All Generations** | all | `generations-all` | mixed | every cohort line pooled in release order |
| **Shuffle / Mix** | all | `generations-mix` | mixed | every cohort line pooled and shuffled for quick-fire practice |

A cohort's category-level `medium` is its majority medium plus the full `media`
list; the per-sentence `medium` is what the picker filters on, so
*Movies → Boomers* lists only the four Boomer film lines and *Songs → Boomers*
the six song lines. The **Shuffle / Mix** pool re-pools all 60 lines (shuffled
once at load with a fixed seed, so `npm run build` is byte-reproducible) and
opens on a random line each time it is picked.

### `public/scenarios.json` (the CDN copy)

`npm run build` (`scripts/build-scenarios.mjs`) snapshots the same payload into
`public/scenarios.json`, which Netlify publishes as a static asset. The browser
always prefers the gated `GET /api/scenarios`, but if that request fails — cold
start, function packaging error, expired access code, 502/504 — it loads this
file and keeps the **full 276-target picker** instead of the 3-line emergency
stub in `public/js/app.js`. The build refuses to write the file unless
`src/scenarios.js` really holds all 276 targets, and `npm run check:selection`
fails if the snapshot drifts from the source.

## Word-score calibration (strict, L1-aware)

Azure's word `AccuracyScore` is an average of its phoneme scores. That average
hides a single catastrophic substitution (`/l/ → /r/` in "milk") and ignores
epenthetic vowels ("miruku" for milk, "hotto" for hot). `src/azureAssessment.js`
therefore publishes a calibrated word score:

```
composite = 0.4 · azureWordScore + 0.6 · min(phonemeScore)
−25       if an epenthetic insertion sits on / next to the word (short token)
−25       if a vowel is ≥ 210 ms AND ≥ 2.0× the word's median phoneme duration
−15       if a word-final fricative/affricate (/z/, /s/, /tʃ/, /dʒ/) runs longer
          than 200 ms — a mora-timed coda, e.g. "chīzu" for cheese, "gurasu"
cap 64    if any phoneme < 60   →  a failed phoneme always reads Red
cap 78    if any phoneme < 85   →  a weak phoneme never reads Green
clamp 0…100
```

Notes that matter for interpretation:

* `words[].accuracy_score` is the **calibrated** score (what the student sees);
  `words[].azure_accuracy_score` keeps Azure's raw value. Each word also returns
  `min_phoneme_score`, `weakest_phoneme`, `failed_phonemes`, `phoneme_cap_applied`
  (rule triggered), `phoneme_cap_binding` (the cap actually lowered the score),
  `phoneme_cap_tier` (`"fail"` below 60 → cap 64, `"warn"` below 85 → cap 78),
  `penalties[]` and a `calibration` object (`capped_at`, `cap_tier`), so every
  adjustment is auditable.
* `calibrated_accuracy_score` is the mean of the calibrated word scores and is
  what the student's Accuracy chip shows; `accuracy_score` remains Azure's.
  `word_scoring` summarises the rule, the thresholds, the counts and both means.
* The insertion penalty only applies to **short** inserted tokens (≤ 2 phonemes
  or ≤ 3 characters), so a legitimately added word such as "please" does not
  penalise its neighbour. The lengthening check only looks at vowels and only
  for words that are not already clearly intelligible (composite < 85), so
  native long vowels and stop closures are not punished. The coda check is
  separate and always applies: an English word-final /z s tʃ dʒ/ longer than
  200 ms is almost always a released coda plus an epenthetic vowel.
* Display bands: **green ≥ 88** (clear), **yellow 65–87** (accent drift /
  epenthetic vowel / one distorted phoneme), **red < 65** (mispronounced).
  Hovering a word shows, for example:
  `cheese — 79 / 100 · Accent drift / azure 95 → calibrated 79 (coda -15)`.
* Unit-tested in isolation via `calibrateWord` / `normalizeWords` (exported from
  `src/azureAssessment.js`) and the display bands from `public/js/ui.js`:
  `npm run test:unit` → `scripts/scoring-check.mjs`.

## Accent robustness (L1-interference handling)

Strong L1 accents are frequently decoded as unrelated English words or dropped
entirely. Three safeguards are in place, all inspectable in the payload:

1. **Low audio floors.** The client drops a recording only below `peak 0.001`
   (−60 dBFS); the server pre-check uses `peak < 0.001 && rms < 0.0002`
   (env: `SILENCE_PEAK_THRESHOLD` / `SILENCE_RMS_THRESHOLD`). Tentative speech
   (peak ≈ 0.002–0.02) always reaches Azure.
2. **Longer end-silence window.** `EndSilenceTimeoutMs = 2500` and
   `InitialSilenceTimeoutMs = 6000`, so pauses between words are not truncated.
3. **Contextual bias.** A `PhraseListGrammar` is attached to every recognizer
   with ~100 A2 classroom terms (politeness frames such as *I would like*,
   scenario keywords such as *latte, oat milk, receipt, luggage, headache,
   medicine*, plus the scripted target sentence). The applied list is returned
   as `bias.phrase_list` and shown in the inspector.

### Distinguishing “no audio” from “audio but no words”

`POST /api/assess` never reports a generic failure when audio *was* captured:

```jsonc
// audio present but the decoder produced no words (accent, mumbling, wrong language)
{ "ok": false, "no_speech": true, "error": "unrecognized_speech",
  "audio_present": true, "recognizer_reason": "NoMatch", "no_match_reason": "InitialSilenceTimeout",
  "audio_peak": 0.0412, "audio_rms": 0.0081,
  "message": "Audio detected, but words could not be recognized. Try speaking slightly closer to the mic or toggle Scripted Scoring to practice a specific sentence." }

// genuinely silent input (server pre-check, Azure not called, not billed)
{ "ok": false, "error": "silent_audio", "silent": true, "audio_present": false,
  "source": "silence", "message": "The recording is too quiet to score. ..." }
```

Both are HTTP 200 so the researcher inspector keeps the raw Azure payload. The
student view renders the first case as an amber notice with an
**Enable Scripted Scoring** action, and the second as a red notice. Failed
attempts are written to the session log (NoMatch frequency is itself a useful
measure for L1 studies).

## Deployment hardening

Baseline protections for putting the PoC on a public host. All of them are
optional/configurable from `.env` (see `.env.example`); with no configuration
the lab behaves exactly as before.

**Secrets.** `.env` is explicitly gitignored (`.env`, `.env.*`, with
`!.env.example` keeping the template tracked) and loaded server-side only. Keys
never enter `public/`: the browser talks to this Express proxy, which is the
only place `AZURE_SPEECH_KEY` / `DEEPSEEK_API_KEY` are read. `GET /api/health`
returns provider status, never credentials, and `npm run test:security` asserts
that no value from your `.env` appears in `/api/health`, `/index.html`,
`/js/app.js` or `/js/api.js`.

**Rate limiting.** `express-rate-limit` guards the three routes that spend money,
per client IP:

| Route | Default budget |
| --- | --- |
| `POST /api/assess` | 30 / 60 s (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`) |
| `POST /api/chat` | 30 / 60 s (same budget) |
| `POST /api/tts` | 30 / 60 s (`RATE_LIMIT_TTS_MAX` — each word/phoneme tap is one call) |
| `POST /api/session` | 10 / 15 min (`ACCESS_ATTEMPT_LIMIT`, passcode brute-force guard) |

Exceeding a budget returns `429` with `Retry-After`, `RateLimit` headers and
`{ "error": "rate_limited", "retry_after_s": N }`. Set `TRUST_PROXY=1` (or a
subnet) when nginx/Caddy/PaaS terminates TLS, otherwise every request keys on
the proxy's IP. A whole classroom behind one NAT shares one bucket, so raise the
limits for lab-wide sessions.

**Optional passcode gate.** Set `ACCESS_CODE` and every `/api` route except
`/api/health` and `/api/session` requires the code. Two ways to supply it:

```bash
# 1. header (scripts, curl)
curl -H "X-Access-Code: $ACCESS_CODE" http://localhost:3000/api/scenarios

# 2. session cookie (browser: POST the code once, cookie is HttpOnly)
curl -c jar.txt -H 'Content-Type: application/json' \
     -d "{\"code\":\"$ACCESS_CODE\"}" http://localhost:3000/api/session
curl -b jar.txt http://localhost:3000/api/scenarios
```

The cookie holds `<expiry>.<HMAC-SHA256(ACCESS_CODE, expiry)>` — never the
passcode itself — is `HttpOnly; SameSite=Lax; Path=/`, gains `Secure` on https
(or with `SECURE_COOKIES=true`), and expires after `ACCESS_CODE_TTL_MS` (12 h).
Comparisons are constant-time. The student UI detects the gate via
`GET /api/session` and shows a passcode dialog; a 401 later in the session
(e.g. an expired cookie) re-opens it. `DELETE /api/session` signs out.

Also included: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, and `X-Powered-By` disabled. There is no CSP yet
(the page loads Tailwind from a CDN), so add one if your deployment allows
self-hosting that stylesheet.

## Netlify deployment

```bash
npm install
npx netlify deploy --build --prod      # or connect the Git repo in the Netlify UI
```

`netlify.toml` wires everything:

* **Static UI** — `publish = "public"`, so `index.html`, `js/*`, `styles.css`
  and the generated `scenarios.json` are served straight from the Netlify CDN
  (never through the function).
* **Build step** — `command = "npm run build"` regenerates
  `public/scenarios.json` from `src/scenarios.js` on every deploy and aborts if
  the bank is not the full 276 targets.
* **One function** — `netlify/functions/api.js` wraps the same Express app with
  `@vendia/serverless-express`; it is bundled with esbuild, with
  `microsoft-cognitiveservices-speech-sdk` kept external (the SDK ships native
  binaries and loads assets at require time, so inlining it can make the whole
  function fail to load — which is what used to shrink the UI to 3 sentences).
* **Lambda event shim** — Netlify invokes functions with a bare Lambda event
  that has **no `requestContext`**, and `@vendia/serverless-express` refuses to
  guess the event source without it (`Unable to determine event source based on
  event`), answering **502** on every `/api/*` call. The handler normalises each
  event into the API Gateway v1 shape first; `npm run test:netlify` now drives it
  with a faithful Netlify event (and keeps one legacy API Gateway fixture).
* **One rewrite** — `/api/*` → `/.netlify/functions/api/:splat` with **status
  200**, so the browser still sees `/api/assess` and Express routing, the
  access-code gate, the rate limits and the daily quotas behave exactly as in
  `npm start`.

The client keeps the sentence bank resilient:

1. `GET /api/scenarios` (gated function) — preferred;
2. `/scenarios.json` (CDN snapshot) — used automatically if step 1 fails, still
   all 276 targets;
3. a 3-line emergency stub in `public/js/app.js` — only when the browser is
   fully offline, and it says so in a toast + `library_source` in the export.

Secrets belong in **Site settings → Environment variables** (`AZURE_SPEECH_KEY`,
`AZURE_SPEECH_REGION`, `DEEPSEEK_API_KEY`, `ACCESS_CODE`, `USER_DAILY_CALL_LIMIT`,
`DAILY_AZURE_CALL_LIMIT`, …). `.env` is gitignored and never deployed.

**v1.1.0 roster + telemetry on Netlify.** `data/students.json` is gitignored, so
`data/students.json` is gitignored, so inject the roster through
`STUDENT_ROSTER_JSON` or participant sign-in answers `503 roster_unavailable`
and only the Guest tab works. Netlify's Lambda compatibility mode caps the
**whole function environment at 4 KB**, so `npm run roster:env` prints the
compact JSON when it fits and the gzip+base64 form otherwise (101 students:
4.5 KB JSON → 1.5 KB compressed); `src/roster.js` decodes either form.

```bash
npx netlify env:set STUDENT_ROSTER_JSON "$(npm run --silent roster:env)" \
    --secret --force --context production
```

Scored turns land in the Blobs store `fluency_interactions`;
`GET /api/admin/export-csv` (with `ADMIN_KEY` set as `X-Admin-Key`) downloads the
class CSV, or read `?format=json` from the inspector. Verify the deployment:

```bash
curl -s https://<site>/api/health | jq '.app_version, .auth, .telemetry'
curl -X POST https://<site>/api/auth/login -H 'Content-Type: application/json' \
     -d '{"studentId":"LB-001","pin":"1887"}'
```

Netlify platform limits that matter here:

| Limit | Value | Effect |
| --- | --- | --- |
| Synchronous payload | ~6 MB | base64 audio; a 30 s 16 kHz WAV is ~1.3 MB |
| Function timeout | 10 s (26 s on Pro) | Azure PA usually answers in 2–4 s |
| Cold starts | — | counters live in Blobs, so nothing is lost |

`TRUST_PROXY` defaults to `1` on Lambda so the per-IP limits see the real client
address; set it explicitly to override. `npm run test:netlify` loads the function
locally and asserts the rewrite, the gate and the quota headers.

## Daily quotas (students & Azure budget)

Two independent ceilings, both reset at **00:00 UTC** and both stored in
**Netlify Blobs** (`fluencybridge-usage`) so they survive stateless Lambda
executions; locally the engine falls back to an in-memory map.

**Per student — `USER_DAILY_CALL_LIMIT` (60).** `public/js/api.js` creates and
persists a UUID in `localStorage` (`fb_student_id`) and sends it as
`x-client-session-id` on every `/api/*` call. `/api/assess`, `/api/tts` and
`/api/chat` each consume one call. At the limit the server answers `429` before
any provider work (Azure is never billed):

```json
{ "error": "user_limit_reached",
  "message": "You have completed your 60 practice attempts for today! Great work. Please review your scores and practice notes.",
  "limit": 60, "used": 60, "resets_at": "2026-03-05T00:00:00.000Z" }
```

Because the key is the UUID (not the IP), every student behind one campus NAT
keeps their own budget. The UI shows a completion banner, disables the mic and
keeps the scores on screen; a reload restores that state from
`/api/health?usage=1`. Every response also carries
`X-Student-Daily-Remaining`.

**Site-wide — `DAILY_AZURE_CALL_LIMIT` (1500).** Every outbound Azure assessment
and TTS call consumes one unit (refunded when the request is rejected before the
provider is contacted, e.g. silent audio or an invalid voice). At the ceiling the
three practice routes answer `503`:

```json
{ "error": "daily_budget_exhausted",
  "message": "Daily lab practice limit reached for today. System paused until tomorrow." }
```

Counters are read-modify-written with Blobs conditional writes (`onlyIfMatch` /
`onlyIfNew`, retried), so concurrent Lambdas cannot lose increments; a lost race
can admit at most one extra call. Known limit: a student can reset their own
per-student counter by clearing `localStorage`, so the site-wide ceiling — not
the per-student one — is the authoritative billing guard. Mock-mode requests
never consume the Azure counter.

## Research design notes

* **Item battery:** 276 targets in four collections - 74 A2 communicative
  sentences across six categories (Cafe & Dining, Airport & Travel, Clinic &
  Health, Shopping & Sizes, Hotel & Accommodations, Train & Transit), 12 iconic
  movie lines, 10 song lyrics, and 180 generational rows (6 cohorts × 10 plus
  60-line combined and 60-line shuffled pools). Each target carries a language
  focus, a `medium` (scenario/movie/song) for the three-tier picker, category
  keywords for recogniser bias, a static Japanese translation and a lexical
  vowel alignment for Vowel Practice.
* **Constrain-then-verify prompt:** the system prompt pins CEFR A2 (≤ 25 words,
  present/past simple only, exactly one question, recast without meta-talk,
  exactly three next-turn chips). The server re-counts words/questions/chips and
  flags complex tenses so prompt adherence is measured, not assumed.
* **Latency instrumentation:** audio capture+encode (client), Azure round trip
  (client) with server `assess_ms`, DeepSeek TTFT (server, streaming) plus full
  round trip, TTS first-audio latency, and a total-to-first-AI-token figure.
* **Export:** the session ID copies to the clipboard; `Export` / `Download JSON`
  writes every turn (audio meta, full Azure payload, full DeepSeek payload,
  timings, TTS engine/voice) for offline analysis.

## Project layout

```
server.js                 Express proxy + orchestration
netlify.toml              Netlify build: publish public/, functions, /api/* rewrite
netlify/functions/api.js  Serverless wrapper around the Express app
src/usage.js              Daily per-student quota + global Azure budget (Blobs)
src/scenarios.js          Practice sentence library builder (4 collections, 276 targets)
src/practiceDataGenerations.js  Generational cohorts (Boomers … Gen Alpha) + combined/mix pools
src/wordPhonemes.js       Word → lexical vowel IPA table (Vowel Practice)
src/wav.js                RIFF/WAV parser (chunk walking, PCM extraction)
src/azureAssessment.js    Azure PA (HundredMark, phonemes, push-stream PCM)
src/deepseek.js           DeepSeek JSON mode, SSE streaming, constraint checks
src/azureTts.js           Optional Azure Neural TTS (SSML rate → 0.85)
src/mock.js               Deterministic mock assessment + template recast
scripts/build-scenarios.mjs  Snapshot src/scenarios.js → public/scenarios.json (276)
scripts/smoke-test.js     End-to-end API smoke test (mock-friendly)
scripts/security-check.mjs Offline passcode-gate + rate-limit checks (no keys needed)
scripts/usage-check.mjs   Offline per-student quota + circuit-breaker checks
scripts/netlify-check.mjs Offline Netlify function/rewrite checks
scripts/scoring-check.mjs Offline calibration + band unit tests (no keys needed)
scripts/vowel-check.mjs   Offline IPA/vowel-alignment check (no keys needed)
scripts/selection-check.mjs  Offline three-tier picker check (no keys needed)
scripts/live-check.js     Azure TTS -> 16 kHz WAV -> /api/assess key verifier
public/index.html         Dual-pane shell (three-tier picker + target card)
public/styles.css         Design system (light/dark, score bands, JSON viewer)
public/scenarios.json     Generated CDN copy of the full 276-target practice bank
public/js/app.js          State, recording pipeline, rendering, export
public/js/library.js      Pure medium → category → sentence filter (tested offline)
public/js/vowels.js       Grapheme → IPA annotator (lexicon-first, rules as fallback)
public/js/{recorder,wav,api,speech,ui}.js
```

## Known limits (PoC scope)

* One utterance per turn: each recording is assessed independently; the
  conversation history is sent to the model but audio is not stored.
* Unscripted mode reports `completeness_score = 100` by convention (Azure has no
  reference to compare against) — flagged in the UI.
* Silent clips are short-circuited by a peak/RMS pre-check (server) and a client
  guard, because Azure PA can stall on digital silence. No request is billed.
* `ScriptProcessorNode` is deprecated but universally supported; an
  `AudioWorklet` version would be the production path.
* Tailwind is loaded from the Play CDN (utility sprinkles only). All critical
  layout lives in `styles.css`, so the UI still renders offline.
* 30-second recording cap and 24 MB upload cap are deliberate cost guards.
* DeepSeek V4.1 Flash model naming varies by account; set `DEEPSEEK_MODEL`
  (`deepseek-chat` is verified to support `response_format: json_object`).
* Browser TTS voices differ across operating systems; the UI reports the voice
  actually used and falls back with a visible warning.
