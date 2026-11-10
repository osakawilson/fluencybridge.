/**
 * FluencyBridge Inspector - API proxy (keeps keys server-side).
 *
 *   POST /api/assess  WAV (base64) -> Azure Pronunciation Assessment
 *   POST /api/chat    transcript    -> DeepSeek JSON-mode recast
 *   POST /api/tts     text          -> optional Azure Neural TTS (mp3)
 *   GET  /api/health  provider/mode status for the UI badges
 *   GET  /api/scenarios  practice sentence library shared with the client
 *
 *   v1.1.0 research additions
 *   POST /api/auth/login           LB-xxx + 4-digit PIN -> participant session
 *   POST /api/auth/guest           one-click guest practice id
 *   POST /api/interactions         append one scored turn to the telemetry log
 *   GET  /api/admin/export-csv     gated CSV export for Google Sheets
 */

require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const { SCENARIOS, CATEGORIES, GROUPS, DEFAULT_SCENARIO_ID, getScenario } = require('./src/scenarios');
const { vowelLexicon } = require('./src/wordPhonemes');
const { decodeAudioPayload, parseWav } = require('./src/wav');
const { assessWithAzure, azureConfigured } = require('./src/azureAssessment');
const { recastWithDeepSeek, deepseekConfigured, normalizePayload, checkConstraints } = require('./src/deepseek');
const { synthesizeWithAzure, ttsConfigured, DEFAULT_VOICE, TTS_VOICES } = require('./src/azureTts');
const { mockAssessment, templateRecast } = require('./src/mock');
const roster = require('./src/roster');
const interactions = require('./src/interactions');
const usage = require('./src/usage');

const { version: APP_VERSION } = require('./package.json');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_AUDIO_MB = Number(process.env.MAX_AUDIO_MB || 24);
const FORCE_MOCK = String(process.env.FORCE_MOCK || 'false').toLowerCase() === 'true';
const MIN_AUDIO_MS = 250;

/* ---------------------- deployment hardening config ---------------------- *
 * All of it is optional: with no ACCESS_CODE the passcode gate stays open and
 * the rate limits apply to the paid provider routes only. Everything can be
 * tuned from .env (see .env.example) without touching the code.
 * ------------------------------------------------------------------------- */
const TRUST_PROXY = String(
  process.env.TRUST_PROXY
  // Netlify Functions run on AWS Lambda behind the Netlify edge, so one proxy
  // hop must be trusted for req.ip (rate limiting) to see the real client.
  || (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY ? '1' : '')
).trim();
const RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000);
const RATE_LIMIT_MAX = Math.max(1, Math.trunc(Number(process.env.RATE_LIMIT_MAX) || 30));
// Each word/phoneme tap in the UI is one TTS call, so this one is separately
// tunable without loosening /assess or /chat.
const RATE_LIMIT_TTS_MAX = Math.max(1, Math.trunc(Number(process.env.RATE_LIMIT_TTS_MAX) || RATE_LIMIT_MAX));
const ACCESS_CODE = String(process.env.ACCESS_CODE || '').trim();
const ACCESS_CODE_TTL_MS = Math.max(60000, Number(process.env.ACCESS_CODE_TTL_MS) || 12 * 60 * 60 * 1000);
// Passcode attempts are throttled much harder than ordinary API traffic so the
// code cannot be brute-forced from a public deployment.
const ACCESS_ATTEMPT_LIMIT = Math.max(3, Math.trunc(Number(process.env.ACCESS_ATTEMPT_LIMIT) || 10));
const ACCESS_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const SECURE_COOKIES = String(process.env.SECURE_COOKIES || 'false').toLowerCase() === 'true';
const ACCESS_COOKIE = 'fb_access';
// v1.1.0 telemetry export key. Optional: without it the CSV route is already
// behind the ACCESS_CODE gate (and open on an un-gated local lab).
const ADMIN_KEY = String(process.env.ADMIN_KEY || '').trim();

const liveAzure = () => azureConfigured() && !FORCE_MOCK;
const liveDeepSeek = () => deepseekConfigured() && !FORCE_MOCK;

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

app.disable('x-powered-by');
// Behind a reverse proxy (nginx / Caddy / a PaaS router) set TRUST_PROXY to the
// hop count (e.g. 1) or a subnet so rate limiting keys on the real client IP.
if (TRUST_PROXY) {
  app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
}
// Baseline response headers for a public deployment (cheap, no external deps).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: `${MAX_AUDIO_MB}mb` }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/* ------------------------------- access gate ----------------------------- *
 * Optional passcode gate. When ACCESS_CODE is set, every /api route except
 * /api/health and /api/session requires either
 *   - an `X-Access-Code: <code>` header (constant-time compared), or
 *   - the HttpOnly session cookie issued by POST /api/session.
 * The cookie holds an HMAC of its own expiry (never the passcode itself), so
 * it cannot be replayed after ACCESS_CODE_TTL_MS and does not leak the code.
 * ------------------------------------------------------------------------- */
const accessCodeRequired = () => ACCESS_CODE.length > 0;

function parseCookies(header) {
  const cookies = {};
  String(header || '').split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    const key = part.slice(0, index).trim();
    if (!key) return;
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (err) {
      cookies[key] = value;
    }
  });
  return cookies;
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function accessSignature(expiresMs) {
  return crypto.createHmac('sha256', ACCESS_CODE).update(`fb-access:${expiresMs}`).digest('base64url');
}

function issueAccessToken(ttlMs = ACCESS_CODE_TTL_MS) {
  const expiresMs = Date.now() + ttlMs;
  return { expiresMs, token: `${expiresMs}.${accessSignature(expiresMs)}` };
}

function verifyAccessToken(token) {
  const raw = String(token || '');
  const dot = raw.indexOf('.');
  if (dot <= 0) return false;
  const expiresMs = Number(raw.slice(0, dot));
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return false;
  return safeEqual(raw.slice(dot + 1), accessSignature(expiresMs));
}

function isAccessGranted(req) {
  if (!accessCodeRequired()) return true;
  const header = String(req.get('x-access-code') || '').trim();
  if (header && safeEqual(header, ACCESS_CODE)) return true;
  return verifyAccessToken(parseCookies(req.headers.cookie)[ACCESS_COOKIE]);
}

function accessCookie(req, token, maxAgeMs) {
  const attributes = [
    `${ACCESS_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`
  ];
  // `Secure` is required on https; local lab use over http would otherwise
  // never receive the cookie, so it is tied to the request / SECURE_COOKIES.
  if (SECURE_COOKIES || req.secure) attributes.push('Secure');
  return attributes.join('; ');
}

function requireAccessCode(req, res, next) {
  if (isAccessGranted(req)) return next();
  log(`access code rejected: ${req.method} ${req.originalUrl} from ${req.ip}`);
  return res.status(401).json({
    error: 'access_code_required',
    message: 'This deployment requires an access code. Send it as the X-Access-Code header or unlock a session at /api/session.',
    access_code_required: true
  });
}

/* ---------------------------- rate limiters ------------------------------ */

/**
 * Client key for the per-IP limits. On Netlify the Lambda sees the Netlify edge
 * as its peer, so the real address arrives in x-forwarded-for (or Netlify's own
 * x-nf-client-connection-ip); locally req.ip is already correct. Never returns
 * an empty string, which would make express-rate-limit raise a validation error.
 */
function clientKey(req) {
  const forwarded = req.headers['x-nf-client-connection-ip'] || req.headers['x-forwarded-for'];
  const raw = String(req.ip || forwarded || '').split(',')[0].trim();
  // ipKeyGenerator() masks IPv6 to a /56 so one device cannot rotate addresses.
  return raw ? ipKeyGenerator(raw) : 'unknown-client';
}

function apiLimiter(name, limit, windowMs = RATE_LIMIT_WINDOW_MS) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: clientKey,
    handler: (req, res) => {
      const resetAt = req.rateLimit && req.rateLimit.resetTime ? new Date(req.rateLimit.resetTime).getTime() : 0;
      const retryAfter = resetAt ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      log(`rate limited ${name} from ${req.ip} (${limit}/${Math.round(windowMs / 1000)}s)`);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'rate_limited',
        message: `Too many ${name} requests from this address. Try again in ${retryAfter}s.`,
        retry_after_s: retryAfter,
        limit,
        window_ms: windowMs
      });
    }
  });
}

const assessLimiter = apiLimiter('assessment', RATE_LIMIT_MAX);
const chatLimiter = apiLimiter('chat', RATE_LIMIT_MAX);
const ttsLimiter = apiLimiter('TTS', RATE_LIMIT_TTS_MAX);
// Harder throttle for passcode attempts (15 min window).
const accessLimiter = apiLimiter('access code', ACCESS_ATTEMPT_LIMIT, ACCESS_ATTEMPT_WINDOW_MS);
// Participant PIN attempts get the same treatment: 4 digits must not be
// brute-forceable from a shared classroom IP.
const authLimiter = apiLimiter('participant login', ACCESS_ATTEMPT_LIMIT, ACCESS_ATTEMPT_WINDOW_MS);
// Guest sign-in is one click and must stay usable for a whole classroom behind
// one campus NAT, so it is throttled like ordinary traffic, not like a PIN try.
const guestLimiter = apiLimiter('guest login', Math.max(30, RATE_LIMIT_MAX));
// Telemetry writes are cheap (one Blob/file append per scored turn), so this is
// generous: it only exists to stop a script from flooding the research log.
const interactionsLimiter = apiLimiter('interaction', Math.max(60, RATE_LIMIT_MAX * 4));

/* --------------------------- daily usage quotas -------------------------- *
 * USER_DAILY_CALL_LIMIT  per student (x-client-session-id UUID) across
 *                        /api/assess, /api/tts and /api/chat.
 * DAILY_AZURE_CALL_LIMIT site-wide circuit breaker for outbound Azure calls.
 * Counters live in Netlify Blobs on Netlify (see src/usage.js).
 * ------------------------------------------------------------------------- */
const STUDENT_HEADER = 'x-client-session-id';

/** Client UUID from the header, else the mirrored cookie, else a hashed IP. */
function studentIdFor(req) {
  const header = usage.normalizeStudentId(req.get(STUDENT_HEADER));
  if (header) return header;
  const cookie = usage.normalizeStudentId(parseCookies(req.headers.cookie).fb_student_id);
  if (cookie) return cookie;
  return usage.anonymousStudentId(req.ip);
}

function sendUserLimit(res, student) {
  res.setHeader('X-Student-Daily-Remaining', '0');
  return res.status(429).json({
    error: 'user_limit_reached',
    message: `You have completed your ${student.limit} practice attempts for today! Great work. Please review your scores and practice notes.`,
    user_limit_reached: true,
    limit: student.limit,
    used: student.used,
    resets_at: usage.nextResetIso()
  });
}

function sendBudgetExhausted(res, global) {
  return res.status(503).json({
    error: 'daily_budget_exhausted',
    message: 'Daily lab practice limit reached for today. System paused until tomorrow.',
    daily_budget_exhausted: true,
    limit: global.limit,
    used: global.used,
    resets_at: usage.nextResetIso()
  });
}

/** Refunds the student's reserved call when no practice actually happened. */
async function refundAttempt(res) {
  if (res.locals && res.locals.usage) await usage.refundStudentCall(res.locals.usage.studentId);
}

/**
 * Per-student quota + site-wide breaker. Runs after the IP rate limiter (a
 * throttled request never burns a student's budget) and before any provider
 * work, so a refused call can never reach Azure.
 */
function usageGuard(req, res, next) {
  const studentId = studentIdFor(req);
  (async () => {
    const global = await usage.peekGlobalUsage();
    if (!global.allowed) {
      log(`daily Azure budget exhausted (${global.used}/${global.limit})`);
      return sendBudgetExhausted(res, global);
    }
    const student = await usage.reserveStudentCall(studentId);
    if (!student.allowed) {
      log(`student quota reached: ${student.used}/${student.limit} (${studentId})`);
      return sendUserLimit(res, student);
    }
    res.locals.usage = { studentId, limit: student.limit, used: student.used };
    res.setHeader('X-Student-Daily-Remaining', String(Math.max(0, student.limit - student.used)));
    return next();
  })().catch(next);
}

/** Charges one unit of the global Azure budget just before a provider call. */
async function chargeAzureBudget(res) {
  const budget = await usage.reserveAzureCall();
  if (budget.allowed) return true;
  await refundAttempt(res);
  sendBudgetExhausted(res, budget);
  return false;
}


/* ------------------------------- meta routes ----------------------------- */

app.get('/api/health', async (req, res) => {
  const payload = {
    ok: true,
    app_version: APP_VERSION,
    server_time: new Date().toISOString(),
    node: process.version,
    providers: {
      azure: {
        configured: azureConfigured(),
        live: liveAzure(),
        region: process.env.AZURE_SPEECH_REGION || null,
        language: process.env.AZURE_SPEECH_LANGUAGE || 'en-US'
      },
      deepseek: {
        configured: deepseekConfigured(),
        live: liveDeepSeek(),
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        base_url: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1/chat/completions',
        temperature: Number(process.env.DEEPSEEK_TEMPERATURE || 0.6)
      },
      tts: {
        azure_available: ttsConfigured() && !FORCE_MOCK,
        voice: DEFAULT_VOICE,
        voices: TTS_VOICES,
        browser_rate: 0.85
      }
    },
    limits: { max_audio_mb: MAX_AUDIO_MB, min_audio_ms: MIN_AUDIO_MS, max_recording_ms: 30000 },
    force_mock: FORCE_MOCK,
    // v1.1.0: LinguaBridge roster posture (never the PINs themselves).
    auth: {
      ...roster.rosterInfo(),
      guest_enabled: true,
      endpoints: ['POST /api/auth/login', 'POST /api/auth/guest']
    },
    // v1.1.0: where scored turns are stored, so a researcher can verify the
    // deployment is writing to Blobs (Netlify) and not to a Lambda's /tmp.
    telemetry: {
      interactions_store: interactions.storageMode(),
      store_name: interactions.STORE_NAME,
      export_endpoint: 'GET /api/admin/export-csv',
      export_requires_admin_key: ADMIN_KEY.length > 0,
      app_version: APP_VERSION
    },
    // Deployment posture (no secrets): lets the UI show the passcode gate and
    // lets a researcher confirm the limits the server is running with.
    security: {
      access_code_required: accessCodeRequired(),
      rate_limit: {
        window_ms: RATE_LIMIT_WINDOW_MS,
        max: RATE_LIMIT_MAX,
        tts_max: RATE_LIMIT_TTS_MAX
      },
      access_attempts: {
        window_ms: ACCESS_ATTEMPT_WINDOW_MS,
        max: ACCESS_ATTEMPT_LIMIT
      },
      trust_proxy: TRUST_PROXY || null,
      secure_cookie: SECURE_COOKIES
    },
    // Daily quota posture: limits are always public; live counters only with
    // ?usage=1 so the UI poll does not read Blobs on every page load.
    usage: {
      ...usage.limits(),
      storage: usage.storageMode(),
      date: usage.todayKey(),
      per_student_header: STUDENT_HEADER,
      scope: ['/api/assess', '/api/tts', '/api/chat']
    }
  };
  if (String(req.query.usage || '') === '1') {
    payload.usage.global = await usage.peekGlobalUsage();
    payload.usage.student = await usage.peekStudentUsage(studentIdFor(req));
  }
  res.json(payload);
});

/* ------------------------------- /session -------------------------------- */
/* Public (never gated): lets the client discover whether a passcode is needed
   and exchange it for an HttpOnly cookie. */

app.get('/api/session', (req, res) => {
  res.json({
    ok: true,
    access_code_required: accessCodeRequired(),
    authenticated: isAccessGranted(req),
    cookie_ttl_s: Math.floor(ACCESS_CODE_TTL_MS / 1000)
  });
});

app.post('/api/session', accessLimiter, (req, res) => {
  if (!accessCodeRequired()) {
    return res.json({ ok: true, access_code_required: false, authenticated: true });
  }
  const code = String((req.body && req.body.code) || '').trim();
  if (!code || !safeEqual(code, ACCESS_CODE)) {
    log(`access code rejected: POST /api/session from ${req.ip}`);
    return res.status(401).json({
      error: 'invalid_access_code',
      message: 'That access code is not correct.',
      access_code_required: true
    });
  }
  const { token, expiresMs } = issueAccessToken();
  res.setHeader('Set-Cookie', accessCookie(req, token, ACCESS_CODE_TTL_MS));
  log(`access code accepted: session for ${req.ip}`);
  return res.json({
    ok: true,
    access_code_required: true,
    authenticated: true,
    expires_at: new Date(expiresMs).toISOString(),
    ttl_s: Math.floor(ACCESS_CODE_TTL_MS / 1000)
  });
});

app.delete('/api/session', (req, res) => {
  res.setHeader('Set-Cookie', accessCookie(req, '', 0));
  return res.json({
    ok: true,
    access_code_required: accessCodeRequired(),
    authenticated: !accessCodeRequired()
  });
});

/* ------------------------ /auth (LinguaBridge roster) -------------------- *
 * Students sign in with the participant ID + 4-digit PIN printed on their
 * LinguaBridge login cards. Both routes are public (like /api/session): the
 * access-code gate is a separate deployment gate, and a participant must be
 * able to identify themselves before any practice call is made.
 * ------------------------------------------------------------------------ */

app.post('/api/auth/login', authLimiter, (req, res) => {
  const body = req.body || {};
  const studentId = String(body.studentId || body.participantId || '').trim();
  const pin = String(body.pin !== undefined ? body.pin : (body.password || '')).trim();

  if (!studentId || !pin) {
    return res.status(400).json({
      error: 'missing_credentials',
      message: 'Both the participant ID (e.g. LB-001) and the 4-digit PIN are required.'
    });
  }

  const info = roster.rosterInfo();
  if (!info.configured) {
    log('participant login refused: roster not configured');
    return res.status(503).json({
      error: 'roster_unavailable',
      message: 'The participant roster is not loaded on this server. Add data/students.json or set STUDENT_ROSTER_JSON.',
      roster_configured: false
    });
  }

  const student = roster.verifyStudent(studentId, pin);
  if (!student) {
    log(`participant login rejected: ${studentId} from ${req.ip}`);
    return res.status(401).json({
      error: 'invalid_credentials',
      message: 'That participant ID and PIN combination is not in the LinguaBridge roster.'
    });
  }

  log(`participant login: ${student.studentId} (${student.pseudonym}) from ${req.ip}`);
  return res.json({
    ok: true,
    app_version: APP_VERSION,
    studentId: student.studentId,
    pseudonym: student.pseudonym,
    role: 'student'
  });
});

/** nanoid-style 6-character URL-safe id (crypto-random, no dependency). */
const GUEST_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function guestId(size = 6) {
  let out = '';
  for (let i = 0; i < size; i += 1) out += GUEST_ALPHABET[crypto.randomInt(GUEST_ALPHABET.length)];
  return `guest_${out}`;
}

app.post('/api/auth/guest', guestLimiter, (req, res) => {
  const studentId = guestId(6);
  log(`guest practice session: ${studentId} from ${req.ip}`);
  return res.json({
    ok: true,
    app_version: APP_VERSION,
    studentId,
    pseudonym: 'Guest',
    role: 'guest'
  });
});


/* Everything registered below this line is gated when ACCESS_CODE is set. */
app.use('/api', requireAccessCode);

/* ------------------------- v1.1.0 interaction log ------------------------ *
 * POST /api/interactions  one record per scored turn (Blobs on Netlify, the
 *                         gitignored data/interactions.json locally).
 * GET  /api/admin/export-csv  the whole log as CSV for Google Sheets. Gated by
 *                         the ACCESS_CODE (above) and, when configured, by
 *                         ADMIN_KEY via `X-Admin-Key` or `?key=`.
 * ------------------------------------------------------------------------ */

/** Optional second gate for the research export. */
function requireAdminKey(req, res, next) {
  if (!ADMIN_KEY) return next();
  const provided = String(req.get('x-admin-key') || req.query.key || '').trim();
  if (provided && safeEqual(provided, ADMIN_KEY)) return next();
  log(`admin export rejected from ${req.ip}`);
  return res.status(401).json({
    error: 'admin_key_required',
    message: 'Send the export key as the X-Admin-Key header (or ?key=).'
  });
}

app.post('/api/interactions', interactionsLimiter, async (req, res, next) => {
  try {
    const entry = await interactions.record(req.body || {});
    log(`interaction ${entry.id} ${entry.studentId} ${entry.targetId} `
      + `acc=${entry.accuracyScore} overall=${entry.overallScore} revealed=${entry.revealed}`);
    return res.status(201).json({
      ok: true,
      id: entry.id,
      stored: interactions.storageMode(),
      record: entry
    });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/admin/export-csv', requireAdminKey, async (req, res, next) => {
  try {
    const records = await interactions.list();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Interaction-Count', String(records.length));
    // `?format=json` is the same data for the inspector / tests.
    if (String(req.query.format || '').toLowerCase() === 'json') {
      return res.json({
        ok: true,
        app_version: APP_VERSION,
        count: records.length,
        stored: interactions.storageMode(),
        interactions: records
      });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fluencybridge-interactions-${stamp}.csv"`);
    return res.send(interactions.toCsv(records));
  } catch (err) {
    return next(err);
  }
});

app.get('/api/scenarios', (req, res) => {
  res.json({
    default: DEFAULT_SCENARIO_ID,
    groups: GROUPS,
    categories: CATEGORIES,
    scenarios: SCENARIOS,
    sentences: SCENARIOS,
    // word -> lexical vowel nuclei ([[grapheme, ipa], ...]) for Vowel Practice
    vowels: vowelLexicon()
  });
});

/* -------------------------------- /assess -------------------------------- */

app.post('/api/assess', assessLimiter, usageGuard, async (req, res, next) => {
  const started = Date.now();
  try {
    const body = req.body || {};
    const scenario = getScenario(body.scenarioId);
    const scripted = body.scripted === true || body.mode === 'scripted';
    const referenceText = scripted
      ? String(body.referenceText || scenario.referenceText || '').trim()
      : '';

    let wavBuffer;
    let parsed;
    try {
      wavBuffer = decodeAudioPayload(body.audio);
      parsed = parseWav(wavBuffer);
    } catch (err) {
      await refundAttempt(res);
      return res.status(400).json({
        error: 'invalid_audio',
        message: `Could not read the recording. Send a base64 PCM WAV. (${err.message})`
      });
    }

    if (parsed.durationMs < MIN_AUDIO_MS) {
      await refundAttempt(res);
      return res.status(400).json({
        error: 'audio_too_short',
        message: `Recording was only ${parsed.durationMs} ms. Please speak for at least ${MIN_AUDIO_MS} ms.`,
        audio_duration_ms: parsed.durationMs
      });
    }

    // Guard: only digital/room silence is short-circuited (thresholds are very
    // low so soft, accented speech is *not* dropped). Azure is never billed.
    if (parsed.silent) {
      await refundAttempt(res);
      log(`assess skipped: silent audio (${parsed.durationMs} ms, peak ${parsed.peak}, rms ${parsed.rms})`);
      return res.json({
        ok: false,
        no_speech: true,
        silent: true,
        error: 'silent_audio',
        message: 'The recording is too quiet to score. Check the microphone and speak a little louder.',
        recognized_text: '',
        accuracy_score: null,
        fluency_score: null,
        completeness_score: null,
        words: [],
        mode: scripted ? 'scripted' : 'unscripted',
        reference_text: referenceText,
        audio_duration_ms: parsed.durationMs,
        audio_format: parsed.format,
        audio_peak: parsed.peak,
        audio_rms: parsed.rms,
        audio_present: false,
        silence_thresholds: parsed.silenceThresholds,
        source: 'silence',
        provider: 'precheck',
        recognizer_reason: 'SilentAudio',
        raw: {
          precheck: 'silent-audio',
          note: 'Audio peak/RMS below the digital-silence floor; Azure was not called.',
          peak: parsed.peak,
          rms: parsed.rms,
          thresholds: parsed.silenceThresholds
        },
        timing: {
          assess_ms: Date.now() - started,
          audio_bytes: wavBuffer.length,
          audio_duration_ms: parsed.durationMs,
          sample_rate: parsed.sampleRate,
          channels: parsed.channels,
          bits_per_sample: parsed.bitsPerSample,
          pcm_bytes: parsed.pcm.length
        }
      });
    }

    let result;
    if (liveAzure()) {
      // Circuit breaker: refuse before Azure is contacted (no billing).
      if (!(await chargeAzureBudget(res))) return undefined;
      try {
        result = await assessWithAzure({
          wavBuffer,
          referenceText,
          scenarioId: scenario.id,
          keywords: scenario.keywords,
          language: body.language || process.env.AZURE_SPEECH_LANGUAGE || 'en-US'
        });
      } catch (err) {
        log('Azure assessment failed:', err.code || '', err.message);
        // Never silently substitute mock data for a live research run.
        return res.status(502).json({
          error: 'azure_assessment_failed',
          code: err.code || 'AZURE_ERROR',
          message: err.message,
          azure: err.azure || null,
          hint: 'Check AZURE_SPEECH_KEY / AZURE_SPEECH_REGION, or set FORCE_MOCK=true for a $0 demo.'
        });
      }
    } else {
      result = mockAssessment({
        scenarioId: body.scenarioId,
        referenceText,
        audioDurationMs: parsed.durationMs,
        language: body.language
      });
      result.notice = 'MOCK ASSESSMENT - AZURE_SPEECH_KEY not configured (or FORCE_MOCK=true).';
    }

    const outcome = result.ok
      ? 'ok'
      : (result.error || result.recognizer_reason || 'no_speech');
    log(`assess ${result.source} ${outcome} ${parsed.durationMs}ms audio `
      + `(peak ${parsed.peak}/rms ${parsed.rms}) in ${Date.now() - started}ms`);

    return res.json({
      ...result,
      scenario: scenario.id,
      timing: {
        assess_ms: Date.now() - started,
        audio_bytes: wavBuffer.length,
        audio_duration_ms: parsed.durationMs,
        sample_rate: parsed.sampleRate,
        channels: parsed.channels,
        bits_per_sample: parsed.bitsPerSample,
        pcm_bytes: parsed.pcm.length
      }
    });
  } catch (err) {
    return next(err);
  }
});


/* --------------------------------- /chat --------------------------------- */

function lowScoreWords(assessment) {
  if (!assessment || !Array.isArray(assessment.words)) return [];
  return assessment.words
    .filter((w) => w && typeof w.word === 'string' && Number.isFinite(Number(w.accuracy_score)))
    .map((w) => ({ word: w.word, accuracy_score: Number(w.accuracy_score) }))
    .filter((w) => w.accuracy_score < 80)
    .slice(0, 6);
}

function buildFallbackChat({ transcript, scenario, reason, wasLive }) {
  const payload = normalizePayload(templateRecast({ transcript, scenarioId: scenario.id }), scenario.id);
  return {
    payload,
    constraint_check: checkConstraints(payload),
    model: 'template-fallback',
    temperature: null,
    ttft_ms: null,
    ttft_measured: false,
    total_ms: 0,
    usage: null,
    finish_reason: 'fallback',
    streamed: false,
    downgraded: false,
    source: wasLive ? 'fallback' : 'mock',
    raw_content: JSON.stringify(payload, null, 2),
    raw_model_json: payload,
    error: reason || null
  };
}

app.post('/api/chat', chatLimiter, usageGuard, async (req, res, next) => {
  const started = Date.now();
  try {
    const body = req.body || {};
    const scenario = getScenario(body.scenarioId || body.scenario);
    const transcript = String(body.transcript || '').trim();
    const history = Array.isArray(body.history) ? body.history : [];

    if (!transcript) {
      return res.status(400).json({ error: 'missing_transcript', message: '`transcript` is required.' });
    }
    if (transcript.length > 1200) {
      return res.status(400).json({ error: 'transcript_too_long', message: 'Keep transcripts under 1200 characters.' });
    }

    const assessment = { low_score_words: lowScoreWords(body.assessment) };
    let out;
    let warning = null;

    if (liveDeepSeek()) {
      try {
        out = await recastWithDeepSeek({ transcript, scenarioId: scenario.id, history, assessment });
      } catch (err) {
        log('DeepSeek call failed:', err.code || '', err.message);
        out = buildFallbackChat({ transcript, scenario, reason: err.message, wasLive: true });
        warning = 'DeepSeek call failed - the recast below is the deterministic template, NOT live model output.';
      }
    } else {
      out = buildFallbackChat({
        transcript,
        scenario,
        reason: 'DEEPSEEK_API_KEY not configured (or FORCE_MOCK=true).',
        wasLive: false
      });
      warning = 'MOCK RECAST - DEEPSEEK_API_KEY is not configured (or FORCE_MOCK=true).';
    }

    log(`chat ${out.source} ttft=${out.ttft_ms ?? '-'}ms total=${Date.now() - started}ms`);
    return res.json({
      ...out,
      warning,
      scenario: scenario.id,
      turn: {
        transcript,
        history_turns_sent: Math.min(history.length, 8),
        low_score_words: assessment.low_score_words
      },
      timing: { chat_ms: Date.now() - started }
    });
  } catch (err) {
    return next(err);
  }
});

/* ---------------------------------- /tts --------------------------------- */

app.post('/api/tts', ttsLimiter, usageGuard, async (req, res, next) => {
  try {
    const { text, voice, rate, phoneme } = req.body || {};
    if (!ttsConfigured() || FORCE_MOCK) {
      await refundAttempt(res);
      return res.status(501).json({
        error: 'tts_unavailable',
        message: 'Azure Neural TTS is not configured; use the browser voice instead.'
      });
    }
    if (!String(text || '').trim() && !String(phoneme || '').trim()) {
      await refundAttempt(res);
      return res.status(400).json({ error: 'missing_text', message: '`text` (or `phoneme`) is required.' });
    }

    // Circuit breaker: refuse before Azure is contacted (no billing).
    if (!(await chargeAzureBudget(res))) return undefined;

    let out;
    try {
      out = await synthesizeWithAzure({
        text,
        voice,
        phoneme,
        rate: Number(rate) || 0.85
      });
    } catch (err) {
      if (['INVALID_VOICE', 'INVALID_PHONEME', 'INVALID_TEXT'].includes(err.code)) {
        // Rejected client-side by validation: no provider call, no practice.
        await usage.refundAzureCall();
        await refundAttempt(res);
        return res.status(400).json({ error: err.code.toLowerCase(), message: err.message });
      }
      throw err;
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-TTS-Ms', String(out.latencyMs));
    res.setHeader('X-TTS-Voice', out.voice);
    res.setHeader('X-TTS-Rate', String(out.ratePercent));
    if (out.phoneme) res.setHeader('X-TTS-Phoneme', encodeURIComponent(out.phoneme));
    return res.send(out.audio);
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------ error handling --------------------------- */

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', message: `No API route for ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error: 'payload_too_large',
      message: `Recording exceeds the ${MAX_AUDIO_MB} MB limit. Record a shorter answer.`
    });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON.' });
  }
  log('Unhandled error:', err && (err.stack || err.message || err));
  return res.status(err && err.status ? err.status : 500).json({
    error: err.code || 'internal_error',
    message: err.message || 'Unexpected server error.'
  });
});

/**
 * Boots the HTTP server. Kept separate from the app itself so
 * `netlify/functions/api.js` can import the Express app without listening.
 */
function startServer(port = PORT) {
  const server = app.listen(port, () => {
    const mode = (configured) => (configured ? 'LIVE' : 'MOCK');
    console.log('');
    console.log('  FluencyBridge Inspector - Research PoC');
    console.log(`  http://localhost:${port}`);
    console.log(`  Azure Pronunciation Assessment : ${mode(liveAzure())}${process.env.AZURE_SPEECH_REGION ? ` (${process.env.AZURE_SPEECH_REGION})` : ''}`);
    console.log(`  DeepSeek recast                : ${mode(liveDeepSeek())} (${process.env.DEEPSEEK_MODEL || 'deepseek-chat'})`);
    console.log(`  Azure Neural TTS               : ${mode(ttsConfigured() && !FORCE_MOCK)} (${DEFAULT_VOICE})`);
    console.log(`  Access code gate               : ${accessCodeRequired() ? 'ON (X-Access-Code / session cookie)' : 'off (set ACCESS_CODE to require a passcode)'}`);
    console.log(`  Rate limit / IP                : assess ${RATE_LIMIT_MAX}, chat ${RATE_LIMIT_MAX}, tts ${RATE_LIMIT_TTS_MAX} per ${Math.round(RATE_LIMIT_WINDOW_MS / 1000)}s`);
    console.log(`  Daily quota                    : ${usage.USER_DAILY_CALL_LIMIT}/student · ${usage.DAILY_AZURE_CALL_LIMIT} Azure calls site-wide (${usage.storageMode()} store)`);
    console.log(`  Participant roster             : ${roster.rosterSize()} student(s) from ${roster.rosterInfo().source}`);
    console.log(`  Interaction telemetry          : ${interactions.storageMode()} ${interactions.storageMode() === 'file' ? `(${interactions.INTERACTIONS_FILE})` : `(store ${interactions.STORE_NAME})`}`);
    if (TRUST_PROXY) console.log(`  Trust proxy                    : ${TRUST_PROXY}`);
    if (FORCE_MOCK) console.log('  FORCE_MOCK=true -> live providers disabled on purpose');
    console.log('  Tip: copy .env.example to .env and add keys for live data.');
    console.log('');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Set PORT=<other> in .env.`);
      process.exit(1);
    }
    throw err;
  });

  return server;
}

process.on('unhandledRejection', (reason) => log('Unhandled rejection:', reason));

if (require.main === module) {
  const server = startServer();
  process.on('SIGINT', () => {
    log('Shutting down.');
    server.close(() => process.exit(0));
  });
}

module.exports = { app, startServer };

