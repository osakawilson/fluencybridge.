/**
 * Optional Azure Neural TTS (the UI falls back to browser `speechSynthesis`).
 * Returns MP3 bytes so the browser can play them with a single <audio> element.
 *
 * Supports the two study voices (female Jenny / male Guy) plus isolated IPA
 * phonemes through SSML `<phoneme alphabet="ipa" ph="...">` for vowel practice.
 */

const sdk = require('microsoft-cognitiveservices-speech-sdk');

const DEFAULT_VOICE = process.env.AZURE_TTS_VOICE || 'en-US-JennyNeural';

const TTS_VOICES = [
  { id: 'en-US-JennyNeural', label: 'Jenny · female (US)', gender: 'female' },
  { id: 'en-US-GuyNeural', label: 'Guy · male (US)', gender: 'male' }
];

// Neural voice names only: blocks SSML injection through the voice attribute.
const VOICE_PATTERN = /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9]{2,32}Neural$/;
// IPA symbols (letters, IPA extensions, length/stress marks, spaces).
const PHONEME_PATTERN = /^[\p{L}\u0250-\u02AF\u02B0-\u02FF\u02D0\u02C8\u02CC\s]{1,16}$/u;

function ttsConfigured() {
  return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

function isSafeVoice(voice) {
  return typeof voice === 'string' && VOICE_PATTERN.test(voice);
}

function isSafePhoneme(phoneme) {
  return typeof phoneme === 'string'
    && phoneme.trim().length > 0
    && PHONEME_PATTERN.test(phoneme.trim())
    && !/[<>&"']/.test(phoneme);
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * @param {{text?:string, voice?:string, rate?:number, phoneme?:string}} options
 *   rate 0.85 -> SSML prosody "-15%" (same convention as speechSynthesis)
 *   phoneme   -> speaks an isolated IPA phone, e.g. "iː" or "eɪ"
 */
function synthesizeWithAzure({ text, voice, rate = 0.85, phoneme }) {
  const selectedVoice = voice || DEFAULT_VOICE;
  const content = String(text || '').trim();
  const phone = phoneme ? String(phoneme).trim() : '';

  if (!isSafeVoice(selectedVoice)) {
    const err = new Error(`Unsupported voice "${selectedVoice}". Use a Neural voice such as en-US-JennyNeural.`);
    err.code = 'INVALID_VOICE';
    return Promise.reject(err);
  }
  if (phone && !isSafePhoneme(phone)) {
    const err = new Error(`Unsupported phoneme "${phone}". Provide an IPA symbol such as iː or eɪ.`);
    err.code = 'INVALID_PHONEME';
    return Promise.reject(err);
  }
  if (!content && !phone) {
    const err = new Error('Text (or a phoneme) is required.');
    err.code = 'INVALID_TEXT';
    return Promise.reject(err);
  }

  const langMatch = selectedVoice.match(/^([a-z]{2}-[A-Z]{2})/);
  const lang = langMatch ? langMatch[1] : 'en-US';
  const ratePercent = Math.round((Math.max(0.5, Math.min(1.5, Number(rate) || 0.85)) - 1) * 100);
  const spoken = phone
    ? `<phoneme alphabet="ipa" ph="${escapeXml(phone)}">${escapeXml(content || phone)}</phoneme>`
    : escapeXml(content.slice(0, 600));

  const ssml = [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">`,
    `<voice name="${escapeXml(selectedVoice)}">`,
    `<prosody rate="${ratePercent >= 0 ? '+' : ''}${ratePercent}%">${spoken}</prosody>`,
    '</voice></speak>'
  ].join('');

  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY,
      process.env.AZURE_SPEECH_REGION
    );
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    const started = Date.now();

    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        try { synthesizer.close(); } catch (err) { /* noop */ }
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve({
            audio: Buffer.from(result.audioData),
            voice: selectedVoice,
            lang,
            ratePercent,
            phoneme: phone || null,
            latencyMs: Date.now() - started,
            ssml
          });
          return;
        }
        const details = sdk.SpeechSynthesisCancellationDetails.fromResult(result);
        const err = new Error(`Azure TTS failed: ${(details && details.errorDetails) || result.reason}`);
        err.code = 'AZURE_TTS_FAILED';
        reject(err);
      },
      (error) => {
        try { synthesizer.close(); } catch (err) { /* noop */ }
        const err = new Error(`Azure TTS error: ${error}`);
        err.code = 'AZURE_TTS_ERROR';
        reject(err);
      }
    );
  });
}

module.exports = {
  synthesizeWithAzure,
  ttsConfigured,
  DEFAULT_VOICE,
  TTS_VOICES,
  isSafeVoice,
  isSafePhoneme
};
