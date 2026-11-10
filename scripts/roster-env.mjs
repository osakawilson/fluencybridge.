#!/usr/bin/env node
/**
 * Prepares the LinguaBridge roster for the `STUDENT_ROSTER_JSON` env var.
 *
 *   node scripts/roster-env.mjs [data/students.json]
 *
 * Netlify's Lambda compatibility mode caps the WHOLE function environment at
 * 4 KB, so a 101-student roster (≈4.5 KB of JSON) has to travel compressed:
 * this prints the compact JSON when it fits, otherwise the gzip+base64 form
 * (≈1.5 KB) that src/roster.js decodes transparently.
 *
 * The value is a secret (it contains PINs): pipe it into the Netlify CLI, never
 * into a file that could be committed.
 *
 *   node scripts/roster-env.mjs > /tmp/roster.env
 *   npx netlify env:set STUDENT_ROSTER_JSON "$(cat /tmp/roster.env)" \
 *       --secret --force --context production
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv[2] || path.join(ROOT, 'data', 'students.json'));

if (!fs.existsSync(file)) {
  console.error(`roster-env: ${file} not found. Build it from the LinguaBridge login cards first.`);
  process.exit(1);
}

let roster;
try {
  roster = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`roster-env: ${file} is not valid JSON (${err.message}).`);
  process.exit(1);
}

const compact = JSON.stringify(roster);
const gzipped = zlib.gzipSync(Buffer.from(compact, 'utf8')).toString('base64');
const count = Object.keys(roster).filter((key) => /^LB-/i.test(key)).length;

if (!count) {
  console.error('roster-env: no LB-xxx entries found.');
  process.exit(1);
}

const NETLIFY_API_LIMIT = 5000;
// Netlify's Lambda compatibility mode also caps the WHOLE environment at 4 KB,
// and the other keys (Azure/DeepSeek/…) already use ~0.6 KB, so a roster above
// ~2.5 KB must travel compressed.
const SAFE_PLAIN_LIMIT = 2500;
const usePlain = compact.length <= SAFE_PLAIN_LIMIT && compact.length <= NETLIFY_API_LIMIT;
const value = usePlain ? compact : gzipped;

// Diagnostics go to stderr so stdout stays pipeable.
console.error(`roster-env: ${count} participant(s) from ${file}`);
console.error(`roster-env: compact JSON ${compact.length} chars · gzip+base64 ${gzipped.length} chars`);
console.error(`roster-env: using ${usePlain ? 'plain JSON' : 'gzip+base64 (Lambda 4 KB env budget)'} — ${value.length} chars`);
console.error('roster-env: set it with');
console.error('  npx netlify env:set STUDENT_ROSTER_JSON "$(node scripts/roster-env.mjs)" --secret --force --context production');

process.stdout.write(value);
