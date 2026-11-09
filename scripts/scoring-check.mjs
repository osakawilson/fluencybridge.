#!/usr/bin/env node
/**
 * Offline calibration unit tests (no server, no keys).
 *   node scripts/scoring-check.mjs
 *
 * Covers the strict L1-aware word scoring in src/azureAssessment.js (weights,
 * multi-tier phoneme caps, lengthening + mora-timed coda penalties) and the
 * display bands in public/js/ui.js (green >= 88 / yellow 65-87 / red < 65).
 */

import { readFile } from 'node:fs/promises';
import assessmentModule from '../src/azureAssessment.js';

const { calibrateWord, normalizeWords, SCORING } = assessmentModule;

/* ui.js is a browser ES module (the project is CommonJS), so evaluate it as a
   data: URL - the same trick scripts/selection-check.mjs uses. */
const uiSource = await readFile(new URL('../public/js/ui.js', import.meta.url), 'utf8');
const ui = await import(`data:text/javascript;base64,${Buffer.from(uiSource, 'utf8').toString('base64')}`);
const { BAND_THRESHOLDS, scoreBand, bandLabel, scoreHex } = ui;

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

const ph = (phoneme, accuracy_score, duration_ms = 100) => ({ phoneme, accuracy_score, duration_ms });
const w = (word, accuracy_score, phonemes, error_type = 'None') => ({ word, accuracy_score, error_type, phonemes });
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;
const penaltyTypes = (result) => result.penalties.map((penalty) => penalty.type);

/* 1. Constants reflect the tightened calibration. */
check('weights prioritise the weakest phone (0.4 azure / 0.6 min phoneme)',
  SCORING.averageWeight === 0.4 && SCORING.minPhonemeWeight === 0.6,
  `${SCORING.averageWeight} / ${SCORING.minPhonemeWeight}`);
check('multi-tier caps are 64 (< 60) and 78 (< 85)',
  SCORING.phonemeFailThreshold === 60 && SCORING.phonemeFailCap === 64
  && SCORING.phonemeWarnThreshold === 85 && SCORING.phonemeWarnCap === 78,
  `fail < ${SCORING.phonemeFailThreshold} -> ${SCORING.phonemeFailCap}, `
  + `warn < ${SCORING.phonemeWarnThreshold} -> ${SCORING.phonemeWarnCap}`);
check('lengthening floor is 210 ms / 2.0x median',
  SCORING.lengtheningMinMs === 210 && SCORING.lengtheningRatio === 2.0,
  `${SCORING.lengtheningMinMs} ms / ${SCORING.lengtheningRatio}x`);
check('coda rule is 200 ms / -15 on /z s tʃ dʒ/',
  SCORING.codaMinMs === 200 && SCORING.codaPenalty === -15
  && ['z', 's', 'tʃ', 'dʒ'].every((symbol) => SCORING.codaFinalPhonemes.includes(symbol)),
  `${SCORING.codaMinMs} ms / ${SCORING.codaPenalty} / ${SCORING.codaFinalPhonemes.join(' ')}`);
check('rule string documents the new weights and caps',
  SCORING.rule.includes('0.4*azureWord') && SCORING.rule.includes('cap 64')
  && SCORING.rule.includes('cap 78'), SCORING.rule);

/* 2. Composite weighting: the weakest phone dominates. */
const weighted = calibrateWord(w('milk', 90, [ph('m', 90), ph('ɪ', 90), ph('l', 60), ph('k', 90)]));
check('composite = 0.4*azure + 0.6*min phoneme',
  near(weighted.composite, 0.4 * 90 + 0.6 * 60) && weighted.score === 72,
  `composite ${weighted.composite}, score ${weighted.score}`);

/* 3. Tier 1: any phoneme < 60 hard-caps at 64 (Red). */
const failed = calibrateWord(w('sink', 98, [ph('s', 98), ph('ɪ', 98), ph('ŋ', 50), ph('k', 98)]));
check('phoneme < 60 hard-caps at 64', failed.score === 64 && failed.capApplied
  && failed.capBinding && failed.capTier === 'fail' && failed.capMax === 64,
  `score ${failed.score}, composite ${failed.composite}, cap ${failed.capTier}/${failed.capMax}`);
check('a phoneme at exactly 60 is the warn tier, not the fail tier',
  calibrateWord(w('sink', 100, [ph('s', 100), ph('ŋ', 60), ph('k', 100)])).capTier === 'warn');

/* 4. Tier 2: any phoneme < 85 caps at 78 (Yellow at best, never Green). */
const weak = calibrateWord(w('thick', 100, [ph('θ', 100), ph('ɪ', 84), ph('k', 100)]));
check('phoneme < 85 caps at 78', weak.score === 78 && weak.capApplied
  && weak.capBinding && weak.capTier === 'warn' && weak.capMax === 78,
  `score ${weak.score}, composite ${weak.composite}`);
check('capped 78 words can never be Clear', scoreBand(weak.score) === 'warn', bandLabel(weak.score));

const clean = calibrateWord(w('thick', 100, [ph('θ', 100), ph('ɪ', 85), ph('k', 100)]));
check('phoneme >= 85 leaves the score uncapped', !clean.capApplied && clean.capMax === null
  && clean.score === 91 && scoreBand(clean.score) === 'good',
  `score ${clean.score}`);

/* 5. Lengthening: 210 ms AND 2.0x the word median. */
const stretched = calibrateWord(w('cat', 70, [ph('k', 70, 70), ph('æ', 70, 210), ph('t', 70, 70)]));
check('vowel held 210 ms (>= 2.0x median) is penalised -25',
  penaltyTypes(stretched).includes('lengthening') && stretched.score === 45,
  `${penaltyTypes(stretched).join(',')} -> ${stretched.score}`);

const justUnder = calibrateWord(w('cat', 70, [ph('k', 70, 70), ph('æ', 70, 205), ph('t', 70, 70)]));
check('vowel held 205 ms stays below the 210 ms floor',
  !penaltyTypes(justUnder).includes('lengthening') && justUnder.score === 70,
  `score ${justUnder.score}`);

const notDouble = calibrateWord(w('cat', 70, [ph('k', 70, 130), ph('æ', 70, 240), ph('t', 70, 130)]));
check('240 ms vowel at 1.85x the median is not flagged',
  !penaltyTypes(notDouble).includes('lengthening') && notDouble.score === 70,
  `score ${notDouble.score}`);

/* 6. Mora-timed coda: word-final fricative/affricate > 200 ms costs -15. */
const cheese = calibrateWord(w('cheese', 92, [ph('tʃ', 92, 90), ph('i', 92, 140), ph('z', 92, 260)]));
check('/z/ held 260 ms gets the -15 coda penalty',
  penaltyTypes(cheese).includes('coda') && cheese.score === 77,
  `${penaltyTypes(cheese).join(',')} -> ${cheese.score}`);
check('coda epenthesis keeps "cheese" out of the Clear band',
  scoreBand(cheese.score) === 'warn', `${cheese.score} -> ${bandLabel(cheese.score)}`);
check('coda penalty detail is auditable',
  cheese.penalties.some((p) => p.type === 'coda' && p.points === -15 && p.phoneme === 'z'
    && p.duration_ms === 260), JSON.stringify(cheese.penalties[0]));

const exactly200 = calibrateWord(w('cheese', 92, [ph('tʃ', 92, 90), ph('i', 92, 140), ph('z', 92, 200)]));
check('/z/ at exactly 200 ms is not penalised (must exceed)',
  !penaltyTypes(exactly200).includes('coda') && exactly200.score === 92);

const longN = calibrateWord(w('ten', 92, [ph('t', 92, 90), ph('ɛ', 92, 120), ph('n', 92, 400)]));
check('a long word-final nasal is not a coda-epenthesis signal',
  !penaltyTypes(longN).includes('coda') && longN.score === 92);

const affricate = calibrateWord(w('orange', 92,
  [ph('ɔ', 92, 120), ph('ɹ', 92, 80), ph('ɪ', 92, 60), ph('n', 92, 70), ph('d͡ʒ', 92, 240)]));
check('/d͡ʒ/ with a tie bar is detected as a final affricate',
  penaltyTypes(affricate).includes('coda') && affricate.score === 77,
  `${penaltyTypes(affricate).join(',')} -> ${affricate.score}`);

const finalS = calibrateWord(w('glass', 92,
  [ph('g', 92, 80), ph('l', 92, 70), ph('æ', 92, 150), ph('s', 92, 230)]));
check('/s/ held 230 ms is penalised (gurasu-style coda)',
  penaltyTypes(finalS).includes('coda') && finalS.score === 77);

/* 7. Epenthesis insertion penalty still applies to short inserted tokens only. */
const ownInsertion = calibrateWord(w('u', 90, [ph('u', 90)], 'Insertion'));
check('a short inserted vowel costs -25',
  penaltyTypes(ownInsertion).includes('insertion') && ownInsertion.score === 65);

const neighbour = calibrateWord(w('milk', 90, [ph('m', 90), ph('ɪ', 90), ph('l', 90), ph('k', 90)]),
  { nextErrorType: 'Insertion', nextWord: 'u', nextPhonemeCount: 1 });
check('a word next to a short insertion costs -25',
  penaltyTypes(neighbour).includes('insertion') && neighbour.score === 65, `score ${neighbour.score}`);

const realWordNeighbour = calibrateWord(w('milk', 90, [ph('m', 90), ph('ɪ', 90), ph('l', 90), ph('k', 90)]),
  { nextErrorType: 'Insertion', nextWord: 'please', nextPhonemeCount: 5 });
check('a real added word does not penalise its neighbour',
  !penaltyTypes(realWordNeighbour).includes('insertion') && realWordNeighbour.score === 90);


/* 8. normalizeWords exposes the new cap tiers for the inspector. */
const ticks = (ms) => ms * 10000;
const normalized = normalizeWords({
  Words: [
    {
      Word: 'cheese',
      Offset: ticks(0),
      Duration: ticks(500),
      PronunciationAssessment: { AccuracyScore: 95, ErrorType: 'None' },
      Phonemes: [
        { Phoneme: 'tʃ', Offset: ticks(0), Duration: ticks(90), PronunciationAssessment: { AccuracyScore: 95 } },
        { Phoneme: 'i', Offset: ticks(90), Duration: ticks(140), PronunciationAssessment: { AccuracyScore: 96 } },
        { Phoneme: 'z', Offset: ticks(230), Duration: ticks(270), PronunciationAssessment: { AccuracyScore: 94 } }
      ]
    },
    {
      Word: 'thick',
      Offset: ticks(520),
      Duration: ticks(400),
      PronunciationAssessment: { AccuracyScore: 96, ErrorType: 'None' },
      Phonemes: [
        { Phoneme: 'θ', Offset: ticks(520), Duration: ticks(80), PronunciationAssessment: { AccuracyScore: 96 } },
        { Phoneme: 'ɪ', Offset: ticks(600), Duration: ticks(120), PronunciationAssessment: { AccuracyScore: 70 } },
        { Phoneme: 'k', Offset: ticks(720), Duration: ticks(90), PronunciationAssessment: { AccuracyScore: 96 } }
      ]
    },
    {
      Word: 'sink',
      Offset: ticks(960),
      Duration: ticks(400),
      PronunciationAssessment: { AccuracyScore: 92, ErrorType: 'None' },
      Phonemes: [
        { Phoneme: 's', Offset: ticks(960), Duration: ticks(80), PronunciationAssessment: { AccuracyScore: 92 } },
        { Phoneme: 'ɪ', Offset: ticks(1040), Duration: ticks(120), PronunciationAssessment: { AccuracyScore: 92 } },
        { Phoneme: 'ŋ', Offset: ticks(1160), Duration: ticks(100), PronunciationAssessment: { AccuracyScore: 41 } },
        { Phoneme: 'k', Offset: ticks(1260), Duration: ticks(90), PronunciationAssessment: { AccuracyScore: 92 } }
      ]
    }
  ]
});

const [nCheese, nThick, nSink] = normalized;
check('normalizeWords keeps one row per Azure word', normalized.length === 3
  && normalized.map((word) => word.word).join(',') === 'cheese,thick,sink');

check('cheese: coda penalty applies, no cap',
  near(nCheese.calibration.composite, 94.4) && nCheese.accuracy_score === 79
  && nCheese.phoneme_cap_applied === false && nCheese.calibration.capped_at === null
  && (nCheese.penalties || []).some((p) => p.type === 'coda'),
  `composite ${nCheese.calibration.composite}, score ${nCheese.accuracy_score}`);
check('cheese: phoneme durations are converted from ticks',
  nCheese.phonemes.find((phoneme) => phoneme.phoneme === 'z').duration_ms === 270
  && nCheese.azure_accuracy_score === 95);

check('thick: warn tier caps at 78 and reports it',
  nThick.accuracy_score === 78 && nThick.phoneme_cap_applied === true
  && nThick.phoneme_cap_binding === true && nThick.phoneme_cap_tier === 'warn'
  && nThick.calibration.capped_at === 78 && nThick.calibration.cap_tier === 'warn',
  `score ${nThick.accuracy_score}, capped_at ${nThick.calibration.capped_at}`);
check('thick: weakest phoneme is flagged for the inspector',
  nThick.weakest_phoneme && nThick.weakest_phoneme.phoneme === 'ɪ'
  && nThick.phonemes.find((phoneme) => phoneme.phoneme === 'ɪ').is_weakest === true);

check('sink: fail tier caps at 64 and lists the failed phoneme',
  nSink.accuracy_score === 61 && nSink.phoneme_cap_tier === 'fail'
  && nSink.phoneme_cap_applied === true && nSink.phoneme_cap_binding === false
  && nSink.calibration.capped_at === 64
  && nSink.failed_phonemes.length === 1 && nSink.failed_phonemes[0].phoneme === 'ŋ'
  && nSink.phonemes.find((phoneme) => phoneme.phoneme === 'ŋ').is_failed === true,
  `score ${nSink.accuracy_score} (already under the 64 cap), failed ${JSON.stringify(nSink.failed_phonemes)}`);
check('sink: capped word lands in the Red band', scoreBand(nSink.accuracy_score) === 'bad',
  `${nSink.accuracy_score} -> ${bandLabel(nSink.accuracy_score)}`);

/* 9. Display bands in public/js/ui.js. */
check('band thresholds are green 88 / yellow 65 (raised from 85)',
  BAND_THRESHOLDS.good === 88 && BAND_THRESHOLDS.warn === 65,
  JSON.stringify(BAND_THRESHOLDS));
check('scoreBand boundaries: 88 good / 87 warn / 65 warn / 64 bad',
  scoreBand(100) === 'good' && scoreBand(88) === 'good' && scoreBand(87) === 'warn'
  && scoreBand(65) === 'warn' && scoreBand(64) === 'bad' && scoreBand(null) === 'none');
check('band labels stay Clear / Accent drift / Mispronounced',
  bandLabel(88) === 'Clear' && bandLabel(87) === 'Accent drift' && bandLabel(64) === 'Mispronounced');
check('band colours unchanged (green / yellow / red)',
  scoreHex(88) === '#16a34a' && scoreHex(87) === '#ca8a04' && scoreHex(64) === '#dc2626');

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll scoring calibration checks passed.');
process.exit(failures ? 1 : 0);

