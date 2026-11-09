#!/usr/bin/env node
/**
 * Offline vowel-alignment check: no server, no API keys.
 *   node scripts/vowel-check.mjs
 *
 * Loads the browser annotator (public/js/vowels.js) plus the lexical lexicon
 * (src/wordPhonemes.js) and asserts that every authored word -> vowel alignment
 * survives the grapheme/offset mapping and is playable through POST /api/tts.
 * The headline case is Vowel Practice on "Houston" ("ou" -> /juː/, not /aʊ/).
 */

import { readFile } from 'node:fs/promises';
import phonemeModule from '../src/wordPhonemes.js';
import libraryModule from '../src/scenarios.js';
import ttsModule from '../src/azureTts.js';

const { WORD_VOWELS, vowelAlignments, vowelLexicon } = phonemeModule;
const { SENTENCES } = libraryModule;
const { isSafePhoneme } = ttsModule;

const annotatorUrl = new URL('../public/js/vowels.js', import.meta.url);
const source = await readFile(annotatorUrl, 'utf8');
const annotator = await import(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`);
const { annotateWord, annotateSentence, setVowelLexicon } = annotator;

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'with', 'of', 'to', 'in', 'on', 'at', 'for',
  'from', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
  'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their', 'i', 'you', 'he', 'she',
  'we', 'they', 'me', 'him', 'us', 'them', 'as', 'so', 'if', 'do', 'does', 'did', 'can',
  'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must', 'not', 'no',
  'yes', 'what', 'how', 'why', 'when', 'who', 'up', 'out', 'just'
]);

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

const installed = setVowelLexicon(vowelLexicon());
check('lexicon installed in the annotator', installed === Object.keys(WORD_VOWELS).length,
  `${installed} entries`);

/* 1. Every authored entry resolves to the exact graphemes/IPA it declares. */
const broken = [];
Object.entries(WORD_VOWELS).forEach(([word, pairs]) => {
  const annotated = annotateWord(word);
  if (FUNCTION_WORDS.has(word)) {
    if (annotated.length) broken.push(`${word}: function word should stay unhighlighted`);
    return;
  }
  const actual = annotated.map((vowel) => [vowel.grapheme.toLowerCase(), vowel.ipa]);
  const expected = pairs.slice(0, 2).map(([grapheme, ipa]) => [grapheme.toLowerCase(), ipa]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    broken.push(`${word}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
});
check('every lexicon entry round-trips through the annotator', broken.length === 0,
  broken.slice(0, 6).join(' | ') || `${Object.keys(WORD_VOWELS).length} words`);

/* 2. Houston: the reported bug. */
const houston = annotateWord('Houston');
const ou = houston.find((vowel) => vowel.grapheme.toLowerCase() === 'ou');
check('Houston "ou" is /juː/ (not the /aʊ/ of "sound")', Boolean(ou) && ou.ipa === 'juː',
  JSON.stringify(houston.map((v) => `${v.grapheme}->/${v.ipa}/`)));
check('Houston "ou" carries the source word for SSML', Boolean(ou) && ou.word === 'Houston', ou && ou.word);
check('Houston "ou" offset points at the clicked grapheme', Boolean(ou) && 'Houston'.slice(ou.start, ou.end) === 'ou',
  ou && `${ou.start}-${ou.end}`);
check('the /juː/ phone is accepted by POST /api/tts', Boolean(ou) && isSafePhoneme(ou.ipa), ou && ou.ipa);

const houstonSentence = SENTENCES.find((sentence) => sentence.text.includes('Houston'));
const houstonTokens = annotateSentence(houstonSentence.text, { words: houstonSentence.wordVowels });
const houstonToken = houstonTokens.find((token) => token.type === 'word' && /Houston/.test(token.text));
check('sentence annotation exposes the clickable "ou" button',
  Boolean(houstonToken) && houstonToken.vowels.some((v) => v.grapheme === 'ou' && v.ipa === 'juː'),
  houstonToken && houstonToken.vowels.map((v) => `${v.grapheme}->/${v.ipa}/`).join(' '));

check('latte uses /ɑː/ (not /æ/)', annotateWord('latte')[0].ipa === 'ɑː', annotateWord('latte')[0].ipa);
check('receipt uses /iː/ (silent p)', annotateWord('receipt')[0].ipa === 'iː', annotateWord('receipt')[0].ipa);

/* 3. Every target sentence keeps the alignment for the irregular words it uses. */
const sentenceIssues = [];
SENTENCES.forEach((sentence) => {
  const expectedMap = vowelAlignments(sentence.text);
  const actual = annotateSentence(sentence.text, { words: sentence.wordVowels });
  Object.entries(expectedMap).forEach(([word, pairs]) => {
    const token = actual.find((entry) => entry.type === 'word'
      && entry.text.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '').toLowerCase() === word);
    if (!token) {
      sentenceIssues.push(`${sentence.id}: no token for "${word}"`);
      return;
    }
    const got = token.vowels.map((vowel) => [vowel.grapheme.toLowerCase(), vowel.ipa]);
    const want = pairs.map(([grapheme, ipa]) => [grapheme.toLowerCase(), ipa]);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      sentenceIssues.push(`${sentence.id}: "${word}" expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  });
});
check('all target sentences keep their authored vowel alignments', sentenceIssues.length === 0,
  sentenceIssues.slice(0, 6).join(' | ') || `${SENTENCES.length} targets`);

/* 4. Every IPA string handed to the TTS proxy is safe for SSML. */
const unsafe = [...new Set(
  SENTENCES.flatMap((sentence) => annotateSentence(sentence.text, { words: sentence.wordVowels }))
    .flatMap((token) => (token.vowels || []).map((vowel) => vowel.ipa))
)].filter((ipa) => !isSafePhoneme(ipa));
check('all annotated IPA phones pass the /api/tts guard', unsafe.length === 0, unsafe.join(', '));

/* 5. The render loop (text node + <button> per vowel) must rebuild the sentence
 *    exactly - this catches overlapping or out-of-range vowel offsets. */
function rebuild(tokens) {
  return tokens.map((token) => {
    if (token.type !== 'word' || !token.vowels.length) return token.text;
    let out = '';
    let cursor = 0;
    token.vowels.forEach((vowel) => {
      out += token.text.slice(cursor, vowel.start);
      out += token.text.slice(vowel.start, vowel.end);
      cursor = vowel.end;
    });
    return out + token.text.slice(cursor);
  }).join('');
}

const renderIssues = SENTENCES
  .map((sentence) => ({ sentence, rebuilt: rebuild(annotateSentence(sentence.text, { words: sentence.wordVowels })) }))
  .filter(({ sentence, rebuilt }) => rebuilt !== sentence.text)
  .map(({ sentence, rebuilt }) => `${sentence.id}: "${sentence.text}" -> "${rebuilt}"`);
check('vowel buttons rebuild every target sentence unchanged', renderIssues.length === 0,
  renderIssues.slice(0, 4).join(' | ') || `${SENTENCES.length} targets`);

const totalVowels = SENTENCES
  .flatMap((sentence) => annotateSentence(sentence.text, { words: sentence.wordVowels }))
  .reduce((sum, token) => sum + (token.vowels ? token.vowels.length : 0), 0);

console.log(failures ? `\n${failures} check(s) failed.` : `\nAll vowel checks passed (${totalVowels} tappable vowels).`);
process.exit(failures ? 1 : 0);

