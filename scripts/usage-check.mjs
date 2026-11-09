#!/usr/bin/env node
/**
 * Offline checks for the tiered daily quotas (no keys, no provider calls).
 *   node scripts/usage-check.mjs
 *
 * Part 1 exercises src/usage.js directly (counter math, refusals, refunds,
 * date keys). Part 2 boots the real server twice — once with a 3-call student
 * quota, once with the global Azure budget at 0 — and asserts the HTTP
 * contract, including that two students sharing one IP/NAT stay independent.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

/* -------------------- part 1: usage engine unit tests --------------------- */

process.env.USAGE_STORE = 'memory';
process.env.USER_DAILY_CALL_LIMIT = '2';
process.env.DAILY_AZURE_CALL_LIMIT = '3';
const usage = require('../src/usage.js');

check('limits are read from the environment',
  usage.USER_DAILY_CALL_LIMIT === 2 && usage.DAILY_AZURE_CALL_LIMIT === 3,
  `${usage.USER_DAILY_CALL_LIMIT}/${usage.DAILY_AZURE_CALL_LIMIT}`);
check('storage falls back to memory without Netlify Blobs', usage.storageMode() === 'memory');
check('date keys are YYYY-MM-DD (UTC)',
  usage.todayKey(new Date('2026-03-04T23:59:59Z')) === '2026-03-04'
  && /^\d{4}-\d{2}-\d{2}$/.test(usage.todayKey()), usage.todayKey());
check('the next reset is midnight UTC',
  usage.nextResetIso(new Date('2026-03-04T10:00:00Z')) === '2026-03-05T00:00:00.000Z',
  usage.nextResetIso(new Date('2026-03-04T10:00:00Z')));
check('student IDs accept UUIDs and reject junk',
  usage.normalizeStudentId('3f2b8c1e-9a4d-4b7e-8c2a-5d6e7f8a9b0c') !== null
  && usage.normalizeStudentId('short') === null && usage.normalizeStudentId('has space here') === null
  && usage.normalizeStudentId('') === null);
check('anonymous fallback is stable and not the raw IP',
  usage.anonymousStudentId('203.0.113.9') === usage.anonymousStudentId('203.0.113.9')
  && !usage.anonymousStudentId('203.0.113.9').includes('203.0.113.9'));

(async () => {
  const first = await usage.reserveStudentCall('unit-student-a');
  const second = await usage.reserveStudentCall('unit-student-a');
  const third = await usage.reserveStudentCall('unit-student-a');
  check('per-student counter allows exactly the limit',
    first.allowed && first.used === 1 && second.allowed && second.used === 2
    && !third.allowed && third.used === 2,
    `${first.used}/${second.used}/${third.used}`);

  const other = await usage.reserveStudentCall('unit-student-b');
  check('a different student ID has an independent counter', other.allowed && other.used === 1);

  const refunded = await usage.refundStudentCall('unit-student-a');
  check('refunds release a reserved call', refunded.allowed && refunded.used === 1);
  const again = await usage.reserveStudentCall('unit-student-a');
  check('the refunded slot can be reused', again.allowed && again.used === 2);

  const peek = await usage.peekStudentUsage('unit-student-a');
  check('peek reports used / remaining',
    peek.used === 2 && peek.limit === 2 && peek.remaining === 0 && peek.allowed === false,
    JSON.stringify(peek));

  const g1 = await usage.reserveAzureCall();
  const g2 = await usage.reserveAzureCall();
  const g3 = await usage.reserveAzureCall();
  const g4 = await usage.reserveAzureCall();
  check('global Azure budget stops at the configured ceiling',
    g1.allowed && g2.allowed && g3.allowed && !g4.allowed && g4.used === 3,
    `${g1.used},${g2.used},${g3.used},${g4.used}`);

  const globalPeek = await usage.peekGlobalUsage();
  check('global peek reports the ceiling',
    globalPeek.limit === 3 && globalPeek.used === 3 && globalPeek.allowed === false);

  await usage.refundAzureCall();
  const afterRefund = await usage.peekGlobalUsage();
  check('global refunds work', afterRefund.used === 2 && afterRefund.allowed === true);

  check('the key namespaces are date-scoped',
    usage.userKey('abc12345', '2026-03-04') === 'user:2026-03-04:abc12345'
    && usage.globalKey('2026-03-04') === 'global:2026-03-04:azure');

  /* ------------------ part 2: HTTP integration (spawned) ------------------- */

  const serverA = await startServer({
    PORT: String(3500 + (process.pid % 300)),
    FORCE_MOCK: 'true',
    USAGE_STORE: 'memory',
    USER_DAILY_CALL_LIMIT: '3',
    DAILY_AZURE_CALL_LIMIT: '100',
    ACCESS_CODE: '',
    TRUST_PROXY: ''
  });

  const STUDENT_A = '11111111-1111-4111-8111-111111111111';
  const STUDENT_B = '22222222-2222-4222-8222-222222222222';
  const STUDENT_C = '33333333-3333-4333-8333-333333333333';
  const student = (id) => ({ 'x-client-session-id': id });

  const chat = (id, text) => call(serverA.base, '/api/chat', {
    method: 'POST', body: { transcript: text }, headers: student(id)
  });
  const assess = (id) => call(serverA.base, '/api/assess', {
    method: 'POST', body: { audio: makeWav({ seconds: 1 }).toString('base64') }, headers: student(id)
  });
  const tts = (id) => call(serverA.base, '/api/tts', {
    method: 'POST', body: { text: 'hello' }, headers: student(id)
  });

  const aStatuses = [];
  const aRemaining = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await chat(STUDENT_A, `student a turn ${i}`);
    aStatuses.push(res.status);
    if (res.status === 200) aRemaining.push(res.headers.get('x-student-daily-remaining'));
  }
  check('student A: 3 calls pass, the 4th is blocked',
    aStatuses.slice(0, 3).every((status) => status === 200) && aStatuses[3] === 429,
    aStatuses.join(','));

  const exhausted = await chat(STUDENT_A, 'student a again');
  check('student A receives user_limit_reached with the friendly message',
    exhausted.status === 429 && exhausted.data.error === 'user_limit_reached'
      && exhausted.data.message === 'You have completed your 3 practice attempts for today! Great work. Please review your scores and practice notes.',
    exhausted.data && exhausted.data.message);
  check('the remaining-calls header counts down to zero',
    aRemaining.join(',') === '2,1,0', aRemaining.join(','));
  check('the 429 carries the reset time and limit',
    exhausted.data.limit === 3 && exhausted.data.used === 3
      && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(exhausted.data.resets_at || ''),
    JSON.stringify({ limit: exhausted.data.limit, used: exhausted.data.used, resets_at: exhausted.data.resets_at }));

  const blockedAssess = await assess(STUDENT_A);
  check('the blocked student cannot reach /api/assess either', blockedAssess.status === 429);

  // Same IP, different student: the NAT case this design exists for.
  const bTurn = await chat(STUDENT_B, 'student b first turn');
  check('student B on the same IP is unaffected', bTurn.status === 200,
    `status ${bTurn.status} remaining=${bTurn.headers.get('x-student-daily-remaining')}`);
  const freshTurn = await chat('44444444-4444-4444-8444-444444444444', 'fresh device');
  check('a fresh session ID starts with a full budget', freshTurn.status === 200,
    `remaining=${freshTurn.headers.get('x-student-daily-remaining')}`);

  // assess + chat share one bucket; tts is gated by the same limit.
  const cFirst = await chat(STUDENT_C, 'student c turn');
  const cSecond = await assess(STUDENT_C);
  const cThird = await assess(STUDENT_C);
  const cFourth = await tts(STUDENT_C);
  check('chat and assess draw on the same student budget',
    cFirst.status === 200 && cSecond.status === 200 && cThird.status === 200,
    `${cFirst.status},${cSecond.status},${cThird.status}`);
  check('/api/tts is refused once the student budget is spent',
    cFourth.status === 429 && cFourth.data.error === 'user_limit_reached', `status ${cFourth.status}`);

  const usageHealth = await call(serverA.base, '/api/health?usage=1', { headers: student(STUDENT_A) });
  check('health?usage=1 exposes the exhausted counter without PII',
    usageHealth.data.usage.student.used === 3 && usageHealth.data.usage.student.allowed === false
      && usageHealth.data.usage.user_daily_call_limit === 3,
    JSON.stringify(usageHealth.data.usage));
  check('the daily counters are date-scoped',
    /^\d{4}-\d{2}-\d{2}$/.test(usageHealth.data.usage.date), usageHealth.data.usage.date);

  /* ------------------- part 3: global Azure circuit breaker ----------------- */

  const serverB = await startServer({
    PORT: String(3900 + (process.pid % 90)),
    FORCE_MOCK: 'true',
    USAGE_STORE: 'memory',
    DAILY_AZURE_CALL_LIMIT: '0',
    // Remove the test value so the real default (60) is exercised.
    USER_DAILY_CALL_LIMIT: null,
    ACCESS_CODE: '',
    TRUST_PROXY: ''
  });

  const bHealth = await call(serverB.base, '/api/health');
  check('the default per-student limit is 60',
    bHealth.data.usage.user_daily_call_limit === 60,
    String(bHealth.data.usage.user_daily_call_limit));
  check('the global Azure limit is configurable to zero',
    bHealth.data.usage.daily_azure_call_limit === 0);

  const halted = await Promise.all([
    call(serverB.base, '/api/chat', { method: 'POST', body: { transcript: 'hi' }, headers: student(STUDENT_B) }),
    call(serverB.base, '/api/assess', { method: 'POST', body: { audio: makeWav({ seconds: 1 }).toString('base64') }, headers: student(STUDENT_B) }),
    call(serverB.base, '/api/tts', { method: 'POST', body: { text: 'hi' }, headers: student(STUDENT_B) })
  ]);
  check('an exhausted global budget returns 503 on chat/assess/tts',
    halted.every((res) => res.status === 503 && res.data.error === 'daily_budget_exhausted'),
    halted.map((res) => res.status).join(','));
  check('the 503 uses the exact pausing message',
    halted[0].data.message === 'Daily lab practice limit reached for today. System paused until tomorrow.',
    halted[0].data.message);

  /* ------------- part 4: the real 60-call default, end to end --------------- */

  const serverC = await startServer({
    PORT: String(3700 + (process.pid % 90)),
    FORCE_MOCK: 'true',
    USAGE_STORE: 'memory',
    // Real default quota (60) but a roomier IP limit so only the quota trips.
    USER_DAILY_CALL_LIMIT: null,
    RATE_LIMIT_MAX: '200',
    ACCESS_CODE: '',
    TRUST_PROXY: ''
  });

  const SIXTY = '66666666-6666-4666-8666-666666666666';
  const statuses = [];
  for (let i = 0; i < 60; i += 1) {
    const res = await call(serverC.base, '/api/chat', {
      method: 'POST', body: { transcript: `turn ${i}` }, headers: student(SIXTY)
    });
    statuses.push(res.status);
  }
  const sixtyFirst = await call(serverC.base, '/api/chat', {
    method: 'POST', body: { transcript: 'turn 61' }, headers: student(SIXTY)
  });
  check('60 calls per session ID all succeed', statuses.every((status) => status === 200),
    `${statuses.filter((status) => status === 200).length}/60`);
  check('the 61st call on that ID is blocked with the exact message',
    sixtyFirst.status === 429 && sixtyFirst.data.error === 'user_limit_reached'
      && sixtyFirst.data.message
        === 'You have completed your 60 practice attempts for today! Great work. Please review your scores and practice notes.',
    `status ${sixtyFirst.status}`);

  const freshAfterSixty = await call(serverC.base, '/api/chat', {
    method: 'POST', body: { transcript: 'fresh device' }, headers: student('77777777-7777-4777-8777-777777777777')
  });
  check('a fresh session ID still passes after another hits 60',
    freshAfterSixty.status === 200
      && freshAfterSixty.headers.get('x-student-daily-remaining') === '59',
    `status ${freshAfterSixty.status} remaining=${freshAfterSixty.headers.get('x-student-daily-remaining')}`);

  serverA.child.kill();
  serverB.child.kill();
  serverC.child.kill();

  console.log(failures ? `\n${failures} usage check(s) failed.` : '\nAll usage/quota checks passed.');
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error('Usage check crashed:', err);
  process.exitCode = 1;
});


/* ------------------------------- helpers -------------------------------- */

/** 16-bit mono PCM WAV with a 1 s tone (non-silent, so /api/assess runs). */
function makeWav({ seconds = 1, sampleRate = 16000, freq = 196 } = {}) {
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
    const envelope = Math.sin((Math.PI * i) / frames);
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.35 * envelope;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

async function startServer(overrides) {
  const env = { ...process.env, ...overrides };
  // A null override removes the variable so the child sees the real default.
  Object.entries(overrides).forEach(([key, value]) => {
    if (value === null || value === undefined) delete env[key];
  });
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const base = `http://127.0.0.1:${overrides.PORT}`;
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return { base, child };
    } catch (err) { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`Server did not start on port ${env.PORT}:\n${output}`);
}

async function call(base, pathname, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = { raw: text };
  }
  return { status: res.status, headers: res.headers, data };
}

