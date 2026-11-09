/**
 * Vowel annotator for "Vowel Practice" mode.
 *
 * Alignment order (first hit wins):
 *   1. per-sentence map      - `annotateSentence(text, { words })`, i.e. the
 *                              target's `wordVowels` (homograph-safe)
 *   2. lexical lexicon       - `setVowelLexicon()`, shipped by GET /api/scenarios
 *                              from src/wordPhonemes.js (Houston -> /juː/, ...)
 *   3. OFFLINE_OVERRIDES     - small mirror used when the API is unreachable
 *   4. grapheme rules        - a teaching guess for regular spellings
 *
 * Only the first two vowel nuclei of each content word are highlighted, so the
 * model sentence reads like "m(e)d(i)um l(a)tt(e) with (oa)t m(i)lk". Every
 * vowel keeps its `word` so the caller can send SSML such as
 * `<phoneme alphabet="ipa" ph="juː">Houston</phoneme>` to POST /api/tts.
 */

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'with', 'of', 'to', 'in', 'on', 'at', 'for',
  'from', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
  'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their', 'i', 'you', 'he', 'she',
  'we', 'they', 'me', 'him', 'us', 'them', 'as', 'so', 'if', 'do', 'does', 'did', 'can',
  'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must', 'not', 'no',
  'yes', 'what', 'how', 'why', 'when', 'who', 'up', 'out', 'just'
]);

const DIGRAPHS = {
  eigh: 'eɪ', igh: 'aɪ', ough: 'ɔː', augh: 'ɔː', eau: 'juː',
  ee: 'iː', ea: 'iː', ie: 'aɪ', ei: 'eɪ', ey: 'eɪ',
  ai: 'eɪ', ay: 'eɪ', oa: 'oʊ', oe: 'oʊ', oo: 'uː',
  ou: 'aʊ', ow: 'aʊ', oi: 'ɔɪ', oy: 'ɔɪ', au: 'ɔː', aw: 'ɔː',
  ue: 'uː', ew: 'uː', ui: 'uː'
};

const SHORT = { a: 'æ', e: 'ɛ', i: 'ɪ', o: 'ɑ', u: 'ʌ', y: 'ɪ' };
const LONG = { a: 'eɪ', e: 'iː', i: 'aɪ', o: 'oʊ', u: 'uː', y: 'aɪ' };

// Irregular spellings that the grapheme rules would get wrong. This is the
// OFFLINE mirror: the server ships the wider, authoritative table through
// GET /api/scenarios -> `vowels` and `setVowelLexicon()` replaces it.
// (Kept in sync with src/wordPhonemes.js for the bundled fallback sentences.)
const OFFLINE_OVERRIDES = {
  latte: [['a', 'ɑː'], ['e', 'eɪ']],
  medium: [['e', 'iː'], ['i', 'i']],
  coffee: [['o', 'ɔː'], ['ee', 'iː']],
  receipt: [['ei', 'iː']],
  people: [['eo', 'iː']],
  said: [['ai', 'ɛ']],
  says: [['ay', 'ɛ']],
  again: [['ai', 'ɛ']],
  friend: [['ie', 'ɛ']],
  water: [['a', 'ɔː']],
  want: [['a', 'ɑ']],
  what: [['a', 'ʌ']],
  come: [['o', 'ʌ']],
  some: [['o', 'ʌ']],
  love: [['o', 'ʌ']],
  done: [['o', 'ʌ']],
  one: [['o', 'wʌ']],
  busy: [['u', 'ɪ']],
  minute: [['i', 'ɪ'], ['u', 'ɪ']],
  beautiful: [['eau', 'juː'], ['i', 'ɪ']],
  chocolate: [['o', 'ɑ'], ['o', 'ə']],
  boarding: [['oa', 'ɔː']],
  sure: [['u', 'ʊ']],
  who: [['o', 'uː']],
  move: [['o', 'uː']],
  movie: [['o', 'uː'], ['ie', 'i']],
  recipe: [['e', 'ɛ'], ['i', 'i']],
  address: [['a', 'æ'], ['e', 'ɛ']],
  answer: [['a', 'æ'], ['er', 'ər']],
  women: [['o', 'ɪ'], ['e', 'ɪ']],
  schedule: [['e', 'ɛ'], ['u', 'uː']],
  suitcase: [['u', 'uː'], ['a', 'eɪ']],
  language: [['a', 'æ'], ['ua', 'wɪ']],
  give: [['i', 'ɪ']],
  live: [['i', 'ɪ']],
  have: [['a', 'æ']],
  none: [['o', 'ʌ']],
  gone: [['o', 'ɔː']],
  where: [['e', 'eər']],
  there: [['e', 'eər']],
  here: [['e', 'ɪər']],
  baggage: [['a', 'æ'], ['a', 'ɪ']],
  luggage: [['u', 'ʌ'], ['a', 'ɪ']],
  message: [['e', 'ɛ'], ['a', 'ɪ']]
};

const VOWEL_RUN = /[aeiouy]+/g;

/** Server-provided lexicon: lowercase word -> [{grapheme, ipa}, ...]. */
let LEXICON = new Map();

function isVowelLetter(char) {
  return char !== undefined && /[aeiouy]/.test(char);
}

function normalizeWord(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

/** Accepts [["ou", "juː"]], [{grapheme, ipa}] or a mix of both. */
function toPairs(pairs) {
  if (!Array.isArray(pairs)) return [];
  return pairs.map((entry) => {
    if (Array.isArray(entry)) return { grapheme: String(entry[0] || ''), ipa: String(entry[1] || '') };
    if (entry && typeof entry === 'object') {
      return { grapheme: String(entry.grapheme || ''), ipa: String(entry.ipa || '') };
    }
    return null;
  }).filter((entry) => entry && entry.grapheme && entry.ipa);
}

/**
 * Installs the lexical pronunciation table shipped by the server
 * (`GET /api/scenarios -> vowels`). Called once per library load.
 * @param {Object<string, Array>} map
 * @returns {number} number of usable entries
 */
export function setVowelLexicon(map) {
  LEXICON = new Map();
  if (!map || typeof map !== 'object') return 0;
  Object.entries(map).forEach(([word, pairs]) => {
    const key = normalizeWord(word);
    const list = toPairs(pairs);
    if (key && list.length) LEXICON.set(key, list);
  });
  return LEXICON.size;
}

/** Simple inflections tolerated by the override tables ("movies" -> "movie"). */
function inflections(lower) {
  return [
    lower.replace(/s$/, ''),
    lower.replace(/es$/, ''),
    lower.replace(/ies$/, 'y'),
    lower.replace(/ed$/, ''),
    lower.replace(/ing$/, ''),
    lower.replace(/d$/, '')
  ].filter((candidate) => candidate && candidate !== lower);
}

/** Reads one entry from a Map (lexicon) or a plain object (overrides). */
function readEntry(source, key) {
  if (!source) return null;
  const value = source instanceof Map ? source.get(key) : source[key];
  if (!value) return null;
  const pairs = source instanceof Map ? value : toPairs(value);
  return pairs && pairs.length ? pairs : null;
}

/** Looks up a word, tolerating simple inflections. */
function lookup(source, lower) {
  const direct = readEntry(source, lower);
  if (direct) return direct;
  for (const candidate of inflections(lower)) {
    const hit = readEntry(source, candidate);
    if (hit) return hit;
  }
  return null;
}

/**
 * Turns `[[grapheme, ipa], ...]` into annotated nuclei. Matches are searched
 * from the end of the previous grapheme so overlapping spellings cannot collide
 * ("Houston" -> "ou" at 1, then the final "o" at 5, not the "o" inside "ou").
 */
function alignPairs(raw, lower, pairs, source) {
  const out = [];
  let cursor = 0;
  pairs.slice(0, 2).forEach(({ grapheme, ipa }) => {
    const needle = grapheme.toLowerCase();
    let at = lower.indexOf(needle, cursor);
    if (at < 0) at = lower.indexOf(needle);
    if (at < 0) return;
    out.push({
      grapheme: raw.slice(at, at + needle.length),
      ipa,
      start: at,
      end: at + needle.length,
      word: raw,
      source
    });
    cursor = at + needle.length;
  });
  return out.filter((entry) => entry.grapheme && entry.end <= raw.length);
}

/** IPA for a single vowel run, using the surrounding letters as context. */
function ipaForGroup(word, group, groupIndex, groupCount, finalSilent) {
  const { grapheme, start, end } = group;
  const key = grapheme.toLowerCase();
  const before = word[start - 1] || '';
  const after = word[end] || '';
  const rest = word.slice(end);

  // r-coloured vowels come first ("airport" is /eər/, not /eɪ/)
  if (after === 'r') {
    if (key === 'ai') return 'eər';
    if (key === 'a') return 'ɑːr';
    if (key === 'o') return 'ɔːr';
    if (key === 'ea' || key === 'ee') return 'ɪər';
    return 'ɜːr';
  }

  if (DIGRAPHS[key]) return DIGRAPHS[key];

  if (key === 'y') {
    return word.length <= 3 ? LONG.y : 'i';
  }

  // magic-e / open syllable -> long vowel
  if (finalSilent && groupIndex === groupCount - 2 && !isVowelLetter(before)) {
    return LONG[key[0]] || SHORT[key[0]];
  }
  if (end === word.length && !isVowelLetter(before)) {
    return LONG[key[0]] || SHORT[key[0]];
  }

  if (key === 'a' && rest.startsWith('ir')) return 'eər';
  if (key === 'o' && rest.startsWith('ld')) return 'oʊ';
  if (key === 'i' && rest.startsWith('nd')) return 'aɪ';
  if (key === 'i' && rest.startsWith('gn')) return 'aɪ';
  // "night", "light", "right": "gh" is not part of the vowel run.
  if (key === 'i' && rest.startsWith('gh')) return 'aɪ';
  // "saw", "draw", "law": -aw is always /ɔː/.
  if (key === 'a' && after === 'w') return 'ɔː';

  return SHORT[key[0]] || 'ə';
}

/**
 * True when the last vowel run is a silent `e` that makes the previous vowel
 * long ("time", "make"), including the plural/inflected `-e + s` form
 * ("times", "makes", "likes"). Syllabic `-es` ("boxes", "watches", "dresses")
 * is excluded: there the `e` is pronounced.
 */
function isSilentFinalE(word, last, groupCount) {
  if (last.grapheme !== 'e' || groupCount < 2 || word.length <= 3) return false;
  if (last.end === word.length) return true;
  if (last.end !== word.length - 1 || !word.endsWith('s')) return false;
  const base = word.slice(0, word.length - 2);
  const beforeE = word[word.length - 3] || '';
  if (/[sxz]$/.test(beforeE)) return false;
  if (/(ch|sh)$/.test(base)) return false;
  return true;
}

function findGroups(word) {
  const groups = [];
  VOWEL_RUN.lastIndex = 0;
  let match = VOWEL_RUN.exec(word);
  while (match) {
    groups.push({
      grapheme: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
    match = VOWEL_RUN.exec(word);
  }
  return groups;
}

/**
 * @param {string} word
 * @param {{words?:Object<string, Array>}} [options] per-sentence vowel map
 * @returns {Array<{grapheme:string, ipa:string, start:number, end:number,
 *   source:'sentence'|'lexicon'|'override'|'rule'}>}
 *   Up to two vowel nuclei, with offsets relative to the word.
 */
export function annotateWord(word, { words } = {}) {
  const raw = String(word || '');
  const lower = normalizeWord(raw);
  if (!lower) return [];
  // Apostrophes should not hide function words ("it's", "I'll").
  if (FUNCTION_WORDS.has(lower.replace(/'/g, ''))) return [];

  // 1-3: authored alignments (target sentence, lexical lexicon, offline mirror).
  const authored = lookup(words, lower);
  if (authored) return alignPairs(raw, lower, authored, 'sentence');

  const lexical = lookup(LEXICON, lower);
  if (lexical) return alignPairs(raw, lower, lexical, 'lexicon');

  const offline = lookup(OFFLINE_OVERRIDES, lower);
  if (offline) return alignPairs(raw, lower, offline, 'override');

  // 4: grapheme rules for regular spellings.
  const groups = findGroups(lower);
  if (!groups.length) return [];

  const last = groups[groups.length - 1];
  const finalSilent = isSilentFinalE(lower, last, groups.length);

  const nuclei = [];
  groups.forEach((group, index) => {
    if (finalSilent && index === groups.length - 1) return;
    nuclei.push({
      grapheme: raw.slice(group.start, group.end),
      ipa: ipaForGroup(lower, group, index, groups.length, finalSilent),
      start: group.start,
      end: group.end,
      word: raw,
      source: 'rule'
    });
  });

  return nuclei.slice(0, 2);
}

/**
 * Splits a sentence into renderable tokens.
 * @param {string} sentence
 * @param {{words?:Object<string, Array>}} [options] per-sentence vowel map
 *   (`scenarios[].wordVowels`); it wins over the global lexicon.
 * @returns {Array<{type:'text'|'word', text:string, vowels?:Array}>}
 */
export function annotateSentence(sentence, { words } = {}) {
  return String(sentence || '').split(/(\s+)/).filter(Boolean).map((chunk) => {
    if (/^\s+$/.test(chunk)) return { type: 'text', text: chunk };
    const cleaned = chunk.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
    const offset = chunk.indexOf(cleaned);
    if (!cleaned) return { type: 'text', text: chunk };
    const vowels = annotateWord(cleaned, { words }).map((vowel) => ({
      ...vowel,
      word: cleaned,
      start: vowel.start + offset,
      end: vowel.end + offset
    }));
    return { type: 'word', text: chunk, vowels };
  });
}
