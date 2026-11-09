/**
 * Deterministic mock providers.
 *
 * Purpose: the PoC must run end-to-end with `npm install && npm start` even
 * before Azure / DeepSeek keys exist (and for $0 classroom demos). Every mock
 * response is tagged `source: 'mock'` and the UI shows a loud MOCK badge, so
 * mock data can never be mistaken for live research data.
 */

const { getScenario } = require('./scenarios');

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 - small seeded PRNG so repeat runs are reproducible. */
function seeded(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A deliberately crude grapheme -> pseudo-IPA table. Mock only! */
const RULES = [
  ['tion', ['sh', 'ah', 'n']], ['ough', ['ao']], ['th', ['th']], ['sh', ['sh']],
  ['ch', ['ch']], ['ph', ['f']], ['ck', ['k']], ['ng', ['ng']], ['qu', ['k', 'w']],
  ['oo', ['uw']], ['ee', ['iy']], ['ea', ['iy']], ['ai', ['ey']], ['ay', ['ey']],
  ['ou', ['aw']], ['ow', ['ow']], ['oa', ['ow']], ['ir', ['er']], ['er', ['er']],
  ['ar', ['aa', 'r']], ['or', ['ao', 'r']], ['a', ['ae']], ['e', ['eh']], ['i', ['ih']],
  ['o', ['aa']], ['u', ['ah']], ['y', ['iy']], ['b', ['b']], ['c', ['k']], ['d', ['d']],
  ['f', ['f']], ['g', ['g']], ['h', ['hh']], ['j', ['jh']], ['k', ['k']], ['l', ['l']],
  ['m', ['m']], ['n', ['n']], ['p', ['p']], ['r', ['r']], ['s', ['s']], ['t', ['t']],
  ['v', ['v']], ['w', ['w']], ['x', ['k', 's']], ['z', ['z']]
];

function pseudoPhonemes(word) {
  const lower = String(word || '').toLowerCase();
  const out = [];
  let i = 0;
  while (i < lower.length) {
    let matched = false;
    for (let len = 4; len >= 2; len -= 1) {
      const slice = lower.slice(i, i + len);
      const rule = RULES.find((r) => r[0] === slice);
      if (rule) {
        out.push(...rule[1]);
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const single = RULES.find((r) => r[0] === lower[i]);
    if (single) out.push(...single[1]);
    i += 1;
  }
  return out.length ? out : [lower.slice(0, 2) || 'ah'];
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

function mockAssessment({ scenarioId, referenceText, audioDurationMs, language }) {
  const scenario = getScenario(scenarioId);
  const scripted = Boolean(referenceText && referenceText.trim());
  const sentence = (scripted ? referenceText : scenario.sampleUtterance).trim();
  const tokens = sentence.replace(/[.,!?;:]/g, '').split(/\s+/).filter(Boolean);
  const rnd = seeded(hashString(sentence + (language || 'en-US')));
  const durationMs = audioDurationMs > 0 ? audioDurationMs : 1800 + tokens.length * 320;

  let cursor = 0;
  const words = tokens.map((token, index) => {
    // A realistic spread: mostly 80+, some 60s, a couple below 60.
    const roll = rnd();
    let score;
    if (roll > 0.82) score = 52 + rnd() * 7;
    else if (roll > 0.6) score = 62 + rnd() * 16;
    else score = 82 + rnd() * 16;
    const phonemeScore = clamp(score + (rnd() - 0.5) * 12);
    const phonemeNames = pseudoPhonemes(token);
    const slice = Math.max(40, Math.round(((durationMs / tokens.length) * (0.7 + rnd() * 0.5)) / (phonemeNames.length || 1)));
    const phonemes = phonemeNames.map((p, pi) => ({
      phoneme: p,
      accuracy_score: clamp(phonemeScore + (pi % 2 === 0 ? 3 : -6) + (rnd() - 0.5) * 8),
      offset_ms: Math.round(cursor + pi * slice),
      duration_ms: Math.round(slice)
    }));
    const errorType = score < 65 ? 'Mispronunciation' : 'None';
    cursor += Math.round(durationMs / tokens.length);
    return {
      word: token,
      accuracy_score: clamp(score),
      error_type: errorType,
      offset_ms: Math.round((index * durationMs) / tokens.length),
      duration_ms: Math.round(durationMs / tokens.length),
      phonemes
    };
  });

  const accuracy = clamp(mean(words.map((w) => w.accuracy_score)));
  // Typical A2 read-aloud rate is ~1.5-2.5 words/second.
  const speechRate = tokens.length / Math.max(1, durationMs / 1000);
  const fluency = clamp(54 + Math.min(speechRate, 2.6) * 16 + rnd() * 5);
  const completeness = scripted ? clamp(88 + rnd() * 12) : 100;
  const pron = clamp(accuracy * 0.6 + fluency * 0.25 + completeness * 0.15);

  return {
    ok: true,
    recognized_text: tokens.join(' ') + '.',
    accuracy_score: accuracy,
    calibrated_accuracy_score: accuracy,
    fluency_score: fluency,
    completeness_score: completeness,
    completeness_meaningful: scripted,
    pronunciation_score: pron,
    words,
    mode: scripted ? 'scripted' : 'unscripted',
    reference_text: scripted ? referenceText : '',
    audio_duration_ms: Math.round(durationMs),
    source: 'mock',
    provider: 'mock-azure',
    raw: {
      mock: true,
      note: 'Deterministic synthetic payload - AZURE_SPEECH_KEY is not configured.',
      NBest: [
        {
          Confidence: 0.92,
          Display: tokens.join(' ') + '.',
          PronunciationAssessment: {
            AccuracyScore: accuracy,
            FluencyScore: fluency,
            CompletenessScore: completeness,
            PronScore: pron
          },
          Words: words.map((w) => ({
            Word: w.word,
            Offset: w.offset_ms * 10000,
            Duration: w.duration_ms * 10000,
            PronunciationAssessment: { AccuracyScore: w.accuracy_score, ErrorType: w.error_type },
            Phonemes: w.phonemes.map((p) => ({
              Phoneme: p.phoneme,
              Offset: p.offset_ms * 10000,
              Duration: p.duration_ms * 10000,
              PronunciationAssessment: { AccuracyScore: p.accuracy_score }
            }))
          }))
        }
      ]
    }
  };
}

/** Template-based A2 recast used when DeepSeek is unavailable. */
function templateRecast({ transcript, scenarioId }) {
  const scenario = getScenario(scenarioId);
  const text = String(transcript || '').trim();
  const cleaned = text.replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const fixes = [];
  if (/\bi want\b/i.test(text)) {
    fixes.push({
      student_said: 'I want ...',
      issue: 'Direct request; the A2 politeness target is "I would like ..."',
      corrected: 'I would like ...',
      severity: 'minor'
    });
  }
  if (/\bneed see\b/i.test(text)) {
    fixes.push({
      student_said: 'need see',
      issue: 'Missing "to" before the verb',
      corrected: 'need to see',
      severity: 'major'
    });
  }
  if (/\bmy head hurt\b/i.test(text)) {
    fixes.push({
      student_said: 'My head hurt',
      issue: 'Third-person -s missing',
      corrected: 'My head hurts',
      severity: 'major'
    });
  }
  if (/\bi come yesterday\b/i.test(text)) {
    fixes.push({
      student_said: 'I come yesterday',
      issue: 'Past simple needed with a past time marker',
      corrected: 'I came yesterday',
      severity: 'major'
    });
  }

  const recast = cleaned
    .replace(/\bI want\b/i, 'I would like')
    .replace(/\bneed see\b/i, 'need to see')
    .replace(/\bMy head hurt\b/i, 'My head hurts')
    .replace(/\bI come yesterday\b/i, 'I came yesterday');

  const replyByCategory = {
    cafe: 'Sure. What size would you like?',
    airport: 'I can help you. What is your flight number?',
    clinic: 'I can help you. When did your symptoms start?',
    shopping: 'Sure. What size do you need?',
    hotel: 'Welcome. How many nights will you stay?',
    train: 'Of course. Where would you like to go?',
    movies: 'Nice line. Can you say it again?',
    songs: 'Nice rhythm. Can you say it again?'
  };
  const reply = replyByCategory[scenario.category] || 'Thank you. Can you tell me more?';

  return {
    recast: recast || scenario.referenceText,
    reply,
    detected_errors: fixes,
    reasoning:
      'Template fallback: the recast keeps the learner meaning, repairs the most frequent A2 grammar slips, and replies with one present-simple question under 25 words.',
    chips: scenario.starters.slice(0, 3),
    cefr_note: 'A2 template response (DeepSeek unavailable)'
  };
}

module.exports = { mockAssessment, templateRecast };

