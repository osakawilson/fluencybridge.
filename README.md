# FluencyBridge Inspector — Research Inspector PoC

Dual-view speaking-assessment workbench for university ESL research.

* **Student Mode (default, `http://localhost:3000`):** one focused column — a
  three-tier **Practice Library** picker (medium → category/era → sentence) over
  six A2 scenario collections, famous movie lines and song lyrics, six
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
                     └── POST /api/tts    : optional Azure Neural TTS (MP3)
```

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
npm run dev               # node --watch server.js
npm run test              # unit + security + quota + Netlify checks, then the smoke test
npm run test:unit         # offline calibration unit tests (no server, no keys)
npm run test:security     # offline gate + rate-limit checks (boots a mock server)
npm run test:usage        # offline per-student quota + Azure circuit-breaker checks
npm run test:netlify      # invokes netlify/functions/api.js with Lambda events
npm run check:vowels      # offline IPA/vowel-alignment check (no keys needed)
npm run check:selection   # offline three-tier picker check (no keys needed)
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

| `http://localhost:3000/?vowels=1` | Student Mode starting in Vowel Practice |

## Student Mode interactions

* **Three-tier practice picker** (`public/js/library.js` holds the pure filter):
  1. **Medium / Type** — segmented pills `All` · `☕ Scenarios` · `🎬 Movies` ·
     `🎵 Songs` (default `All`).
  2. **Category / Era** — rebuilt from the pill: Scenarios shows the six
     situational categories; Movies, Songs and All show the demographic cohorts
     (`All Generations (Combined)`, Boomers, Gen Jones, Gen X, Millennials,
     Gen Z, Gen Alpha, `🎲 Shuffle / Mix Generations`) plus the classic
     movie/song collections, so no target is orphaned. Re-clicking the active
     pill resets this level to the tier default.
  3. **Target sentence** — filtered by **both** the medium and the category, and
     labelled with the medium emoji and source:
     `🎬 [Star Wars] "May the Force be with you."`,
     `🎵 [Queen] "We will, we will rock you."`,
     `☕ [Cafe] "I would like a medium latte with oat milk, please."`.
  Every sentence carries `medium: 'scenario' | 'movie' | 'song'` and every
  category declares its medium (cohorts expose their movie/song `media` list),
  so the filter is a single array pass — no guessing from labels.
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
                  "group": "movie", "source": "Apollo 13", "focus": "…",
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
at server start) and opens on a random line each time it is picked.

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

* **Static UI** — `publish = "public"`, so `index.html`, `js/*` and `styles.css`
  are served straight from the Netlify CDN (never through the function).
* **One function** — `netlify/functions/api.js` wraps the same Express app with
  `@vendia/serverless-express`; it is bundled with esbuild.
* **One rewrite** — `/api/*` → `/.netlify/functions/api/:splat` with **status
  200**, so the browser still sees `/api/assess` and Express routing, the
  access-code gate, the rate limits and the daily quotas behave exactly as in
  `npm start`.

Secrets belong in **Site settings → Environment variables** (`AZURE_SPEECH_KEY`,
`AZURE_SPEECH_REGION`, `DEEPSEEK_API_KEY`, `ACCESS_CODE`, `USER_DAILY_CALL_LIMIT`,
`DAILY_AZURE_CALL_LIMIT`, …). `.env` is gitignored and never deployed.

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
