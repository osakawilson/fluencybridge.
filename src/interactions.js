/**
 * Interaction telemetry storage (v1.1.0).
 *
 * One record is written each time the browser finishes an Azure Pronunciation
 * Assessment turn, so the researcher can pull a class-wide CSV straight into
 * Google Sheets. Storage follows the same posture as `src/usage.js`:
 *
 *   Netlify Function  -> Netlify Blobs, store `fluency_interactions` (survives
 *                        stateless Lambda invocations and cold starts)
 *   Local `npm start` -> appended to `data/interactions.json` (gitignored)
 *   Tests / CI        -> `INTERACTIONS_STORE=memory` keeps everything in RAM
 *
 * The record shape is fixed by the v1.1.0 research spec:
 *
 *   { id, timestamp, app_version, studentId, pseudonym, role, targetId, medium,
 *     sentence, overallScore, accuracyScore, fluencyScore, completenessScore,
 *     revealed }
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { version: APP_VERSION } = require('../package.json');

const STORE_NAME = process.env.INTERACTIONS_STORE_NAME || 'fluency_interactions';
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'interactions.json');
const INTERACTIONS_FILE = process.env.INTERACTIONS_FILE
  ? path.resolve(process.env.INTERACTIONS_FILE)
  : DEFAULT_FILE;
const STORE_MODES = ['blobs', 'file', 'memory'];
const FORCED_MODE = String(process.env.INTERACTIONS_STORE || '').trim().toLowerCase();
const MAX_SENTENCE_CHARS = 400;
const MAX_ID_CHARS = 64;
const MAX_PSEUDONYM_CHARS = 80;
const MEDIA = ['movie', 'song'];
const ROLES = ['student', 'guest'];

const memory = [];
let blobState = null;
/** Serialises file writes so two near-simultaneous turns cannot interleave. */
let writeQueue = Promise.resolve();

/** True inside a Netlify Function / build (Blobs context is injected there). */
function onNetlify() {
  return Boolean(
    process.env.NETLIFY
    || process.env.NETLIFY_BLOBS_CONTEXT
    || process.env.SITE_ID
    || process.env.AWS_LAMBDA_FUNCTION_NAME
    // Lambda (and therefore every Netlify Function) always sets this; a local
    // `npm start` does not, which is what keeps dev on data/interactions.json.
    || process.env.LAMBDA_TASK_ROOT
  );
}

/**
 * `blobs` | `file` | `memory`. `INTERACTIONS_STORE` wins so the test suite and
 * a local `npm start` can be deterministic.
 */
function storageMode() {
  if (STORE_MODES.includes(FORCED_MODE)) return FORCED_MODE;
  return onNetlify() ? 'blobs' : 'file';
}

/** Lazy @netlify/blobs adapter; null when the module/context is unavailable. */
function blobStore() {
  if (blobState) return blobState.store;
  blobState = { store: null };
  try {
    const { getStore } = require('@netlify/blobs');
    const options = { name: STORE_NAME, consistency: 'strong' };
    // Explicit credentials for CI / non-Netlify hosts; Netlify injects its own
    // context (NETLIFY_BLOBS_CONTEXT) inside functions automatically.
    if (process.env.NETLIFY_SITE_ID) options.siteID = process.env.NETLIFY_SITE_ID;
    if (process.env.NETLIFY_BLOBS_TOKEN) options.token = process.env.NETLIFY_BLOBS_TOKEN;
    blobState = { store: getStore(options) };
  } catch (err) {
    blobState = { store: null };
    console.warn(`[interactions] Netlify Blobs unavailable (${err.message}); using in-memory telemetry.`);
  }
  return blobState.store;
}

/* ------------------------------ normalisation ---------------------------- */

const clampScore = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
};

const cleanId = (value, fallback) => {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, MAX_ID_CHARS);
  return safe || fallback;
};

/** `int_<timestamp>_<random>` (the spec's record id). */
function newInteractionId(now = Date.now()) {
  return `int_${now}_${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Builds a storage-ready record from an untrusted request body. Unknown roles
 * fall back to `guest`, unknown media to `movie`, and every score is clamped to
 * 0-100 so a malformed payload can never corrupt the research CSV.
 */
function normalizeInteraction(input = {}, { now = new Date() } = {}) {
  const when = now instanceof Date ? now : new Date(now);
  const timestamp = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString();
  const role = ROLES.includes(String(input.role || '').toLowerCase())
    ? String(input.role).toLowerCase()
    : 'guest';
  const medium = MEDIA.includes(String(input.medium || '').toLowerCase())
    ? String(input.medium).toLowerCase()
    : 'movie';
  const pseudonym = String(input.pseudonym || '').trim().slice(0, MAX_PSEUDONYM_CHARS);

  return {
    id: newInteractionId(when.getTime()).slice(0, 80),
    timestamp,
    app_version: APP_VERSION,
    studentId: cleanId(input.studentId, role === 'guest' ? 'guest_unknown' : 'LB-unknown'),
    pseudonym: pseudonym || (role === 'guest' ? 'Guest' : 'Participant'),
    role,
    targetId: cleanId(input.targetId, 'unknown'),
    medium,
    sentence: String(input.sentence || '').trim().slice(0, MAX_SENTENCE_CHARS),
    overallScore: clampScore(input.overallScore),
    accuracyScore: clampScore(input.accuracyScore),
    fluencyScore: clampScore(input.fluencyScore),
    completenessScore: clampScore(input.completenessScore),
    revealed: input.revealed === true
  };
}

/* --------------------------------- storage ------------------------------- */

async function readFileRecords() {
  try {
    const raw = await fs.readFile(INTERACTIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.interactions)) return parsed.interactions;
    return [];
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[interactions] could not read ${INTERACTIONS_FILE} (${err.message}); starting a new log.`);
    }
    return [];
  }
}

async function writeFileRecords(records) {
  await fs.mkdir(path.dirname(INTERACTIONS_FILE), { recursive: true });
  const tmp = `${INTERACTIONS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, INTERACTIONS_FILE);
}

async function persistFile(entry) {
  const run = writeQueue.then(async () => {
    const records = await readFileRecords();
    records.push(entry);
    await writeFileRecords(records);
    return records.length;
  });
  // Keep the queue alive even if one write failed.
  writeQueue = run.catch(() => undefined);
  return run;
}

async function persistBlob(entry) {
  const store = blobStore();
  if (!store) {
    memory.push(entry);
    return;
  }
  await store.setJSON(entry.id, entry);
}

/**
 * Appends one record and returns it (with the generated id added).
 *
 * Storage hiccups never fail a student's turn: the record is mirrored in memory
 * (and the caller still receives 201 with `stored` describing the configured
 * backend) so a Blobs outage cannot block the practice loop.
 * @param {object} input raw request body
 */
async function record(input = {}) {
  const entry = normalizeInteraction(input);
  const mode = storageMode();
  try {
    if (mode === 'memory') memory.push(entry);
    else if (mode === 'blobs') await persistBlob(entry);
    else await persistFile(entry);
  } catch (err) {
    console.warn(`[interactions] ${mode} write failed (${err.message}); keeping ${entry.id} in memory.`);
    memory.push(entry);
  }
  return entry;
}

/** Every stored interaction, oldest first (the export order). */
async function list() {
  const mode = storageMode();
  let records = [];
  if (mode === 'memory') {
    records = [...memory];
  } else if (mode === 'blobs') {
    const store = blobStore();
    if (!store) {
      records = [...memory];
    } else {
      let cursor;
      do {
        const page = await store.list({ cursor });
        const blobs = (page && (page.blobs || page.keys)) || [];
        for (const blob of blobs) {
          const key = typeof blob === 'string' ? blob : blob.key;
          if (!key) continue;
          const value = await store.get(key, { type: 'json', consistency: 'strong' });
          if (value && typeof value === 'object') records.push(value);
        }
        cursor = page && page.cursor;
      } while (cursor);
    }
  } else {
    records = await readFileRecords();
  }
  return records.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

const count = async () => (await list()).length;

/* ---------------------------------- CSV ---------------------------------- */

const CSV_COLUMNS = [
  'id', 'timestamp', 'app_version', 'studentId', 'pseudonym', 'role', 'targetId',
  'medium', 'sentence', 'overallScore', 'accuracyScore', 'fluencyScore',
  'completenessScore', 'revealed'
];

/** RFC 4180 field: quote when needed, double embedded quotes. */
function csvField(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Interactions -> CSV text (header included) for Google Sheets. */
function toCsv(records = []) {
  const lines = [CSV_COLUMNS.join(',')];
  records.forEach((entry) => {
    lines.push(CSV_COLUMNS.map((column) => csvField(entry[column])).join(','));
  });
  return `${lines.join('\n')}\n`;
}

/** Test helper: forget in-memory records and the Blobs adapter. */
function resetMemory() {
  memory.length = 0;
  blobState = null;
  writeQueue = Promise.resolve();
}

module.exports = {
  APP_VERSION,
  STORE_NAME,
  INTERACTIONS_FILE,
  CSV_COLUMNS,
  storageMode,
  normalizeInteraction,
  newInteractionId,
  record,
  list,
  count,
  toCsv,
  resetMemory
};

