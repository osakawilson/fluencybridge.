#!/usr/bin/env node
/**
 * Live credential check (requires a running server + AZURE_SPEECH_KEY).
 *
 *   1. Azure Neural TTS  -> 16 kHz / 16-bit / mono WAV  (proves key + region)
 *   2. POST that WAV     -> /api/assess                 (proves end-to-end PA)
 *
 * Usage:
 *   node scripts/live-check.js [baseUrl] ["sentence to synthesize"]
 */

require('dotenv').config();

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sdk = require('microsoft-cognitiveservices-speech-sdk');

const PORT = process.env.PORT || 3000;
const BASE = process.argv[2] || `http://localhost:${PORT}`;
const WAV_PATH = path.join(os.tmpdir(), 'fluencybridge-live-check.wav');

function synthesizeToWav(text) {
  return new Promise((resolve, reject) => {
    if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
      reject(new Error('AZURE_SPEECH_KEY / AZURE_SPEECH_REGION are not set.'));
      return;
    }
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY,
      process.env.AZURE_SPEECH_REGION
    );
    // Exactly the format /api/assess expects: 16 kHz, 16-bit, mono PCM WAV.
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm;
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    const started = Date.now();
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">`
      + `<voice name="${process.env.AZURE_TTS_VOICE || 'en-US-JennyNeural'}">`
      + `<prosody rate="-15%">${text.replace(/[<>&"]/g, ' ')}</prosody></voice></speak>`;

    synthesizer.speakSsmlAsync(ssml, (result) => {
      try { synthesizer.close(); } catch (err) { /* ignore */ }
      if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
        const audio = Buffer.from(result.audioData);
        fs.writeFileSync(WAV_PATH, audio);
        resolve({ audio, ms: Date.now() - started });
      } else {
        const details = sdk.SpeechSynthesisCancellationDetails.fromResult(result);
        reject(new Error(`TTS failed: ${(details && details.errorDetails) || result.reason}`));
      }
    }, (error) => {
      try { synthesizer.close(); } catch (err) { /* ignore */ }
      reject(new Error(`TTS error: ${error}`));
    });
  });
}

(async () => {
  const library = await fetch(`${BASE}/api/scenarios`).then((r) => r.json()).catch(() => null);
  const defaultSentence = library && library.scenarios
    ? (library.scenarios.find((s) => s.id === library.default) || library.scenarios[0])
    : null;
  const TEXT = process.argv[3] || (defaultSentence && defaultSentence.referenceText)
    || 'I would like a medium latte with oat milk, please.';
  const SCENARIO_ID = defaultSentence ? defaultSentence.id : 'cafe-1';

  console.log(`base:   ${BASE}`);
  console.log(`region: ${process.env.AZURE_SPEECH_REGION}`);
  console.log(`target: ${SCENARIO_ID} · "${TEXT}"\n`);

  const tts = await synthesizeToWav(TEXT);
  console.log(`TTS   ok  ${tts.ms} ms · ${tts.audio.length} bytes · ${WAV_PATH}`);

  const started = Date.now();
  const response = await fetch(`${BASE}/api/assess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio: tts.audio.toString('base64'),
      scenarioId: SCENARIO_ID,
      scripted: true,
      referenceText: TEXT
    })
  });
  const data = await response.json();
  const elapsed = Date.now() - started;

  console.log(`assess HTTP ${response.status} in ${elapsed} ms · source=${data.source} · mode=${data.mode}`);
  if (!response.ok) {
    console.log('error:', data.error, '|', data.message);
    if (data.hint) console.log('hint:', data.hint);
    process.exit(1);
  }

  console.log(`heard:  "${data.recognized_text}"`);
  console.log(`scores: accuracy=${data.accuracy_score} fluency=${data.fluency_score} `
    + `completeness=${data.completeness_score} pron=${data.pronunciation_score}`
    + `${data.prosody_score !== null ? ` prosody=${data.prosody_score}` : ''}`);
  console.log(`words:  ${data.words.map((w) => `${w.word}[${Math.round(w.accuracy_score)}]`).join(' ')}`);
  const sample = data.words.find((w) => w.phonemes.length) || data.words[0];
  if (sample) {
    console.log(`phonemes for "${sample.word}": ${sample.phonemes
      .map((p) => `${p.phoneme} ${Math.round(p.accuracy_score)}`).join(' · ')}`);
  }

  const ok = data.source === 'azure' && data.ok === true && data.words.length > 0;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  live Azure assessment ${ok ? 'is working' : 'did not return scored words'}`);
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error('live-check failed:', err.message);
  process.exit(1);
});
