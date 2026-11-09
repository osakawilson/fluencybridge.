/**
 * Daily usage accounting for FluencyBridge.
 *
 * Two independent ceilings, both keyed by UTC date (`YYYY-MM-DD`):
 *
 *   1. Per student  — USER_DAILY_CALL_LIMIT (default 60) requests across
 *      /api/assess, /api/tts and /api/chat. The key is the client-generated
 *      `x-client-session-id` UUID, never the IP, so a whole classroom behind
 *      one campus NAT keeps its own individual budgets.
 *   2. Global       — DAILY_AZURE_CALL_LIMIT (default 1500) outbound Azure
 *      assessment + TTS calls. This is the site-wide billing circuit breaker.
 *
 * Storage: @netlify/blobs when running on Netlify (counters must survive
 * stateless Lambda invocations and cold starts) with an in-memory fallback for
 * local development and the test suite (`USAGE_STORE=memory` forces it).
 * Writes are conditional (`onlyIfMatch` / `onlyIfNew`) and retried, so
 * concurrent Lambda instances do not lose increments.
 */

const crypto = require('node:crypto');

const integer = (value, fallback) => {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const USER_DAILY_CALL_LIMIT = Math.max(0, integer(process.env.USER_DAILY_CALL_LIMIT, 60));
const DAILY_AZURE_CALL_LIMIT = Math.max(0, integer(process.env.DAILY_AZURE_CALL_LIMIT, 1500));
const STORE_NAME = process.env.USAGE_STORE_NAME || 'fluencybridge-usage';
const STUDENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_WRITE_ATTEMPTS = 5;

const memory = new Map();
let storeState = null;

/** Lazy @netlify/blobs adapter (auto-configured on Netlify). */
function blobStore() {
  if (storeState) return storeState.store;
  storeState = { store: null, mode: 'memory' };
  if (String(process.env.USAGE_STORE || '').toLowerCase() === 'memory') return null;
  try {
    const { getStore } = require('@netlify/blobs');
    const options = { name: STORE_NAME, consistency: 'strong' };
    // Explicit credentials for CI / non-Netlify hosts; Netlify injects its own
    // context (NETLIFY_BLOBS_CONTEXT) inside functions automatically.
    if (process.env.NETLIFY_SITE_ID) options.siteID = process.env.NETLIFY_SITE_ID;
    if (process.env.NETLIFY_BLOBS_TOKEN) options.token = process.env.NETLIFY_BLOBS_TOKEN;
    storeState = { store: getStore(options), mode: 'blobs' };
  } catch (err) {
    storeState = { store: null, mode: 'memory' };
    console.warn(`[usage] Netlify Blobs unavailable (${err.message}); using in-memory counters.`);
  }
  return storeState.store;
}

const storageMode = () => (blobStore() ? 'blobs' : 'memory');

const todayKey = (now = new Date()) => now.toISOString().slice(0, 10);
const userKey = (studentId, date = todayKey()) => `user:${date}:${studentId}`;
const globalKey = (date = todayKey()) => `global:${date}:azure`;

const normalizeEntry = (value) => ({
  count: Math.max(0, Number(value && value.count) || 0),
  updated_at: (value && value.updated_at) || new Date().toISOString()
});

async function readEntry(key) {
  const store = blobStore();
  if (store) {
    try {
      const entry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      if (entry && entry.data) return { value: normalizeEntry(entry.data), etag: entry.etag || null };
      return null;
    } catch (err) {
      // Corrupt/missing entry or a transient blob error: fall back to memory.
    }
  }
  const cached = memory.get(key);
  return cached ? { value: normalizeEntry(cached), etag: null } : null;
}

/**
 * Atomically-ish reserves `delta` units on `key`.
 * With `delta > 0` the reservation is refused once `used >= limit`
 * (limit 0 therefore blocks everything). With `delta < 0` it refunds.
 */
async function reserve(key, limit, delta = 1) {
  const store = blobStore();
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const current = await readEntry(key);
    const used = current ? current.value.count : 0;
    if (delta > 0 && used >= limit) return { allowed: false, used, limit };

    const next = normalizeEntry({ count: used + delta, updated_at: new Date().toISOString() });
    memory.set(key, next);

    if (!store) return { allowed: true, used: next.count, limit };

    try {
      const result = current && current.etag
        ? await store.setJSON(key, next, { onlyIfMatch: current.etag })
        : await store.setJSON(key, next, { onlyIfNew: true });
      if (!result || result.modified) return { allowed: true, used: next.count, limit };
      // Lost a concurrent write race: re-read and retry.
    } catch (err) {
      // Blobs hiccup: the in-memory mirror already advanced, never fail a
      // student request because storage is unavailable.
      return { allowed: true, used: next.count, limit };
    }
  }
  // Could not win the conditional write; fail closed on positive reservations.
  const latest = await readEntry(key);
  return { allowed: false, used: latest ? latest.value.count : limit, limit };
}

/* ------------------------------ per student ------------------------------ */

function normalizeStudentId(value) {
  const raw = String(value || '').trim();
  return STUDENT_ID_PATTERN.test(raw) ? raw : null;
}

/** Stable anonymous bucket for clients that omit the header (bots/curl). */
function anonymousStudentId(ip) {
  const digest = crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');
  return `anon-${digest.slice(0, 16)}`;
}

const reserveStudentCall = (studentId) => reserve(userKey(studentId), USER_DAILY_CALL_LIMIT, 1);
const refundStudentCall = (studentId) => reserve(userKey(studentId), Infinity, -1);

async function peekStudentUsage(studentId) {
  const entry = await readEntry(userKey(studentId));
  const used = entry ? entry.value.count : 0;
  return {
    student_id: studentId,
    date: todayKey(),
    used,
    limit: USER_DAILY_CALL_LIMIT,
    remaining: Math.max(0, USER_DAILY_CALL_LIMIT - used),
    allowed: used < USER_DAILY_CALL_LIMIT
  };
}

/* ---------------------------- global Azure cap --------------------------- */

const reserveAzureCall = (units = 1) => reserve(globalKey(), DAILY_AZURE_CALL_LIMIT, units);
const refundAzureCall = (units = 1) => reserve(globalKey(), Infinity, -units);

async function peekGlobalUsage() {
  const entry = await readEntry(globalKey());
  const used = entry ? entry.value.count : 0;
  return {
    date: todayKey(),
    used,
    limit: DAILY_AZURE_CALL_LIMIT,
    remaining: Math.max(0, DAILY_AZURE_CALL_LIMIT - used),
    allowed: used < DAILY_AZURE_CALL_LIMIT
  };
}

/** Midnight UTC that ends the current accounting day. */
function nextResetIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

const limits = () => ({
  user_daily_call_limit: USER_DAILY_CALL_LIMIT,
  daily_azure_call_limit: DAILY_AZURE_CALL_LIMIT
});

/** Test/dev helper: clears the in-memory mirror and the store adapter. */
function resetMemory() {
  memory.clear();
  storeState = null;
}

module.exports = {
  USER_DAILY_CALL_LIMIT,
  DAILY_AZURE_CALL_LIMIT,
  storageMode,
  limits,
  todayKey,
  nextResetIso,
  normalizeStudentId,
  anonymousStudentId,
  peekStudentUsage,
  reserveStudentCall,
  refundStudentCall,
  peekGlobalUsage,
  reserveAzureCall,
  refundAzureCall,
  resetMemory,
  // exported for unit tests
  userKey,
  globalKey
};

