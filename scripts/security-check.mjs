#!/usr/bin/env node
/**
 * Offline deployment-hardening checks (no keys, no external calls).
 *   node scripts/security-check.mjs
 *
 * Boots server.js as a child process with ACCESS_CODE set and tight rate
 * limits, then asserts: the passcode gate (header + cookie), the session
 * cookie shape, the brute-force throttle, the per-route rate limiters, the
 * baseline response headers, the .gitignore secret rules and that no provider
 * key leaks into the health payload or the client bundle.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3400 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'security-check-code';
const LIMIT = 3;

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

/* The child inherits the shell env, but every hardening knob is pinned here so
   the checks are deterministic and never reach a live provider. */
const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    FORCE_MOCK: 'true',
    ACCESS_CODE: CODE,
    ACCESS_ATTEMPT_LIMIT: String(LIMIT),
    RATE_LIMIT_MAX: String(LIMIT),
    RATE_LIMIT_TTS_MAX: String(LIMIT),
    RATE_LIMIT_WINDOW_MS: '60000',
    SECURE_COOKIES: 'false',
    TRUST_PROXY: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

async function waitForServer(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch (err) { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function call(pathname, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${pathname}`, {
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
  return { status: res.status, headers: res.headers, data, text };
}

/** Values from the local .env that must never reach a client. */
async function localSecrets() {
  let raw = '';
  try {
    raw = await readFile(path.join(ROOT, '.env'), 'utf8');
  } catch (err) {
    return [];
  }
  const secrets = [];
  raw.split('\n').forEach((line) => {
    const match = line.match(/^\s*(AZURE_SPEECH_KEY|DEEPSEEK_API_KEY|ACCESS_CODE)\s*=\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (match && match[2].length >= 8) secrets.push(match[2]);
  });
  return secrets;
}

async function main() {
  const ready = await waitForServer();
  if (!ready) {
    console.error('Server did not start. Log:\n' + serverLog);
    process.exitCode = 1;
    return;
  }

  /* 1. Secret hygiene: .gitignore rules (no git repo required). */
  const ignore = await readFile(path.join(ROOT, '.gitignore'), 'utf8');
  const ignoreLines = ignore.split('\n').map((line) => line.trim());
  check('.gitignore explicitly ignores .env', ignoreLines.includes('.env'));
  check('.gitignore ignores .env.* but keeps the template',
    ignoreLines.includes('.env.*') && ignoreLines.includes('!.env.example'));
  check('.gitignore does not ignore .env.example', !ignoreLines.includes('.env.example'));

  const secrets = await localSecrets();

  /* 2. Unauthenticated surface. */
  const health = await call('/api/health');
  check('GET /api/health is public', health.status === 200, `status ${health.status}`);
  check('health advertises the gate without secrets',
    health.data && health.data.security && health.data.security.access_code_required === true
      && health.data.security.rate_limit.max === LIMIT
      && health.data.security.access_attempts.max === LIMIT,
    JSON.stringify(health.data && health.data.security));

  const gated = await call('/api/scenarios');
  check('GET /api/scenarios requires the access code',
    gated.status === 401 && gated.data && gated.data.error === 'access_code_required',
    `status ${gated.status} / ${gated.data && gated.data.error}`);

  const gatedAssess = await call('/api/assess', { method: 'POST', body: {} });
  check('POST /api/assess requires the access code', gatedAssess.status === 401);

  const gatedChat = await call('/api/chat', { method: 'POST', body: { transcript: 'hi' } });
  check('POST /api/chat requires the access code', gatedChat.status === 401);

  const gatedTts = await call('/api/tts', { method: 'POST', body: { text: 'hi' } });
  check('POST /api/tts requires the access code', gatedTts.status === 401);

  const unknownApi = await call('/api/does-not-exist');
  check('unknown /api routes are gated too (no route probing)', unknownApi.status === 401);

  const root = await fetch(`${BASE}/`);
  const html = await root.text();
  check('the static UI stays public so the passcode dialog can load',
    root.ok && html.includes('accessGate'), `status ${root.status}`);

  /* 3. Baseline headers + no secret leakage. */
  const headers = health.headers;
  check('baseline security headers are present',
    headers.get('x-content-type-options') === 'nosniff'
      && headers.get('x-frame-options') === 'DENY'
      && headers.get('referrer-policy') === 'no-referrer',
    `${headers.get('x-content-type-options')} / ${headers.get('x-frame-options')} / ${headers.get('referrer-policy')}`);
  check('X-Powered-By is removed', !headers.get('x-powered-by'));

  const bundle = await Promise.all(['/js/api.js', '/js/app.js', '/index.html'].map(async (asset) => {
    const res = await fetch(`${BASE}${asset}`);
    return { asset, text: await res.text() };
  }));
  const leaked = secrets.filter((secret) => health.text.includes(secret)
    || bundle.some((entry) => entry.text.includes(secret)));
  check('no provider key appears in /api/health or the client bundle', leaked.length === 0,
    leaked.length ? `${leaked.length} secret(s) leaked` : `${secrets.length} local secret(s) checked`);


  /* 4. Session handshake. */
  const session = await call('/api/session');
  check('GET /api/session reports the gate state',
    session.status === 200 && session.data.access_code_required === true
      && session.data.authenticated === false,
    JSON.stringify(session.data));

  const wrong = await call('/api/session', { method: 'POST', body: { code: 'nope' } });
  check('a wrong access code is rejected', wrong.status === 401
    && wrong.data.error === 'invalid_access_code', `status ${wrong.status}`);

  const unlock = await call('/api/session', { method: 'POST', body: { code: CODE } });
  const setCookie = unlock.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  check('the correct access code unlocks a session', unlock.status === 200
    && unlock.data.authenticated === true, `status ${unlock.status}`);
  check('the session cookie is HttpOnly + SameSite=Lax + Path=/',
    /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie) && /Path=\//i.test(setCookie),
    setCookie);
  check('the session cookie never contains the passcode',
    cookie.length > 0 && !cookie.includes(CODE), cookie);
  check('the session cookie expires', /Max-Age=\d+/i.test(setCookie), setCookie);

  const viaCookie = await call('/api/scenarios', { headers: { Cookie: cookie } });
  check('the session cookie authorises /api/scenarios', viaCookie.status === 200,
    `status ${viaCookie.status}`);

  const viaHeader = await call('/api/scenarios', { headers: { 'X-Access-Code': CODE } });
  check('the X-Access-Code header authorises /api/scenarios', viaHeader.status === 200,
    `status ${viaHeader.status}`);

  const tampered = await call('/api/scenarios', { headers: { Cookie: 'fb_access=9999999999999.deadbeef' } });
  check('a tampered/expired cookie is rejected', tampered.status === 401, `status ${tampered.status}`);

  /* 5. Rate limits (LIMIT requests per window, per IP, per route). */
  const auth = { 'X-Access-Code': CODE };
  const assess = await call('/api/assess', { method: 'POST', body: {}, headers: auth });
  check('an authorised request still reaches the route handler', assess.status === 400,
    `status ${assess.status} / ${assess.data && assess.data.error}`);

  const chatCodes = [];
  for (let i = 0; i < LIMIT + 1; i += 1) {
    const res = await call('/api/chat', { method: 'POST', body: { transcript: `hello ${i}` }, headers: auth });
    chatCodes.push(res.status);
  }
  const lastChat = await call('/api/chat', { method: 'POST', body: { transcript: 'again' }, headers: auth });
  check(`/api/chat allows ${LIMIT}/min then answers 429`,
    chatCodes.slice(0, LIMIT).every((status) => status === 200)
      && lastChat.status === 429 && lastChat.data.error === 'rate_limited',
    chatCodes.join(','));
  check('a 429 carries Retry-After + RateLimit headers',
    /^\d+$/.test(lastChat.headers.get('retry-after') || '')
      && Boolean(lastChat.headers.get('ratelimit')),
    `retry-after=${lastChat.headers.get('retry-after')}`);

  const ttsCodes = [];
  for (let i = 0; i < LIMIT + 1; i += 1) {
    const res = await call('/api/tts', { method: 'POST', body: { text: `hi ${i}` }, headers: auth });
    ttsCodes.push(res.status);
  }
  check(`/api/tts has its own ${LIMIT}/min budget`,
    ttsCodes[ttsCodes.length - 1] === 429 && ttsCodes.slice(0, LIMIT).every((status) => status !== 429),
    ttsCodes.join(','));

  /* 6. Passcode brute-force throttle (2 of LIMIT attempts already used). */
  const attempts = [];
  for (let i = 0; i < LIMIT + 1; i += 1) {
    const res = await call('/api/session', { method: 'POST', body: { code: `guess-${i}` } });
    attempts.push(res.status);
  }
  check('repeated passcode guesses are throttled with 429', attempts.includes(429),
    attempts.join(','));

  console.log(failures ? `\n${failures} security check(s) failed.` : '\nAll security checks passed.');
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((err) => {
    console.error('Security check crashed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
  });

