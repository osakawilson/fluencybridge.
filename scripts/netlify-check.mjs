/**
 * Offline check of the Netlify packaging (no deploy, no keys).
 *   node scripts/netlify-check.mjs
 *
 * Loads netlify/functions/api.js exactly as Netlify would, invokes the handler
 * with Lambda-shaped events for the /api/* rewrite, and asserts netlify.toml
 * keeps the publish dir, the functions dir and the 200-status rewrite.
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

/** API Gateway v1-shaped event, which is what Netlify Functions receive. */
function event({ method = 'GET', pathname, headers = {}, body = null }) {
  // Netlify always sends multiValueHeaders; serverless-express prefers them
  // over `headers`, so mirror the two exactly like the platform does.
  const multiValueHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, [value]])
  );
  return {
    httpMethod: method,
    path: pathname,
    resource: pathname,
    headers,
    multiValueHeaders,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    body,
    isBase64Encoded: false,
    requestContext: { path: pathname, httpMethod: method, stage: 'prod' }
  };
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
check('the function entry point exists', fs.existsSync(path.join(ROOT, 'netlify/functions/api.js')));

const { handler } = require('../netlify/functions/api.js');
check('the function exports a Lambda handler', typeof handler === 'function');

const health = await invoke(handler, event({ pathname: '/api/health' }));
check('GET /api/health through the function returns 200 JSON',
  health.statusCode === 200 && health.data && health.data.ok === true,
  `status ${health.statusCode}`);
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
check('GET /api/scenarios through the function returns the library',
  scenarios.statusCode === 200 && Array.isArray(scenarios.data.scenarios)
    && scenarios.data.scenarios.length >= 90,
  `status ${scenarios.statusCode}`);

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
