#!/usr/bin/env node
/**
 * v1.1.0 offline checks: release metadata, LinguaBridge roster auth and the
 * interaction telemetry store (no server, no network, no real student data).
 *   node scripts/auth-telemetry-check.mjs       (npm run test:auth)
 *
 * The HTTP surface (POST /api/auth/login|guest, POST /api/interactions,
 * GET /api/admin/export-csv) is exercised by scripts/smoke-test.js against a
 * running server; this script pins down the pure modules and the release
 * artefacts (package.json version, UI pill, CSV round-trip).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Configuration is read at require time, so install the test env first.
const ROSTER = {
  'LB-001': { name: 'AmberBeacon', pin: '1887' },
  'LB-002': { name: 'AmberEagle', pin: '2612' },
  'LB-003': { name: 'AmberHawk', pin: '1993' }
};
const INTERACTIONS_FILE = path.join(os.tmpdir(), `fb-interactions-${process.pid}.json`);
process.env.FORCE_MOCK = 'true';
process.env.STUDENT_ROSTER_JSON = JSON.stringify(ROSTER);
process.env.STUDENT_ROSTER_PATH = path.join(os.tmpdir(), 'fb-no-such-roster.json');
process.env.INTERACTIONS_STORE = 'file';
process.env.INTERACTIONS_FILE = INTERACTIONS_FILE;

const roster = require('../src/roster.js');
const interactions = require('../src/interactions.js');
const pkg = require('../package.json');
const { SENTENCES, releaseYear, releaseTitle } = require('../src/scenarios.js');

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

/* ------------------------------ release artefacts ------------------------ */

check('package.json is v1.1.0', pkg.version === '1.1.0', pkg.version);
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
check('the UI header pill reads v1.1.0',
  /class="tag tag-poc">v1\.1\.0</.test(indexHtml) && !/PoC v1\.0/.test(indexHtml));
check('the UI ships the participant login modal', indexHtml.includes('id="loginGate"')
  && indexHtml.includes('id="loginStudentId"') && indexHtml.includes('id="loginGuestBtn"'));
check('the UI ships the generation slider and summon button',
  indexHtml.includes('id="yearMin"') && indexHtml.includes('id="yearMax"')
  && indexHtml.includes('id="summonBtn"'));
check('the UI ships the mystery badges',
  indexHtml.includes('id="mysteryBadge"') && indexHtml.includes('id="mysteryReveal"'));

/* ------------------------------ release metadata ------------------------- */

check('releaseYear() reads the last year token',
  releaseYear('Céline Dion · Titanic · 1997') === 1997 && releaseYear('Star Wars · 1977') === 1977,
  String(releaseYear('Céline Dion · Titanic · 1997')));
check('releaseTitle() keeps the work/artist, not the year',
  releaseTitle('The Lord of the Rings · 2001') === 'The Lord of the Rings'
  && releaseTitle('Queen · 1975') === 'Queen');
const quotes = SENTENCES.filter((sentence) => sentence.medium !== 'scenario');
check('every movie/song target exposes year + title for the reveal',
  quotes.length > 0 && quotes.every((sentence) => Number.isFinite(sentence.year)
    && typeof sentence.title === 'string' && sentence.title.length > 0),
  `${quotes.length} movie/song targets`);


/* --------------------------------- roster -------------------------------- */

const info = roster.rosterInfo();
check('the roster is loaded from STUDENT_ROSTER_JSON',
  info.configured && info.source === 'env', JSON.stringify(info));
check('the roster exposes no PINs through /api/health metadata',
  !JSON.stringify(info).includes('1887'));
check('a correct participant ID + PIN signs in',
  JSON.stringify(roster.verifyStudent('lb-001', '1887'))
  === JSON.stringify({ studentId: 'LB-001', pseudonym: 'AmberBeacon', role: 'student' }),
  JSON.stringify(roster.verifyStudent('lb-001', '1887')));
check('a wrong PIN is rejected', roster.verifyStudent('LB-001', '0000') === null);
check('an unknown participant ID is rejected', roster.verifyStudent('LB-999', '1887') === null);
check('a malformed id/PIN is rejected before the lookup',
  roster.verifyStudent('../../etc/passwd', '1887') === null
  && roster.verifyStudent('LB-001', '18') === null);
check('publicStudent() returns the pseudonym only',
  JSON.stringify(roster.publicStudent('LB-002'))
  === JSON.stringify({ studentId: 'LB-002', pseudonym: 'AmberEagle' }));
check('a PIN is never part of a verified student object',
  !Object.prototype.hasOwnProperty.call(roster.verifyStudent('LB-003', '1993'), 'pin'));

/* ------------------------------- telemetry ------------------------------- */

check('the Blobs store name is fluency_interactions',
  interactions.STORE_NAME === 'fluency_interactions', interactions.STORE_NAME);
check('INTERACTIONS_STORE=file keeps local dev on data/interactions.json',
  interactions.storageMode() === 'file', interactions.storageMode());

const record = await interactions.record({
  studentId: 'LB-001',
  pseudonym: 'AmberBeacon',
  role: 'student',
  targetId: 'gen-z-1',
  medium: 'movie',
  sentence: 'I am inevitable.',
  overallScore: 91.4,
  accuracyScore: 88,
  fluencyScore: 82,
  completenessScore: 100,
  revealed: true
});
check('a record id looks like int_<timestamp>_<id>', /^int_\d+_[a-z0-9]+$/.test(record.id), record.id);
check('the record carries app_version 1.1.0', record.app_version === '1.1.0', record.app_version);
check('scores are rounded to integers',
  record.overallScore === 91 && record.accuracyScore === 88 && record.fluencyScore === 82
  && record.completenessScore === 100);
check('the record keeps the participant + reveal flag',
  record.studentId === 'LB-001' && record.pseudonym === 'AmberBeacon'
  && record.role === 'student' && record.revealed === true);

const onDisk = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
check('local dev appends to the interactions JSON file',
  Array.isArray(onDisk) && onDisk.length === 1 && onDisk[0].id === record.id,
  `${Array.isArray(onDisk) ? onDisk.length : 'not an array'} record(s)`);

const second = await interactions.record({
  studentId: 'guest_ab12cd',
  pseudonym: 'Guest',
  role: 'guest',
  targetId: 'movies-1',
  medium: 'movie',
  sentence: 'May the Force be with you.',
  overallScore: 42,
  accuracyScore: 35,
  fluencyScore: 60,
  completenessScore: 100,
  revealed: false
});
const all = await interactions.list();
check('appends are serialised (two records, oldest first)',
  all.length === 2 && all[0].id === record.id && all[1].id === second.id, `${all.length} records`);

const clamped = interactions.normalizeInteraction({ role: 'admin', medium: 'podcast', overallScore: 250, accuracyScore: -5 });
check('unknown roles/media fall back and scores are clamped 0-100',
  clamped.role === 'guest' && clamped.medium === 'movie'
  && clamped.overallScore === 100 && clamped.accuracyScore === 0,
  `${clamped.role}/${clamped.medium}/${clamped.overallScore}/${clamped.accuracyScore}`);

const csv = interactions.toCsv(all);
const lines = csv.trim().split('\n');
check('the CSV header matches the spec field order',
  lines[0] === interactions.CSV_COLUMNS.join(',')
  && lines[0].startsWith('id,timestamp,app_version,studentId,pseudonym,role,targetId,medium,sentence'),
  lines[0]);
check('the CSV exports one row per interaction with the reveal flag',
  lines.length === 3 && lines[1].includes(',LB-001,AmberBeacon,student,')
  && lines[1].endsWith(',91,88,82,100,true') && lines[2].endsWith(',false'),
  lines.slice(1).join(' || '));
check('CSV fields are escaped for Google Sheets imports',
  interactions.toCsv([{ ...record, sentence: 'He said "hi", then left.' }])
    .includes('"He said ""hi"", then left."'));

// Clean up the temp log so repeated runs do not grow it.
try { fs.unlinkSync(INTERACTIONS_FILE); } catch (err) { /* ignore */ }

console.log(failures ? `\n${failures} auth/telemetry check(s) failed.` : '\nAll auth + telemetry checks passed.');
process.exit(failures ? 1 : 0);
