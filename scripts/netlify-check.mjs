/**
 * Offline check of the Netlify packaging (no deploy, no keys).
 *   node scripts/netlify-check.mjs
 *
 * Loads netlify/functions/api.js exactly as Netlify would, invokes the handler
 * with Lambda-shaped events for the /api/* rewrite, asserts the function serves
 * the COMPLETE practice bank (276 targets, never a trimmed subset), and checks
 * that netlify.toml keeps the publish dir, the functions dir, the build step,
 * the external Speech SDK and the 200-status rewrite.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// server.js reads its configuration at require time, so set the test env first.
process.env.FORCE_MOCK = 'true';
process.env.USAGE_STORE = 'memory';
process.env.ACCESS_CODE = 'netlify-check-code';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

/**
 * Netlify-shaped Lambda event. Netlify sends `path`, `httpMethod`, `rawUrl`,
 * `headers` and `body` but **no `requestContext`** — faking it here is what let
 * a 502 ("Unable to determine event source based on event") reach production,
 * so the fixture must stay faithful to the platform.
 */
function event({ method = 'GET', pathname, headers = {}, body = null, legacy = false }) {
  const allHeaders = { 'x-nf-client-connection-ip': '203.0.113.7', ...headers };
  // Netlify always sends multiValueHeaders; serverless-express prefers them
  // over `headers`, so mirror the two exactly like the platform does.
  const multiValueHeaders = Object.fromEntries(
    Object.entries(allHeaders).map(([key, value]) => [key, [value]])
  );
  const base = {
    httpMethod: method,
    path: pathname,
    rawUrl: `https://fluency-bridge.netlify.app${pathname}`,
    rawQuery: '',
    headers: allHeaders,
    multiValueHeaders,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    body,
    isBase64Encoded: false,
    requestId: '01HZZZZZZZZZZZZZZZZZZZZZZZ'
  };
  // Legacy API Gateway v1 shape, kept to prove old fixtures still work.
  if (legacy) {
    return {
      ...base,
      requestContext: { path: pathname, httpMethod: method, stage: 'prod' }
    };
  }
  return base;
}

async function invoke(handler, evt) {
  const result = await handler(evt, {});
  let data = null;
  try {
    data = JSON.parse(result.body || '');
  } catch (err) {
    data = null;
  }
  const header = (name) => {
    const multi = result.multiValueHeaders || {};
    const key = Object.keys(multi).find((entry) => entry.toLowerCase() === name)
      || Object.keys(result.headers || {}).find((entry) => entry.toLowerCase() === name);
    if (!key) return undefined;
    const value = multi[key] !== undefined ? multi[key] : result.headers[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return { ...result, data, header };
}

const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
check('netlify.toml publishes public/', /publish\s*=\s*"public"/.test(toml));
check('netlify.toml points functions at netlify/functions',
  /functions\s*=\s*"netlify\/functions"/.test(toml));
check('netlify.toml rewrites /api/* to the function with status 200',
  /from\s*=\s*"\/api\/\*"/.test(toml)
  && /to\s*=\s*"\/\.netlify\/functions\/api\/:splat"/.test(toml)
  && /status\s*=\s*200/.test(toml));
check('netlify.toml regenerates public/scenarios.json on every deploy',
  /command\s*=\s*"npm run build"/.test(toml));
check('netlify.toml keeps the Azure Speech SDK out of the esbuild bundle',
  /external_node_modules\s*=\s*\[[^\]]*microsoft-cognitiveservices-speech-sdk/.test(toml));
check('the function entry point exists', fs.existsSync(path.join(ROOT, 'netlify/functions/api.js')));

// The verified size of the bank (src/scenarios.js) — the function and the CDN
// copy must both ship every one of these targets.
const { SENTENCES } = require('../src/scenarios.js');
const TARGETS = SENTENCES.length;
check('the source bank holds the verified 276 targets', TARGETS === 276, `${TARGETS} targets`);

const bankPath = path.join(ROOT, 'public/scenarios.json');
let cdnBank = null;
try {
  cdnBank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
} catch (err) {
  cdnBank = null;
}
check('the CDN fallback bank is published with the static site', Boolean(cdnBank)
  && Array.isArray(cdnBank.scenarios) && cdnBank.scenarios.length === TARGETS,
  cdnBank && Array.isArray(cdnBank.scenarios) ? `${cdnBank.scenarios.length}/${TARGETS} targets` : 'public/scenarios.json missing');


const { handler, toApiGatewayV1Event } = require('../netlify/functions/api.js');
check('the function exports a Lambda handler', typeof handler === 'function');

/* Event normalisation: Netlify sends no requestContext, so the shim must add it. */
const sampleEvent = event({ pathname: '/api/health' });
check('the Netlify fixture really has no requestContext (the 502 regression)',
  sampleEvent.requestContext === undefined);
const normalised = toApiGatewayV1Event(sampleEvent);
check('the shim adds the API Gateway v1 envelope serverless-express needs',
  normalised.requestContext && normalised.requestContext.httpMethod === 'GET'
    && normalised.requestContext.stage === 'prod' && normalised.httpMethod === 'GET'
    && normalised.path === '/api/health');
check('a direct function URL is mapped back onto the /api/* route',
  toApiGatewayV1Event(event({ pathname: '/.netlify/functions/api/health' })).path === '/api/health');

const health = await invoke(handler, event({ pathname: '/api/health' }));
check('GET /api/health through the function returns 200 JSON',
  health.statusCode === 200 && health.data && health.data.ok === true,
  `status ${health.statusCode}${health.data && health.data.errorMessage ? ` — ${health.data.errorMessage}` : ''}`);
const legacyHealth = await invoke(handler, event({ pathname: '/api/health', legacy: true }));
check('a legacy API Gateway-shaped event still works',
  legacyHealth.statusCode === 200 && legacyHealth.data.ok === true,
  `status ${legacyHealth.statusCode}`);
check('the function reports the daily quota limits',
  health.data && health.data.usage && health.data.usage.user_daily_call_limit === 60
    && health.data.usage.daily_azure_call_limit === 1500,
  JSON.stringify(health.data && health.data.usage));

const gated = await invoke(handler, event({ pathname: '/api/scenarios' }));
check('the access-code gate still applies inside the function',
  gated.statusCode === 401 && gated.data.error === 'access_code_required',
  `status ${gated.statusCode}`);

const scenarios = await invoke(handler, event({
  pathname: '/api/scenarios',
  headers: { 'x-access-code': 'netlify-check-code' }
}));
check('GET /api/scenarios through the function returns the COMPLETE library',
  scenarios.statusCode === 200 && Array.isArray(scenarios.data.scenarios)
    && scenarios.data.scenarios.length === TARGETS,
  `status ${scenarios.statusCode} — ${scenarios.data && scenarios.data.scenarios
    ? scenarios.data.scenarios.length : 0}/${TARGETS} targets`);

const chat = await invoke(handler, event({
  method: 'POST',
  pathname: '/api/chat',
  headers: {
    'content-type': 'application/json',
    'x-access-code': 'netlify-check-code',
    'x-client-session-id': '55555555-5555-4555-8555-555555555555'
  },
  body: JSON.stringify({ transcript: 'I would like a latte, please.' })
}));
check('POST /api/chat through the function returns a recast',
  chat.statusCode === 200 && chat.data && chat.data.payload && chat.data.payload.recast,
  `status ${chat.statusCode}`);
check('the per-student quota header is returned',
  Number(chat.header('x-student-daily-remaining')) === 59,
  String(chat.header('x-student-daily-remaining')));

console.log(failures ? `\n${failures} Netlify check(s) failed.` : '\nAll Netlify packaging checks passed.');
process.exitCode = failures ? 1 : 0;
