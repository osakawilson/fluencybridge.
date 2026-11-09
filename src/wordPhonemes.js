/**
 * Word -> vowel alignment lexicon ("true" lexical pronunciation).
 *
 * Vowel Practice must not guess IPA from spelling: "ou" is /aʊ/ in "sound" but
 * /juː/ in "Houston", and "a" is /eɪ/ in "baby" but /ɑː/ in "latte". This table
 * pins the vowel nuclei of irregular spellings, loanwords and proper nouns to
 * their dictionary pronunciation, so the sound played for a bolded vowel matches
 * the word the learner is actually looking at.
 *
 * Shape: { word: [[grapheme, ipa], ...] } - at most two nuclei, spelling order.
 * Keys are lowercase; punctuation is stripped before lookup. Lookup tolerates
 * simple inflections ("movies" -> "movie").
 *
 * Consumers:
 *   - GET /api/scenarios -> { vowels, scenarios[].wordVowels }
 *   - public/js/vowels.js (`setVowelLexicon`, `annotateSentence`)
 *
 * Entries are curated by hand from the practice library (src/scenarios.js and
 * src/practiceDataGenerations.js); regular spellings are left to the grapheme
 * rules in public/js/vowels.js on purpose so the teaching aid stays readable.
 */

const WORD_VOWELS = {
  /* ----------------- proper nouns & loanwords (library texts) ------------- */
  houston: [['ou', 'juː'], ['o', 'ə']],     // /ˈhjuːstən/ - NOT the "ou" of "sound"
  watson: [['a', 'ɑː'], ['o', 'ə']],        // /ˈwɑːtsən/
  casablanca: [['a', 'æ'], ['a', 'ə']],     // /ˌkæsəˈblæŋkə/
  osaka: [['o', 'oʊ'], ['a', 'ɑː']],        // /oʊˈsɑːkə/
  beatles: [['ea', 'iː']],                  // /ˈbiːtəlz/
  journey: [['our', 'ɜːr'], ['ey', 'i']],   // /ˈdʒɜːrni/
  nirvana: [['i', 'ɜːr'], ['a', 'ɑː']],     // /nɪrˈvɑːnə/
  eminem: [['e', 'ɛ'], ['i', 'ɪ']],         // /ˌɛmɪˈnɛm/
  britney: [['i', 'ɪ'], ['ey', 'i']],       // /ˈbrɪtni/
  spears: [['ea', 'ɪər']],                  // /spɪrz/
  titanic: [['i', 'aɪ'], ['a', 'æ']],       // /taɪˈtænɪk/
  avengers: [['a', 'ə'], ['e', 'ɛ']],       // /əˈvɛndʒərz/
  interstellar: [['i', 'ɪ'], ['e', 'ɛ']],   // /ˌɪntərˈstɛlər/
  encanto: [['e', 'ɛ'], ['a', 'ɑː']],       // /ɛnˈkɑːntoʊ/
  moana: [['oa', 'oʊ'], ['a', 'ɑː']],       // /moʊˈɑːnə/
  mario: [['a', 'ɑː'], ['i', 'i']],         // /ˈmɑːrioʊ/
  bruno: [['u', 'uː'], ['o', 'oʊ']],        // /ˈbruːnoʊ/
  rodrigo: [['o', 'ə'], ['i', 'iː']],       // /rəˈdriːɡoʊ/
  eilish: [['ei', 'aɪ'], ['i', 'ɪ']],       // /ˈaɪlɪʃ/
  taylor: [['ay', 'eɪ'], ['o', 'ər']],      // /ˈteɪlər/
  iron: [['i', 'aɪ'], ['o', 'ər']],         // /ˈaɪərn/
  mandalorian: [['a', 'æ'], ['o', 'ɔː']],   // /ˌmændəˈlɔːriən/
  mamma: [['a', 'ɑː'], ['a', 'ə']],         // /ˈmɑːmə/
  wifi: [['i', 'aɪ'], ['i', 'aɪ']],         // /ˈwaɪfaɪ/

  /* ----------------- irregular spellings (core teaching set) -------------- */
  latte: [['a', 'ɑː'], ['e', 'eɪ']],        // /ˈlɑːteɪ/
  medium: [['e', 'iː'], ['i', 'i']],        // /ˈmiːdiəm/
  coffee: [['o', 'ɔː'], ['ee', 'iː']],      // /ˈkɔːfi/
  receipt: [['ei', 'iː']],                  // /rɪˈsiːt/
  people: [['eo', 'iː']],                   // /ˈpiːpəl/
  said: [['ai', 'ɛ']],
  says: [['ay', 'ɛ']],
  again: [['ai', 'ɛ']],                     // /əˈɡɛn/
  friend: [['ie', 'ɛ']],
  water: [['a', 'ɔː']],                     // /ˈwɔːtər/
  want: [['a', 'ɑ']],
  come: [['o', 'ʌ']],
  some: [['o', 'ʌ']],
  love: [['o', 'ʌ']],
  done: [['o', 'ʌ']],
  none: [['o', 'ʌ']],
  gone: [['o', 'ɔː']],
  one: [['o', 'wʌ']],
  busy: [['u', 'ɪ']],                       // /ˈbɪzi/
  minute: [['i', 'ɪ'], ['u', 'ɪ']],         // /ˈmɪnɪt/
  beautiful: [['eau', 'juː'], ['i', 'ɪ']],  // /ˈbjuːtɪfəl/
  chocolate: [['o', 'ɑ'], ['o', 'ə']],      // /ˈtʃɑːklət/
  boarding: [['oa', 'ɔː']],
  sure: [['u', 'ʊ']],
  move: [['o', 'uː']],
  movie: [['o', 'uː'], ['ie', 'i']],
  recipe: [['e', 'ɛ'], ['i', 'i']],         // /ˈrɛsəpi/
  address: [['a', 'æ'], ['e', 'ɛ']],
  answer: [['a', 'æ'], ['er', 'ər']],
  women: [['o', 'ɪ'], ['e', 'ɪ']],
  schedule: [['e', 'ɛ'], ['u', 'uː']],      // /ˈskɛdʒuːl/
  suitcase: [['u', 'uː'], ['a', 'eɪ']],
  language: [['a', 'æ'], ['ua', 'wɪ']],
  give: [['i', 'ɪ']],
  live: [['i', 'ɪ']],
  have: [['a', 'æ']],
  where: [['e', 'eər']],
  there: [['e', 'eər']],
  here: [['e', 'ɪər']],
  baggage: [['a', 'æ'], ['a', 'ɪ']],
  luggage: [['u', 'ʌ'], ['a', 'ɪ']],
  message: [['e', 'ɛ'], ['a', 'ɪ']],


  /* ------------------- scenario library: leftover offenders -------------- */
  steak: [['ea', 'eɪ']],                    // /steɪk/
  bread: [['ea', 'ɛ']],
  sweater: [['ea', 'ɛ']],                   // /ˈswɛtər/
  breath: [['ea', 'ɛ']],
  dead: [['ea', 'ɛ']],
  headache: [['ea', 'ɛ'], ['a', 'eɪ']],     // /ˈhɛdeɪk/
  breakfast: [['ea', 'ɛ'], ['a', 'ə']],     // /ˈbrɛkfəst/
  sugar: [['u', 'ʊ'], ['a', 'ər']],         // /ˈʃʊɡər/
  soup: [['ou', 'uː']],                     // /suːp/
  double: [['ou', 'ʌ'], ['e', 'ə']],        // /ˈdʌbəl/
  book: [['oo', 'ʊ']],                      // /bʊk/
  return: [['e', 'ɪ'], ['u', 'ɜːr']],       // /rɪˈtɜːrn/
  vegetarian: [['e', 'ɛ'], ['a', 'eər']],   // /ˌvɛdʒəˈteəriən/
  reservation: [['e', 'ɛ'], ['a', 'eɪ']],   // /ˌrɛzərˈveɪʃən/
  allergic: [['a', 'ə'], ['e', 'ɜːr']],     // /əˈlɜːrdʒɪk/
  pharmacy: [['a', 'ɑːr'], ['a', 'ə']],     // /ˈfɑːrməsi/
  medicine: [['e', 'ɛ'], ['i', 'ɪ']],       // /ˈmɛdɪsɪn/
  prescription: [['e', 'ɪ'], ['i', 'ɪ']],   // /prɪˈskrɪpʃən/
  fever: [['e', 'iː'], ['e', 'ər']],        // /ˈfiːvər/
  security: [['e', 'ɪ'], ['u', 'ʊ']],       // /sɪˈkjʊrəti/
  terminal: [['e', 'ɜːr'], ['i', 'ɪ']],     // /ˈtɜːrmɪnəl/
  timetable: [['i', 'aɪ'], ['a', 'eɪ']],    // /ˈtaɪmteɪbəl/
  students: [['u', 'uː'], ['e', 'ə']],      // /ˈstuːdənts/
  "o'clock": [['o', 'ə'], ['o', 'ɑ']],      // /əˈklɑk/

  /* --------------------- movie / song library leftovers ------------------ */
  elementary: [['e', 'ɛ'], ['a', 'ə']],     // /ˌɛlɪˈmɛntəri/
  serious: [['e', 'ɪər'], ['i', 'i']],      // /ˈsɪəriəs/
  "believin'": [['ie', 'iː'], ['i', 'ɪ']],  // /bɪˈliːvɪn/
  "feelin'": [['ee', 'iː'], ['i', 'ɪ']],
  wonderful: [['o', 'ʌ'], ['e', 'ər']],     // /ˈwʌndərfəl/
  yellow: [['e', 'ɛ'], ['ow', 'oʊ']],       // /ˈjɛloʊ/
  wind: [['i', 'ɪ']],                       // noun "the wind" - NOT /waɪnd/

  /* --------------------- generational library leftovers ------------------ */
  alive: [['a', 'ə'], ['i', 'aɪ']],         // /əˈlaɪv/
  fantasy: [['a', 'æ'], ['a', 'ə']],        // /ˈfæntəsi/
  lose: [['o', 'uː']],                      // /luːz/
  yourself: [['you', 'ʊ'], ['e', 'ɛ']],     // /jʊrˈsɛlf/
  moment: [['o', 'oʊ'], ['e', 'ə']],        // /ˈmoʊmənt/
  gonna: [['o', 'ʌ'], ['a', 'ə']],          // /ˈɡʌnə/
  baby: [['a', 'eɪ'], ['y', 'i']],          // /ˈbeɪbi/
  snowman: [['ow', 'oʊ'], ['a', 'ə']],      // /ˈsnoʊmæn/
  precious: [['e', 'ɛ'], ['ou', 'ə']],      // /ˈprɛʃəs/
  inevitable: [['i', 'ɪ'], ['e', 'ɛ']],     // /ɪnˈɛvɪtəbəl/
  dangerous: [['a', 'eɪ'], ['ou', 'ə']],    // /ˈdeɪndʒərəs/
  truth: [['u', 'uː']],                     // /truːθ/
  heart: [['ear', 'ɑːr']],                  // /hɑːrt/ - NOT the "ea" of "heat"
  anyone: [['a', 'ɛ'], ['o', 'ʌ']],         // /ˈɛniwʌn/
  miracle: [['i', 'ɪ'], ['a', 'ə']],        // /ˈmɪrəkəl/
  waiting: [['ai', 'eɪ'], ['i', 'ɪ']],      // /ˈweɪtɪŋ/

  /* --------------- high-frequency words the rules get wrong --------------- */
  all: [['a', 'ɔː']],                       // /ɔːl/
  also: [['a', 'ɔː'], ['o', 'oʊ']],         // /ˈɔːlsoʊ/
  always: [['a', 'ɔː'], ['ay', 'eɪ']],      // /ˈɔːlweɪz/
  call: [['a', 'ɔː']],
  small: [['a', 'ɔː']],
  walk: [['a', 'ɔː']],
  talk: [['a', 'ɔː']],
  long: [['o', 'ɔː']],                      // /lɔːŋ/
  good: [['oo', 'ʊ']],                      // /ɡʊd/
  look: [['oo', 'ʊ']],                      // /lʊk/
  know: [['o', 'oʊ']],                      // silent k, /noʊ/
  known: [['o', 'oʊ']],
  now: [['o', 'aʊ']],                       // "-ow" after the vowel run
  town: [['o', 'aʊ']],
  down: [['o', 'aʊ']],
  window: [['i', 'ɪ'], ['o', 'oʊ']],
  tomorrow: [['o', 'ə'], ['ow', 'oʊ']],
  towel: [['o', 'aʊ'], ['e', 'ə']],         // /ˈtaʊəl/
  floor: [['oo', 'ɔːr']],                   // /flɔːr/
  music: [['u', 'uː'], ['i', 'ɪ']],         // /ˈmjuːzɪk/
  any: [['a', 'ɛ'], ['y', 'i']],            // /ˈɛni/
  many: [['a', 'ɛ'], ['y', 'i']],
  every: [['e', 'ɛ'], ['y', 'i']],
  only: [['o', 'oʊ'], ['y', 'i']],          // /ˈoʊnli/
  giant: [['ia', 'aɪ']],                    // /ˈdʒaɪənt/
  usual: [['u', 'juː'], ['u', 'ə']],        // /ˈjuːʒuəl/
  brutal: [['u', 'uː'], ['a', 'ə']],        // /ˈbruːtəl/
  build: [['ui', 'ɪ']],                     // /bɪld/
  two: [['o', 'uː']],                       // /tuː/
  since: [['i', 'ɪ']],                      // magic-e must not fire: /sɪns/
  machine: [['a', 'ə'], ['i', 'iː']],       // /məˈʃiːn/
  shoes: [['oe', 'uː']],                    // /ʃuːz/
  because: [['e', 'ɪ'], ['au', 'ɔː']],      // /bɪˈkɔːz/
  enough: [['e', 'ɪ'], ['ou', 'ʌ']],        // /ɪˈnʌf/
  cough: [['ou', 'ɔː']],                    // /kɔːf/
  away: [['a', 'ə'], ['ay', 'eɪ']],         // /əˈweɪ/
  beyond: [['e', 'ɪ'], ['o', 'ɑ']],         // /bɪˈjɑnd/
  about: [['a', 'ə'], ['ou', 'aʊ']],        // /əˈbaʊt/
  arrive: [['a', 'ə'], ['i', 'aɪ']],        // /əˈraɪv/
  appointment: [['a', 'ə'], ['oi', 'ɔɪ']],  // /əˈpɔɪntmənt/
  station: [['a', 'eɪ'], ['io', 'ə']],      // /ˈsteɪʃən/
  taken: [['a', 'eɪ'], ['e', 'ə']],         // /ˈteɪkən/
  taxi: [['a', 'æ'], ['i', 'i']],           // /ˈtæksi/
  center: [['e', 'ɛ'], ['e', 'ər']],        // /ˈsɛntər/
  yesterday: [['e', 'ɛ'], ['a', 'eɪ']],     // /ˈjɛstərdeɪ/
  gentle: [['e', 'ɛ']],                     // /ˈdʒɛntəl/
  shuttle: [['u', 'ʌ'], ['e', 'ə']],        // /ˈʃʌtəl/
  ribbon: [['i', 'ɪ'], ['o', 'ə']],         // /ˈrɪbən/
  someday: [['o', 'ʌ'], ['e', 'eɪ']],       // /ˈsʌmdeɪ/
  wear: [['ea', 'eər']],                    // /wɛr/ - NOT the "ea" of "eat"
  wednesday: [['e', 'ɛ'], ['ay', 'eɪ']],    // /ˈwɛnzdeɪ/
  ole: [['o', 'oʊ']],                       // "the ole oak tree"
  roxanne: [['o', 'ɑː'], ['a', 'æ']],       // /rɑːkˈsæn/
  royale: [['oy', 'ɔɪ'], ['a', 'eɪ']],      // /rɔɪˈæl/
  hasta: [['a', 'ɑː'], ['a', 'ə']],         // /ˈhɑːstə/
  vista: [['i', 'ɪ'], ['a', 'ə']],          // /ˈvɪstə/
  la: [['a', 'ɑː']],                        // "la vista"
  mia: [['ia', 'iːə']],                     // /ˈmiːə/
  's.o.s': [['o', 'oʊ']],                   // letters, read as /oʊ/
  guy: [['uy', 'aɪ']],                      // /ɡaɪ/
  buy: [['uy', 'aɪ']],                      // /baɪ/

  /* ------------------- contractions (apostrophes kept) ------------------- */
  "don't": [['o', 'oʊ']],
  "won't": [['o', 'oʊ']],
  "i'm": [['i', 'aɪ']],
  "i'll": [['i', 'aɪ']],
  "i've": [['i', 'aɪ']],
  "you're": [['you', 'ʊ']],                 // /jʊr/
  "here's": [['e', 'ɪər']],                 // /hɪrz/
  "there's": [['e', 'eər']],                // /ðɛrz/
  "it's-a": [['i', 'ɪ'], ['a', 'ə']],       // "It's-a me, Mario!"
  "a-changin'": [['a', 'ə'], ['a', 'eɪ']],  // /əˈtʃeɪndʒɪn/
  "blowin'": [['o', 'oʊ'], ['i', 'ɪ']],     // /ˈbloʊɪn/
  "'cause": [['au', 'ʌ']]                   // /kʌz/
};

/** Lowercase + normalise curly apostrophes so "Believin’" matches "believin'". */
function normalizeWord(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

/** Strips the punctuation the annotator keeps around tokens ("Houston,"). */
function cleanToken(token) {
  return String(token || '').replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
}

/** Simple inflections the lexicon tolerates ("movies" -> "movie"). */
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

/**
 * @param {string} word
 * @returns {Array<[string, string]>|null} vowel alignments, or null when the
 *   word is regular enough for the grapheme rules.
 */
function getWordVowels(word) {
  const lower = normalizeWord(cleanToken(word));
  if (!lower) return null;
  if (WORD_VOWELS[lower]) return WORD_VOWELS[lower];
  for (const candidate of inflections(lower)) {
    if (WORD_VOWELS[candidate]) return WORD_VOWELS[candidate];
  }
  return null;
}

/** Plain-object copy for `GET /api/scenarios -> vowels`. */
function vowelLexicon() {
  return Object.fromEntries(
    Object.entries(WORD_VOWELS).map(([word, pairs]) => [word, pairs.map(([grapheme, ipa]) => [grapheme, ipa])])
  );
}

/**
 * Per-sentence alignment map: only the words of `text` that the lexicon knows,
 * plus optional hand-written overrides (for homographs such as live /lɪv/ vs
 * live /laɪv/). Shipped as `scenarios[].wordVowels`, so the UI can align a
 * target sentence from the sentence itself.
 *
 * @param {string} text
 * @param {Object<string, Array<[string, string]>>} [extra]
 */
function vowelAlignments(text, extra = null) {
  const out = {};
  if (extra && typeof extra === 'object') {
    Object.entries(extra).forEach(([word, pairs]) => {
      const key = normalizeWord(word);
      if (!key || !Array.isArray(pairs) || !pairs.length) return;
      out[key] = pairs.map((pair) => (Array.isArray(pair) ? [pair[0], pair[1]] : [pair.grapheme, pair.ipa]));
    });
  }

  const seen = new Set();
  String(text || '').split(/\s+/).forEach((token) => {
    const key = normalizeWord(cleanToken(token));
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (out[key]) return; // explicit per-sentence override wins
    const pairs = getWordVowels(key);
    if (!pairs) return;
    out[key] = pairs.map(([grapheme, ipa]) => [grapheme, ipa]);
  });
  return out;
}

module.exports = {
  WORD_VOWELS,
  getWordVowels,
  vowelLexicon,
  vowelAlignments
};


