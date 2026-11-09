/**
 * Azure Speech: Pronunciation Assessment (unscripted or scripted).
 *
 * Grading is always HundredMark; granularity is Phoneme so the inspector can
 * show GOP-style per-phoneme accuracy scores. Audio is pushed as raw 16-bit
 * PCM (header stripped) because that is what PushAudioInputStream expects.
 */

const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { parseWav } = require('./wav');
const { phrasesForScenario } = require('./vocabulary');

const TICKS_PER_MS = 10000;
const ticksToMs = (value) => (typeof value === 'number' ? Math.round(value / TICKS_PER_MS) : 0);
const round1 = (value) => (value === null || value === undefined || Number.isNaN(Number(value))
  ? null
  : Math.round(Number(value) * 10) / 10);

const SUPPORTED_PCM_RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000];

/* ------------------------------------------------------------------------- *
 * Word-score calibration
 *
 * Azure's word AccuracyScore is an average of its phoneme scores, which hides
 * single catastrophic substitutions (/l/ -> /r/) and ignores epenthetic vowels
 * ("miruku" for milk, "hotto" for hot) that show up as insertions or as an
 * over-long segment. We keep Azure's number for research and publish a
 * stricter calibrated score for the student view:
 *
 *   composite = 0.4 * azureWordScore + 0.6 * min(phonemeScore)
 *   -25       if an Insertion is adjacent to / on the word (epenthesis)
 *   -25       if a vowel is >= 210 ms AND >= 2.0x the word median phoneme
 *   -15       if a word-final fricative/affricate (/z/, /s/, /tʃ/, /dʒ/) runs
 *             longer than 200 ms (mora-timed coda, e.g. "chīzu" for cheese)
 *   cap 64    if any phoneme < 60 (hard Red: a failed phone can never pass)
 *   cap 78    if any phoneme < 85 (Yellow at best: one weak phone, no Green)
 * ------------------------------------------------------------------------- */
const SCORING = {
  // Multi-tier phoneme caps: < 60 is a failed phone (Red), < 85 is a weak
  // phone (accent drift at best). Either way the word can never read Green.
  phonemeFailThreshold: 60,
  phonemeFailCap: 64,
  phonemeWarnThreshold: 85,
  phonemeWarnCap: 78,
  insertionPenalty: -25,
  lengtheningPenalty: -25,
  codaPenalty: -15,
  // The weakest phone carries more weight than Azure's averaging word score.
  averageWeight: 0.4,
  minPhonemeWeight: 0.6,
  lengtheningRatio: 2.0,
  lengtheningMinMs: 210,
  // Lengthening is only a supporting signal: never punish a word that is
  // already clearly intelligible (native long vowels/stops are normal).
  lengtheningMaxComposite: 85,
  // L1 mora timing: a word-final fricative/affricate held past this is usually
  // a released coda plus an unwritten vowel (Japanese "chīzu", "gurasu").
  codaMinMs: 200,
  codaFinalPhonemes: ['z', 's', 'tʃ', 'dʒ', 'ʧ', 'ʤ'],
  // Only short inserted tokens are treated as epenthetic vowels ("miruku" ->
  // extra /u/). A real added word ("please") must not penalise its neighbour.
  epenthesisMaxPhonemes: 2,
  epenthesisMaxChars: 3,
  rule: 'round(0.4*azureWord + 0.6*minPhoneme) + penalties; cap 64 when any phoneme < 60, cap 78 when any phoneme < 85'
};

/** True for short inserted tokens (extra vowel / mora), not lexical additions. */
function isEpentheticInsertion(errorType, word, phonemeCount) {
  if (errorType !== 'Insertion') return false;
  const chars = String(word || '').replace(/[^\p{L}\p{N}]/gu, '').length;
  return phonemeCount <= SCORING.epenthesisMaxPhonemes || (chars > 0 && chars <= SCORING.epenthesisMaxChars);
}

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** IPA symbols that make a phoneme vowel-like (epenthetic vowels are vowels). */
const VOWEL_SYMBOLS = /[aeiouyæɑɒɔəɚɛɜɞɘɨɪɵøœʊʌɐ]/i;

function isVowelPhoneme(name) {
  return VOWEL_SYMBOLS.test(String(name || ''));
}

/**
 * Returns the vowel that looks stretched (a vowel held for an extra mora).
 * Consonants are ignored: stops like /t/ are naturally long in isolated words.
 */
function detectLengthening(phonemes) {
  const candidates = phonemes.filter((p) => isVowelPhoneme(p.phoneme)
    && Number.isFinite(p.duration_ms)
    && p.duration_ms >= SCORING.lengtheningMinMs);
  if (!candidates.length) return null;

  const longest = candidates.reduce((best, p) => (p.duration_ms > best.duration_ms ? p : best));
  const others = phonemes
    .filter((p) => p !== longest)
    .map((p) => p.duration_ms)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!others.length) return null;

  const med = median(others);
  if (med <= 0 || longest.duration_ms < med * SCORING.lengtheningRatio) return null;

  return {
    phoneme: longest.phoneme,
    duration_ms: longest.duration_ms,
    word_median_ms: Math.round(med),
    threshold_ms: Math.round(Math.max(SCORING.lengtheningMinMs, med * SCORING.lengtheningRatio))
  };
}

/**
 * Strips length marks and tie bars so "d͡ʒ", "dʒː" and "dʒ" all compare equal.
 */
function normalizePhonemeSymbol(name) {
  return String(name || '')
    .replace(/[\u02D0\u02D1\u0361\u035C\u200D]/g, '') // ː ˑ (de)voicing / tie bars
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Detects mora-timed L1 transfer on the coda: a word-final fricative or
 * affricate (/z/, /s/, /tʃ/, /dʒ/) held far longer than an English coda.
 * Japanese speakers release such codas into an epenthetic vowel ("chīzu",
 * "gurasu", "orenji"), which Azure reports as an over-long final segment.
 */
function detectCodaLengthening(phonemes) {
  const finalPhoneme = [...phonemes].reverse().find((p) => normalizePhonemeSymbol(p.phoneme) !== '');
  if (!finalPhoneme) return null;

  const symbol = normalizePhonemeSymbol(finalPhoneme.phoneme);
  if (!SCORING.codaFinalPhonemes.includes(symbol)) return null;

  const duration = Number(finalPhoneme.duration_ms);
  if (!Number.isFinite(duration) || duration <= SCORING.codaMinMs) return null;

  return {
    phoneme: finalPhoneme.phoneme,
    duration_ms: duration,
    threshold_ms: SCORING.codaMinMs
  };
}

/**
 * Multi-tier phoneme ceiling: one failed phone forces Red, one weak phone
 * forbids Green. Returns the ceiling and the tier that produced it, or null.
 */
function phonemeCapFor(minPhoneme) {
  if (!Number.isFinite(minPhoneme)) return null;
  if (minPhoneme < SCORING.phonemeFailThreshold) {
    return { score: SCORING.phonemeFailCap, tier: 'fail' };
  }
  if (minPhoneme < SCORING.phonemeWarnThreshold) {
    return { score: SCORING.phonemeWarnCap, tier: 'warn' };
  }
  return null;
}

/**
 * @param {{word:string, accuracy_score:number|null, error_type:string, phonemes:Array}} word
 * @param {{previousErrorType?:string|null, nextErrorType?:string|null}} context
 */
function calibrateWord(word, context = {}) {
  const phonemes = Array.isArray(word.phonemes) ? word.phonemes : [];
  const phonemeScores = phonemes
    .map((p) => p.accuracy_score)
    .filter((value) => Number.isFinite(value));

  const azureScore = Number.isFinite(Number(word.accuracy_score)) ? Number(word.accuracy_score) : null;
  const fallbackAverage = phonemeScores.length
    ? phonemeScores.reduce((sum, value) => sum + value, 0) / phonemeScores.length
    : 0;
  const average = azureScore === null ? fallbackAverage : azureScore;

  const minPhoneme = phonemeScores.length ? Math.min(...phonemeScores) : null;
  const weakest = phonemes
    .filter((p) => Number.isFinite(p.accuracy_score))
    .reduce((best, p) => (best === null || p.accuracy_score < best.accuracy_score ? p : best), null);

  const composite = minPhoneme === null
    ? average
    : average * SCORING.averageWeight + minPhoneme * SCORING.minPhonemeWeight;

  const penalties = [];
  const ownInsertion = isEpentheticInsertion(
    word.error_type || 'None',
    word.word,
    phonemes.length
  );
  const adjacentInsertion = isEpentheticInsertion(
    context.previousErrorType,
    context.previousWord,
    context.previousPhonemeCount
  ) || isEpentheticInsertion(
    context.nextErrorType,
    context.nextWord,
    context.nextPhonemeCount
  );

  if (ownInsertion || adjacentInsertion) {
    penalties.push({
      type: 'insertion',
      points: SCORING.insertionPenalty,
      note: 'Epenthetic vowel / inserted segment on or next to this word (e.g. "miruku" for milk)'
    });
  }

  const lengthening = composite < SCORING.lengtheningMaxComposite
    ? detectLengthening(phonemes)
    : null;
  if (lengthening) {
    penalties.push({
      type: 'lengthening',
      points: SCORING.lengtheningPenalty,
      note: `Unexpected lengthening of /${lengthening.phoneme}/ `
        + `(${lengthening.duration_ms} ms vs word median ${lengthening.word_median_ms} ms)`,
      phoneme: lengthening.phoneme,
      duration_ms: lengthening.duration_ms
    });
  }

  // Mora-timed coda: a long word-final /z/ /s/ /tʃ/ /dʒ/ usually hides an
  // epenthetic trailing vowel ("chīzu" for cheese), so it always costs points.
  const coda = detectCodaLengthening(phonemes);
  if (coda) {
    penalties.push({
      type: 'coda',
      points: SCORING.codaPenalty,
      note: `Word-final /${coda.phoneme}/ held for ${coda.duration_ms} ms `
        + `(> ${coda.threshold_ms} ms): mora-timed coda / epenthetic trailing vowel`,
      phoneme: coda.phoneme,
      duration_ms: coda.duration_ms
    });
  }

  let score = composite;
  penalties.forEach((penalty) => { score += penalty.points; });

  const preCap = score;
  const cap = phonemeCapFor(minPhoneme);
  const capApplied = cap !== null;
  const capMax = cap ? cap.score : null;
  if (capApplied) score = Math.min(score, capMax);
  // Whether the cap actually lowered the score (vs. already being below it).
  const capBinding = capApplied && preCap > capMax;

  return {
    score: clampScore(score),
    composite: Math.round(composite * 10) / 10,
    azureScore,
    minPhoneme,
    weakest: weakest
      ? { phoneme: weakest.phoneme, accuracy_score: weakest.accuracy_score, duration_ms: weakest.duration_ms }
      : null,
    penalties,
    penaltyTotal: penalties.reduce((sum, penalty) => sum + penalty.points, 0),
    capApplied,
    capBinding,
    capTier: cap ? cap.tier : null,
    capMax,
    lengthening,
    coda
  };
}

/* Audio was captured and is loud enough, but the decoder produced no words.
   This is common with strong L1 interference - it is NOT "no speech". */
const MSG_UNRECOGNIZED = 'Audio detected, but words could not be recognized. Try speaking slightly closer to the mic or toggle Scripted Scoring to practice a specific sentence.';
const MSG_UNRECOGNIZED_SCRIPTED = 'Audio detected, but the target sentence could not be recognized. Try speaking slightly closer to the mic, or switch off Scripted Scoring for free conversation.';
const MSG_SILENT = 'The recording is too quiet to score. Check the microphone and speak a little louder.';

function azureConfigured() {
  return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

function createAudioConfig(wavBuffer, parsed) {
  const isPlainPcm = parsed.bitsPerSample === 16
    && parsed.channels === 1
    && SUPPORTED_PCM_RATES.includes(parsed.sampleRate);
  if (isPlainPcm) {
    const format = sdk.AudioStreamFormat.getWaveFormatPCM(parsed.sampleRate, 16, 1);
    const pushStream = sdk.AudioInputStream.createPushStream(format);
    const { pcm } = parsed;
    const arrayBuffer = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
    pushStream.write(arrayBuffer);
    pushStream.close();
    return sdk.AudioConfig.fromStreamInput(pushStream);
  }
  // Fallback: hand the whole WAV to the SDK (handles other PCM layouts).
  return sdk.AudioConfig.fromWavFileInput(wavBuffer);
}

/**
 * Normalises Azure's word/phoneme data and applies the stricter calibration.
 * `accuracy_score` is the CALIBRATED score used by the UI; `azure_accuracy_score`
 * preserves the raw Azure value for research.
 */
function normalizeWords(nbest) {
  const rawWords = Array.isArray(nbest && nbest.Words) ? nbest.Words : [];

  const base = rawWords.map((entry) => {
    const pa = entry.PronunciationAssessment || {};
    return {
      word: entry.Word || '',
      accuracy_score: round1(pa.AccuracyScore),
      error_type: pa.ErrorType || 'None',
      offset_ms: ticksToMs(entry.Offset),
      duration_ms: ticksToMs(entry.Duration),
      phonemes: (Array.isArray(entry.Phonemes) ? entry.Phonemes : []).map((phoneme) => {
        const phonemePa = phoneme.PronunciationAssessment || {};
        return {
          phoneme: phoneme.Phoneme || '',
          accuracy_score: round1(phonemePa.AccuracyScore),
          offset_ms: ticksToMs(phoneme.Offset),
          duration_ms: ticksToMs(phoneme.Duration),
          // Defensive: some service versions attach miscue info per phoneme.
          error_type: phonemePa.ErrorType || null
        };
      })
    };
  });

  return base.map((word, index) => {
    const previous = index > 0 ? base[index - 1] : null;
    const next = index + 1 < base.length ? base[index + 1] : null;
    const calibration = calibrateWord(word, {
      previousErrorType: previous ? previous.error_type : null,
      previousWord: previous ? previous.word : null,
      previousPhonemeCount: previous ? previous.phonemes.length : 0,
      nextErrorType: next ? next.error_type : null,
      nextWord: next ? next.word : null,
      nextPhonemeCount: next ? next.phonemes.length : 0
    });

    const weakestName = calibration.weakest ? calibration.weakest.phoneme : null;
    const phonemes = word.phonemes.map((phoneme) => ({
      ...phoneme,
      // "Weakest" only matters when there are several phonemes AND one is
      // actually weak - no need to flag a perfect word.
      is_weakest: word.phonemes.length > 1
        && Number.isFinite(calibration.minPhoneme)
        && calibration.minPhoneme < SCORING.phonemeWarnThreshold
        && weakestName !== null
        && phoneme.phoneme === weakestName
        && phoneme.accuracy_score === calibration.minPhoneme,
      is_failed: Number.isFinite(phoneme.accuracy_score)
        && phoneme.accuracy_score < SCORING.phonemeFailThreshold
    }));

    return {
      word: word.word,
      accuracy_score: calibration.score,
      azure_accuracy_score: word.accuracy_score,
      error_type: word.error_type,
      offset_ms: word.offset_ms,
      duration_ms: word.duration_ms,
      min_phoneme_score: calibration.minPhoneme,
      weakest_phoneme: calibration.weakest,
      failed_phonemes: phonemes
        .filter((phoneme) => phoneme.is_failed)
        .map((phoneme) => ({ phoneme: phoneme.phoneme, accuracy_score: phoneme.accuracy_score })),
      phoneme_cap_applied: calibration.capApplied,
      phoneme_cap_binding: calibration.capBinding,
      phoneme_cap_tier: calibration.capTier,
      penalties: calibration.penalties,
      calibration: {
        rule: SCORING.rule,
        composite: calibration.composite,
        azure_word_score: calibration.azureScore,
        penalty_total: calibration.penaltyTotal,
        capped_at: calibration.capMax,
        cap_tier: calibration.capTier,
        min_phoneme_score: calibration.minPhoneme
      },
      phonemes
    };
  });
}

function meanOf(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 10) / 10;
}

/**
 * @returns {Promise<object>} normalized assessment payload. "No speech" and
 *   "audio but no words" resolve as ok:false (not thrown) so the inspector
 *   still receives the raw Azure data and the UI can explain what happened.
 */
function assessWithAzure({ wavBuffer, referenceText, language, scenarioId, keywords = [] }) {
  const scripted = Boolean(referenceText && referenceText.trim());
  const parsed = parseWav(wavBuffer);
  const audioPresent = !parsed.silent;

  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY,
      process.env.AZURE_SPEECH_REGION
    );
    speechConfig.speechRecognitionLanguage = language || process.env.AZURE_SPEECH_LANGUAGE || 'en-US';
    speechConfig.outputFormat = sdk.OutputFormat.Detailed;
    speechConfig.requestWordLevelTimestamps();
    // Bound the wait when a clip contains no usable speech, but leave a long
    // enough end-silence window that pauses between words are not cut off.
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '6000');
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '2500');

    const recognizer = new sdk.SpeechRecognizer(speechConfig, createAudioConfig(wavBuffer, parsed));

    // Contextual bias: nudge the acoustic decoder toward A2 classroom language
    // so L1-accented words are not decoded as unrelated English words.
    const phraseListTerms = phrasesForScenario({
      scenarioId,
      keywords,
      referenceText: scripted ? referenceText : ''
    });
    let phraseListApplied = false;
    try {
      const grammar = sdk.PhraseListGrammar.fromRecognizer(recognizer);
      grammar.addPhrases(phraseListTerms);
      phraseListApplied = true;
    } catch (err) {
      console.warn('PhraseListGrammar could not be applied:', err && err.message);
    }

    const bias = {
      phrase_list_applied: phraseListApplied,
      phrase_list_count: phraseListTerms.length,
      phrase_list: phraseListTerms,
      scenario: scenarioId || null
    };

    const shared = () => ({
      mode: scripted ? 'scripted' : 'unscripted',
      reference_text: scripted ? referenceText.trim() : '',
      audio_duration_ms: parsed.durationMs,
      audio_format: parsed.format,
      audio_peak: parsed.peak,
      audio_rms: parsed.rms,
      silence_thresholds: parsed.silenceThresholds,
      audio_present: audioPresent,
      source: 'azure',
      provider: 'azure-speech',
      bias
    });

    // HundredMark + Phoneme granularity are mandatory for this study.
    const paConfig = new sdk.PronunciationAssessmentConfig(
      scripted ? referenceText.trim() : '',
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      scripted // enableMiscue only makes sense against a reference text
    );
    try {
      paConfig.phonemeAlphabet = process.env.AZURE_PHONEME_ALPHABET || 'IPA';
      paConfig.enableProsodyAssessment = true;
      paConfig.nbestPhonemeCount = 1;
    } catch (err) {
      // Older SDK builds may not expose these knobs; assessment still works.
    }
    paConfig.applyTo(recognizer);

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { recognizer.close(); } catch (err) { /* noop */ }
      fn(value);
    };

    const timer = setTimeout(() => {
      const err = new Error('Azure pronunciation assessment timed out after 25s.');
      err.code = 'AZURE_TIMEOUT';
      finish(reject, err);
    }, 25000);

    recognizer.recognizeOnceAsync(
      (result) => {
        const rawString = result.properties
          ? result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult)
          : '';
        let raw = null;
        try {
          raw = rawString ? JSON.parse(rawString) : null;
        } catch (err) {
          raw = { parseError: String(err), rawString };
        }

        const buildNoTranscript = (recognizerReason) => ({
          ok: false,
          no_speech: true,
          // Audio was captured but produced no words (heavy L1 interference,
          // mumbling, wrong language) vs. genuinely silent input.
          error: audioPresent ? 'unrecognized_speech' : 'silent_audio',
          message: audioPresent
            ? (scripted ? MSG_UNRECOGNIZED_SCRIPTED : MSG_UNRECOGNIZED)
            : MSG_SILENT,
          recognized_text: '',
          accuracy_score: null,
          fluency_score: null,
          completeness_score: null,
          words: [],
          ...shared(),
          recognizer_reason: recognizerReason,
          raw
        });

        if (result.reason === sdk.ResultReason.RecognizedSpeech) {
          const nbest = raw && raw.NBest && raw.NBest[0] ? raw.NBest[0] : null;
          const scores = (nbest && nbest.PronunciationAssessment) || {};
          const words = normalizeWords(nbest);
          const text = String(result.text || (nbest && nbest.Display) || '').trim();
          const usableWords = words.filter((word) => Number(word.accuracy_score) > 0);

          // Azure may report RecognizedSpeech with an empty transcript, or (in
          // scripted mode) align the reference against pure noise and return
          // every word at 0 accuracy. Neither is a real transcript.
          if (!text || words.length === 0 || usableWords.length === 0) {
            finish(resolve, buildNoTranscript('NoUsableWords'));
            return;
          }

          const completeness = round1(scores.CompletenessScore);
          finish(resolve, {
            ok: true,
            recognized_text: text,
            accuracy_score: round1(scores.AccuracyScore),
            fluency_score: round1(scores.FluencyScore),
            // Completeness is only meaningful against a reference text.
            completeness_score: completeness === null ? (scripted ? 0 : 100) : completeness,
            completeness_meaningful: scripted,
            pronunciation_score: round1(scores.PronScore),
            prosody_score: round1(scores.ProsodyScore),
            words,
            // Word-level calibration summary (strict student-facing scores).
            calibrated_accuracy_score: meanOf(words.map((word) => word.accuracy_score)),
            word_scoring: {
              rule: SCORING.rule,
              thresholds: {
                phoneme_fail: SCORING.phonemeFailThreshold,
                phoneme_fail_cap: SCORING.phonemeFailCap,
                phoneme_warn: SCORING.phonemeWarnThreshold,
                phoneme_warn_cap: SCORING.phonemeWarnCap,
                insertion_penalty: SCORING.insertionPenalty,
                lengthening_penalty: SCORING.lengtheningPenalty,
                lengthening_min_ms: SCORING.lengtheningMinMs,
                lengthening_ratio: SCORING.lengtheningRatio,
                coda_penalty: SCORING.codaPenalty,
                coda_min_ms: SCORING.codaMinMs,
                coda_final_phonemes: SCORING.codaFinalPhonemes,
                weights: {
                  azure: SCORING.averageWeight,
                  min_phoneme: SCORING.minPhonemeWeight
                }
              },
              words: words.length,
              words_capped: words.filter((word) => word.phoneme_cap_applied).length,
              words_penalised: words.filter((word) => (word.penalties || []).length > 0).length,
              mean_azure_accuracy: meanOf(words.map((word) => word.azure_accuracy_score)),
              mean_calibrated_accuracy: meanOf(words.map((word) => word.accuracy_score))
            },
            ...shared(),
            recognizer_reason: 'RecognizedSpeech',
            raw
          });
          return;
        }

        if (result.reason === sdk.ResultReason.NoMatch) {
          const noMatch = sdk.NoMatchDetails.fromResult(result);
          const payload = buildNoTranscript('NoMatch');
          payload.no_match_reason = noMatch && noMatch.reason
            ? (sdk.NoMatchReason[noMatch.reason] || String(noMatch.reason))
            : null;
          finish(resolve, payload);
          return;
        }

        const details = sdk.CancellationDetails.fromResult(result);
        const err = new Error(
          `Azure recognition ${sdk.ResultReason[result.reason] || 'failed'}: ${(details && details.errorDetails) || 'unknown error'}`
        );
        err.code = 'AZURE_CANCELED';
        err.azure = {
          reason: details && details.reason,
          errorCode: details && details.ErrorCode,
          errorDetails: details && details.errorDetails
        };
        err.raw = raw;
        finish(reject, err);
      },
      (error) => {
        const err = new Error(`Azure Speech SDK error: ${error}`);
        err.code = 'AZURE_SDK_ERROR';
        finish(reject, err);
      }
    );
  });
}

module.exports = {
  assessWithAzure,
  azureConfigured,
  // exported for calibration unit tests
  calibrateWord,
  normalizeWords,
  SCORING
};


