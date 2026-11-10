#!/usr/bin/env node
/**
 * Local smoke test (no external APIs required).
 *   node scripts/smoke-test.js [baseUrl]
 *
 * `baseUrl` defaults to $BASE_URL, then http://localhost:3000.
 * Generates a 2 second 16 kHz mono WAV in memory, POSTs it to /api/assess,
 * feeds the transcript to /api/chat and prints a compact report.
 */

const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:3000';
const fs = require('node:fs');
const path = require('node:path');
// A local lab may set ADMIN_KEY (the export gate); read .env like server.js does.
require('dotenv').config();
// The verified size of the practice bank (src/scenarios.js): the API must never
// serve a trimmed subset, and the CDN copy (public/scenarios.json) mirrors it.
const EXPECTED_TARGETS = require('../src/scenarios').SENTENCES.length;
// Fresh per run: the daily per-student quota counts (assess/tts/chat) against
// this UUID, so repeated smoke tests never exhaust one bucket.
const STUDENT_ID = require('node:crypto').randomUUID();
const STUDENT_HEADERS = { 'x-client-session-id': STUDENT_ID };

function makeWav({ seconds = 2, sampleRate = 16000, freq = 196, silent = false } = {}) {
  const frames = Math.floor(seconds * sampleRate);
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i += 1) {
    const envelope = Math.sin((Math.PI * i) / frames); // fade in/out
    const sample = silent ? 0 : Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.35 * envelope;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

async function postJson(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...STUDENT_HEADERS },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (err) { data = { raw: text }; }
  return { status: response.status, data };
}

(async () => {
  let failures = 0;
  const check = (label, condition, detail) => {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!condition) failures += 1;
  };

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  const azureLive = Boolean(health.providers.azure.live);
  check('GET /api/health', health.ok === true, `azure=${azureLive ? 'live' : 'mock'} deepseek=${health.providers.deepseek.live ? 'live' : 'mock'}`);
  check('GET /api/health reports v1.1.0 + roster/telemetry posture',
    health.app_version === '1.1.0' && health.auth && health.auth.guest_enabled === true
      && health.telemetry && health.telemetry.store_name === 'fluency_interactions',
    `${health.app_version} · roster ${health.auth && health.auth.size} (${health.auth && health.auth.source}) · ${health.telemetry && health.telemetry.interactions_store}`);

  /* v1.1.0: LinguaBridge roster sign-in and one-click guest mode. */
  const guest = await postJson('/api/auth/guest', {});
  check('POST /api/auth/guest issues a guest id',
    guest.status === 200 && guest.data.ok === true && /^guest_[A-Za-z0-9]{6}$/.test(guest.data.studentId)
      && guest.data.pseudonym === 'Guest' && guest.data.role === 'guest',
    `${guest.status} ${guest.data && guest.data.studentId}`);
  const noPin = await postJson('/api/auth/login', { studentId: 'LB-001' });
  check('POST /api/auth/login requires the ID and PIN',
    noPin.status === 400 && noPin.data.error === 'missing_credentials', `${noPin.status} ${noPin.data && noPin.data.error}`);
  const wrongPin = await postJson('/api/auth/login', { studentId: 'LB-001', pin: '0000' });
  check('POST /api/auth/login refuses a wrong PIN (401, or 503 without a roster)',
    (wrongPin.status === 401 && wrongPin.data.error === 'invalid_credentials')
      || (wrongPin.status === 503 && wrongPin.data.error === 'roster_unavailable'),
    `${wrongPin.status} ${wrongPin.data && wrongPin.data.error}`);
  const rosterFile = path.join(__dirname, '..', 'data', 'students.json');
  if (fs.existsSync(rosterFile)) {
    const sample = Object.entries(JSON.parse(fs.readFileSync(rosterFile, 'utf8')))[0];
    const login = await postJson('/api/auth/login', { studentId: sample[0].toLowerCase(), pin: sample[1].pin });
    check('POST /api/auth/login accepts a real roster card (case-insensitive ID)',
      login.status === 200 && login.data.ok === true
        && login.data.studentId === sample[0] && login.data.pseudonym === sample[1].name
        && login.data.role === 'student',
      `${login.status} ${login.data && login.data.studentId} ${login.data && login.data.pseudonym}`);
  } else {
    check('POST /api/auth/login explains a missing roster (503)',
      wrongPin.status === 503 && wrongPin.data.error === 'roster_unavailable',
      'data/students.json is gitignored — create it or set STUDENT_ROSTER_JSON');
  }

  /* v1.1.0: interaction telemetry + Google Sheets CSV export. */
  const interaction = await postJson('/api/interactions', {
    studentId: 'LB-001',
    pseudonym: 'AmberBeacon',
    role: 'student',
    targetId: 'gen-z-1',
    medium: 'movie',
    sentence: 'I am inevitable.',
    overallScore: 91,
    accuracyScore: 88,
    fluencyScore: 82,
    completenessScore: 100,
    revealed: true
  });
  check('POST /api/interactions stores a scored turn',
    interaction.status === 201 && interaction.data.ok === true
      && /^int_\d+_[a-z0-9]+$/.test(interaction.data.id)
      && interaction.data.record.app_version === '1.1.0'
      && interaction.data.record.revealed === true,
    `${interaction.status} ${interaction.data && interaction.data.id} (${interaction.data && interaction.data.stored})`);

  // The server's own /api/health says whether the export gate is active; trust
  // that over the local .env (the smoke test can target a remote deployment).
  const exportGated = Boolean(health.telemetry && health.telemetry.export_requires_admin_key);
  const adminKey = String(process.env.ADMIN_KEY || '').trim();
  if (exportGated && adminKey) {
    const denied = await fetch(`${BASE}/api/admin/export-csv`);
    check('GET /api/admin/export-csv requires the admin key when ADMIN_KEY is set',
      denied.status === 401, `${denied.status}`);
  }
  const exportRes = await fetch(`${BASE}/api/admin/export-csv`, {
    headers: exportGated && adminKey ? { 'x-admin-key': adminKey } : {}
  });
  const exportCsv = await exportRes.text();
  if (exportGated && !adminKey) {
    check('GET /api/admin/export-csv refuses an unauthenticated export',
      exportRes.status === 401, `${exportRes.status} — set ADMIN_KEY locally to test the download`);
  } else {
    check('GET /api/admin/export-csv exports the log as CSV',
      exportRes.status === 200
        && String(exportRes.headers.get('content-type') || '').includes('text/csv')
        && exportCsv.startsWith('id,timestamp,app_version,studentId,pseudonym,role,targetId,medium,sentence')
        && exportCsv.includes(interaction.data.id),
      `${exportRes.status} · ${exportCsv.split('\n').length - 1} row(s)`);
  }

  if (/localhost|127\.0\.0\.1/.test(BASE)) {
    const logFile = path.join(__dirname, '..', 'data', 'interactions.json');
    let log = [];
    try { log = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch (err) { log = []; }
    check('local dev appends the record to data/interactions.json',
      Array.isArray(log) && log.some((entry) => entry.id === interaction.data.id),
      `${logFile} · ${Array.isArray(log) ? log.length : 0} record(s)`);
  }

  const scenarios = await fetch(`${BASE}/api/scenarios`).then((r) => r.json());
  const DEFAULT_ID = scenarios.default;
  const generationCategories = scenarios.categories.filter((c) => c.group === 'generations');
  const cohortCategories = generationCategories.filter((c) => !c.mix && !c.combined);
  const mixCategory = generationCategories.find((c) => c.mix);
  const combinedCategory = generationCategories.find((c) => c.combined);
  const cohortTotal = cohortCategories.reduce((sum, c) => sum + c.sentenceCount, 0);
  check('GET /api/scenarios returns the complete target bank',
    scenarios.scenarios.length === EXPECTED_TARGETS,
    `${scenarios.scenarios.length}/${EXPECTED_TARGETS} sentences`);
  check('practice categories', scenarios.categories.length === 16, scenarios.categories.map((c) => c.id).join(','));
  check('practice groups', scenarios.groups.length === 4, scenarios.groups.map((g) => g.label).join(' | '));
  check('generational cohorts (6) + combined + shuffle pool',
    cohortCategories.length === 6 && Boolean(mixCategory) && Boolean(combinedCategory),
    cohortCategories.map((c) => c.label).join(' | '));
  check('each cohort has 8-10 lines', cohortCategories.every((c) => c.sentenceCount >= 8 && c.sentenceCount <= 10),
    cohortCategories.map((c) => `${c.id}:${c.sentenceCount}`).join(' '));
  check('combined pool equals every cohort line',
    Boolean(combinedCategory) && combinedCategory.sentenceCount === cohortTotal,
    combinedCategory && String(combinedCategory.sentenceCount));
  check('mix pools every generational line',
    Boolean(mixCategory) && mixCategory.sentenceCount === cohortTotal,
    mixCategory && String(mixCategory.sentenceCount));
  check('every category declares a medium',
    scenarios.categories.every((c) => ['scenario', 'movie', 'song', 'mixed'].includes(c.medium)),
    scenarios.categories.map((c) => `${c.id}:${c.medium}`).join(' '));
  const mediaCounts = scenarios.scenarios.reduce((acc, s) => {
    acc[s.medium] = (acc[s.medium] || 0) + 1;
    return acc;
  }, {});
  check('every target declares a movie/song/scenario medium',
    mediaCounts.scenario + mediaCounts.movie + mediaCounts.song === scenarios.scenarios.length
      && mediaCounts.scenario > 0 && mediaCounts.movie > 0 && mediaCounts.song > 0,
    Object.entries(mediaCounts).map(([k, v]) => `${k}:${v}`).join(' '));
  check('default target has reference text', typeof scenarios.scenarios[0].referenceText === 'string'
    && scenarios.scenarios[0].keywords.length > 0, scenarios.scenarios[0].referenceText);
  check('every target has a static Japanese translation',
    scenarios.scenarios.every((s) => typeof s.ja === 'string' && s.ja.length > 0),
    `${scenarios.scenarios.filter((s) => s.ja).length}/${scenarios.scenarios.length}`);
  check('every target ships word-level vowel alignment',
    scenarios.scenarios.every((s) => s.wordVowels && typeof s.wordVowels === 'object'));
  check('every movie/song target ships hidden reveal metadata (year + title)',
    scenarios.scenarios.filter((s) => s.medium !== 'scenario')
      .every((s) => Number.isFinite(s.year) && typeof s.title === 'string' && s.title.length > 0),
    `${scenarios.scenarios.filter((s) => Number.isFinite(s.year)).length} dated targets`);
  const houston = scenarios.scenarios.find((s) => s.text.includes('Houston'));
  const houstonVowels = (houston && houston.wordVowels && houston.wordVowels.houston) || [];
  check('vowel lexicon aligns "Houston" ou -> /juː/',
    Boolean(scenarios.vowels && scenarios.vowels.houston) && houstonVowels[0]
      && houstonVowels[0][0] === 'ou' && houstonVowels[0][1] === 'juː',
    JSON.stringify(houstonVowels));
  check('vowel lexicon covers irregulars (latte, receipt)',
    Boolean(scenarios.vowels.latte && scenarios.vowels.receipt),
    `${Object.keys(scenarios.vowels || {}).length} words`);

  const wav = makeWav();
  const assess = await postJson('/api/assess', {
    audio: wav.toString('base64'),
    scenarioId: DEFAULT_ID,
    scripted: false
  });
  check('POST /api/assess (unscripted)', assess.status === 200, `status=${assess.status}`);
  const a = assess.data || {};

  if (azureLive) {
    // A synthetic tone is not speech, so live Azure legitimately returns NoMatch.
    check('assess response schema', typeof a.recognized_text === 'string' && Array.isArray(a.words),
      `ok=${a.ok} reason=${a.recognizer_reason || 'n/a'}`);
    check('audio-but-no-words -> dedicated status',
      a.ok === false && a.error === 'unrecognized_speech' && a.audio_present === true,
      `${a.error} / audio_present=${a.audio_present}`);
    check('contextual phrase list applied', Boolean(a.bias && a.bias.phrase_list_applied),
      `count=${a.bias && a.bias.phrase_list_count}`);
    if (!a.ok) {
      console.log('NOTE  live Azure did not recognise the synthetic tone (expected) — run `npm run check:live` for real-speech scoring.');
    }
  } else {
    check('assess.recognized_text', typeof a.recognized_text === 'string' && a.recognized_text.length > 0, JSON.stringify(a.recognized_text));
    check('assess.words[].phonemes', Array.isArray(a.words) && a.words.length > 0 && Array.isArray(a.words[0].phonemes));
    check('assess scores present', ['accuracy_score', 'fluency_score', 'completeness_score'].every((k) => typeof a[k] === 'number'));
  }
  check('assess audio meta', a.timing && a.timing.audio_duration_ms > 1500, `duration=${a.timing && a.timing.audio_duration_ms}`);

  const silent = await postJson('/api/assess', {
    audio: makeWav({ silent: true }).toString('base64'),
    scenarioId: DEFAULT_ID
  });
  check('silent clip short-circuited (no billed call)', silent.status === 200 && silent.data.ok === false && silent.data.silent === true,
    `source=${silent.data && silent.data.source}`);

  const scripted = await postJson('/api/assess', {
    audio: wav.toString('base64'),
    scenarioId: DEFAULT_ID,
    scripted: true,
    referenceText: 'I would like a medium latte with oat milk, please.'
  });
  check('POST /api/assess (scripted)', scripted.status === 200 && scripted.data.mode === 'scripted', scripted.data && scripted.data.mode);

  const short = await postJson('/api/assess', { audio: makeWav({ seconds: 0.05 }).toString('base64'), scenarioId: DEFAULT_ID });
  check('short audio rejected (400)', short.status === 400, short.data && short.data.error);

  const badWav = await postJson('/api/assess', { audio: Buffer.from('not a wav').toString('base64') });
  check('invalid WAV rejected (400)', badWav.status === 400, badWav.data && badWav.data.error);

  const chat = await postJson('/api/chat', {
    transcript: a.recognized_text || 'I want a big coffee.',
    scenarioId: DEFAULT_ID,
    history: [],
    assessment: a
  });
  check('POST /api/chat', chat.status === 200, `status=${chat.status}`);
  const c = chat.data || {};
  check('chat payload shape', Boolean(c.payload && c.payload.reply && c.payload.recast && Array.isArray(c.payload.chips)));
  check('chat has 3 chips', c.payload && c.payload.chips.length === 3, c.payload && String(c.payload.chips.length));
  check('chat constraint check', Boolean(c.constraint_check && typeof c.constraint_check.reply_word_count === 'number'), JSON.stringify(c.constraint_check && c.constraint_check.passes_all));
  check('chat provenance', ['live', 'fallback', 'mock'].includes(c.source), `${c.source} · ${c.model}`);

  const emptyChat = await postJson('/api/chat', { transcript: '', scenarioId: DEFAULT_ID });
  check('empty transcript rejected (400)', emptyChat.status === 400, emptyChat.data && emptyChat.data.error);

  const tts = await postJson('/api/tts', { text: 'Hello there.' });
  check('POST /api/tts (501 without Azure, 200 with)', tts.status === 200 || tts.status === 501, `status=${tts.status}`);

  const ttsMale = await postJson('/api/tts', { text: 'Hello there.', voice: 'en-US-GuyNeural' });
  check('TTS accepts the male voice', ttsMale.status === 200 || ttsMale.status === 501, `status=${ttsMale.status}`);
  const ttsFemale = await postJson('/api/tts', { text: 'Hello there.', voice: 'en-US-JennyNeural' });
  check('TTS accepts the female voice', ttsFemale.status === 200 || ttsFemale.status === 501, `status=${ttsFemale.status}`);
  const ttsPhoneme = await postJson('/api/tts', { phoneme: 'iː', text: 'e', voice: 'en-US-JennyNeural' });
  check('TTS speaks an isolated IPA phoneme', ttsPhoneme.status === 200 || ttsPhoneme.status === 501, `status=${ttsPhoneme.status}`);
  const badVoice = await postJson('/api/tts', { text: 'x', voice: 'evil" onclick=1' });
  check('TTS rejects an unsafe voice name', badVoice.status === 400 || badVoice.status === 501, `status=${badVoice.status}`);
  const badPhoneme = await postJson('/api/tts', { text: 'x', phoneme: '<script>' });
  check('TTS rejects an unsafe phoneme', badPhoneme.status === 400 || badPhoneme.status === 501, `status=${badPhoneme.status}`);

  const notFound = await fetch(`${BASE}/api/nope`).then((r) => r.json());
  check('unknown API route -> 404 json', notFound.error === 'not_found');

  const index = await fetch(`${BASE}/`).then((r) => r.text());
  check('GET / serves the app', index.includes('FluencyBridge') && index.includes('Research Inspector'));
  check('UI avoids the retired scenario wording', !/role\s*play/i.test(index));

  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
