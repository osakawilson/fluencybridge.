/**
 * LinguaBridge participant roster (v1.1.0 auth).
 *
 * Students sign in with the participant ID and 4-digit PIN printed on their
 * LinguaBridge login cards (`LB-001` / `1887`), so FluencyBridge never invents a
 * second identity for the same person. The roster is a secret: real PINs must
 * never reach git, which is why it is loaded from
 *
 *   1. `STUDENT_ROSTER_JSON` — the whole roster as JSON (Netlify env var), then
 *   2. `STUDENT_ROSTER_PATH` / `data/students.json` — the gitignored local copy.
 *
 * Accepted JSON shapes (both are used in the wild):
 *
 *   { "LB-001": { "name": "AmberBeacon", "pin": "1887" } }   // data/students.json
 *   [ { "studentId": "LB-001", "name": "AmberBeacon", "pin": "1887" } ]
 *
 * `name` is the pseudonym from the login card (never the legal name).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ROSTER_FILE = process.env.STUDENT_ROSTER_PATH
  ? path.resolve(process.env.STUDENT_ROSTER_PATH)
  : path.join(ROOT, 'data', 'students.json');
const MAX_FILE_BYTES = 512 * 1024;

/** `LB-001`. The cards use three digits; accept any 1-4 to stay generous. */
const STUDENT_ID_PATTERN = /^LB-[0-9]{1,4}$/i;
const PIN_PATTERN = /^[0-9]{4}$/;

let cache = null;

const normalizeStudentId = (value) => String(value === undefined || value === null ? '' : value).trim().toUpperCase();
const normalizePin = (value) => String(value === undefined || value === null ? '' : value).trim();

/** Constant-time compare that never throws on a length mismatch. */
function safeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left)).digest();
  const b = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Normalises one roster entry. Returns null when the id or PIN is unusable, so
 * a malformed line never silently authorises anybody.
 */
function normalizeEntry(studentId, raw) {
  const id = normalizeStudentId(studentId);
  if (!STUDENT_ID_PATTERN.test(id)) return null;

  let pin;
  let name;
  if (raw && typeof raw === 'object') {
    pin = normalizePin(raw.pin !== undefined ? raw.pin : raw.password);
    name = String(raw.name || raw.pseudonym || '').trim();
  } else {
    // Compact shape: { "LB-001": "1887" }
    pin = normalizePin(raw);
    name = '';
  }
  if (!PIN_PATTERN.test(pin)) return null;
  return { studentId: id, pseudonym: name || id, pin };
}

/** Map -> { id: entry }|null. Malformed JSON/entries are dropped, never thrown. */
function parseRoster(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  const entries = new Map();
  const add = (id, value) => {
    const entry = normalizeEntry(id, value);
    if (entry) entries.set(entry.studentId, entry);
  };
  if (Array.isArray(parsed)) {
    parsed.forEach((item) => {
      if (item && typeof item === 'object') add(item.studentId || item.id, item);
    });
  } else if (parsed && typeof parsed === 'object') {
    Object.entries(parsed).forEach(([id, value]) => add(id, value));
  }
  return entries;
}

function readRosterFile() {
  try {
    const stats = fs.statSync(ROSTER_FILE);
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(ROSTER_FILE, 'utf8');
  } catch (err) {
    return null;
  }
}

/**
 * Loads (and memoises) the roster. `source` says where the entries came from so
 * `/api/health` and the login error can tell an operator what to fix.
 * @returns {{entries: Map, source: 'env'|'file'|'none', path: string|null}}
 */
function loadRoster() {
  if (cache) return cache;

  const fromEnv = String(process.env.STUDENT_ROSTER_JSON || '').trim();
  if (fromEnv) {
    const entries = parseRoster(fromEnv);
    if (entries) {
      cache = { entries, source: 'env', path: null };
      return cache;
    }
  }

  const fromFile = readRosterFile();
  if (fromFile) {
    const entries = parseRoster(fromFile);
    if (entries) {
      cache = { entries, source: 'file', path: ROSTER_FILE };
      return cache;
    }
  }

  cache = { entries: new Map(), source: 'none', path: fromFile === null ? null : ROSTER_FILE };
  return cache;
}

/** Public (PIN-free) description for /api/health — never leaks a PIN. */
function rosterInfo() {
  const { entries, source, path: rosterPath } = loadRoster();
  return {
    configured: entries.size > 0,
    size: entries.size,
    source,
    // The absolute path is useful locally; omit it from a public deployment.
    file: process.env.NODE_ENV === 'production' || process.env.NETLIFY ? null : rosterPath
  };
}

/**
 * Verifies `studentId` + `pin` against the roster.
 * @returns {{studentId: string, pseudonym: string, role: 'student'}|null}
 */
function verifyStudent(studentId, pin) {
  const id = normalizeStudentId(studentId);
  const code = normalizePin(pin);
  if (!STUDENT_ID_PATTERN.test(id) || !PIN_PATTERN.test(code)) return null;
  const entry = loadRoster().entries.get(id);
  if (!entry) return null;
  if (!safeEqual(entry.pin, code)) return null;
  return { studentId: entry.studentId, pseudonym: entry.pseudonym, role: 'student' };
}

/** Everything the UI may show about a participant (no PIN). */
function publicStudent(studentId) {
  const entry = loadRoster().entries.get(normalizeStudentId(studentId));
  return entry ? { studentId: entry.studentId, pseudonym: entry.pseudonym } : null;
}

const rosterSize = () => loadRoster().entries.size;

/** Test/dev helper: forgets the memoised roster (e.g. after changing the env). */
function resetCache() {
  cache = null;
}

module.exports = {
  loadRoster,
  rosterInfo,
  rosterSize,
  verifyStudent,
  publicStudent,
  normalizeStudentId,
  resetCache,
  // exported for unit tests
  parseRoster,
  PIN_PATTERN,
  STUDENT_ID_PATTERN
};
