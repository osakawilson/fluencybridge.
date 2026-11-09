#!/usr/bin/env node
/**
 * Generates the static practice bank served by the CDN: public/scenarios.json
 *   node scripts/build-scenarios.mjs
 *
 * Why this exists: the UI normally reads GET /api/scenarios (the Netlify
 * function wrapping Express). If that request ever fails — cold start, function
 * packaging error, expired access code, 502/504 — the browser must still show
 * the COMPLETE 276-target library instead of the 3-line offline stub in
 * public/js/app.js. Netlify serves `public/` straight from the CDN, so this
 * file is the always-available copy.
 *
 * The output mirrors the /api/scenarios payload (minus the duplicated
 * `sentences` alias) and is deterministic — no timestamps — so re-running the
 * build leaves the working tree clean unless the bank really changed.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import library from '../src/scenarios.js';
import phonemes from '../src/wordPhonemes.js';

const { DEFAULT_SCENARIO_ID, GROUPS, CATEGORIES, SENTENCES } = library;
const { vowelLexicon } = phonemes;

/** The verified size of the practice bank (README: "276 targets"). */
export const EXPECTED_TARGETS = 276;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'scenarios.json');

const payload = {
  default: DEFAULT_SCENARIO_ID,
  groups: GROUPS,
  categories: CATEGORIES,
  scenarios: SENTENCES,
  // word -> lexical vowel nuclei ([[grapheme, ipa], ...]) for Vowel Practice
  vowels: vowelLexicon()
};

if (SENTENCES.length !== EXPECTED_TARGETS) {
  console.error(`build-scenarios: refusing to publish a truncated bank — `
    + `${SENTENCES.length} target(s), expected ${EXPECTED_TARGETS}.`);
  process.exit(1);
}

const json = `${JSON.stringify(payload, null, 2)}\n`;
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, json, 'utf8');

console.log(`build-scenarios: wrote public/scenarios.json — ${SENTENCES.length} targets, `
  + `${CATEGORIES.length} categories, ${(json.length / 1024).toFixed(0)} kB.`);
