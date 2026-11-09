/**
 * Voice output: browser SpeechSynthesis (default, $0) or Azure Neural TTS.
 * Rate 0.85 across both engines keeps the A2 listening load consistent.
 */

import { azureTts } from './api.js';

export const SPEECH_RATE = 0.85;

let activeAudio = null;

export function warmUpVoices() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices());
}

export function pickEnglishVoice() {
  const synth = window.speechSynthesis;
  if (!synth || typeof synth.getVoices !== 'function') return null;
  const voices = synth.getVoices() || [];
  const english = voices.filter((voice) => /^en[-_]/i.test(voice.lang || ''));
  const preferred = [/Google US English/i, /Samantha/i, /Aria/i, /Jenny/i, /Zira/i, /Microsoft .*English/i];
  for (const pattern of preferred) {
    const hit = english.find((voice) => pattern.test(voice.name));
    if (hit) return hit;
  }
  return english[0] || null;
}

export function stopSpeaking() {
  try {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  } catch (err) { /* ignore */ }
  if (activeAudio) {
    try { activeAudio.pause(); } catch (err) { /* ignore */ }
    try { URL.revokeObjectURL(activeAudio.src); } catch (err) { /* ignore */ }
    activeAudio = null;
  }
}

/** @returns {Promise<{engine:string, voice:string, ttftMs:number, totalMs:number}>} */
export function speakWithBrowser(text, { rate = SPEECH_RATE } = {}) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('This browser does not support speechSynthesis.'));
      return;
    }
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.lang = 'en-US';
    const voice = pickEnglishVoice();
    if (voice) utterance.voice = voice;

    const started = performance.now();
    let firstAudioAt = null;
    let settled = false;
    let watchdog = null;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (watchdog) window.clearTimeout(watchdog);
      resolve(payload);
    };
    const fail = (message) => {
      if (settled) return;
      settled = true;
      if (watchdog) window.clearTimeout(watchdog);
      reject(new Error(message));
    };

    // Some headless / voice-less environments never fire onstart or onend.
    watchdog = window.setTimeout(() => {
      try { window.speechSynthesis.cancel(); } catch (err) { /* ignore */ }
      fail('The browser voice did not start. Add an English system voice or use Azure Neural TTS.');
    }, Math.max(5000, Math.min(25000, text.length * 140)));

    utterance.onstart = () => { firstAudioAt = performance.now(); };
    utterance.onend = () => {
      const end = performance.now();
      finish({
        engine: 'browser',
        voice: voice ? voice.name : 'system default',
        ttftMs: Math.round((firstAudioAt === null ? end : firstAudioAt) - started),
        totalMs: Math.round(end - started)
      });
    };
    utterance.onerror = (event) => {
      fail(`Browser TTS failed (${(event && event.error) || 'unknown error'}).`);
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      fail(`Browser TTS could not start (${err.message}).`);
    }
  });
}

/** Azure Neural TTS: same rate expressed as SSML prosody on the server. */
export async function speakWithAzure(text, { rate = SPEECH_RATE, voice, phoneme } = {}) {
  const started = performance.now();
  const { blob, serverMs, voice: usedVoice } = await azureTts({ text, rate, voice, phoneme });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = 'auto';
  activeAudio = audio;

  try {
    await new Promise((resolve, reject) => {
      audio.onplaying = () => resolve();
      audio.onerror = () => reject(new Error('Azure audio element could not play the returned MP3.'));
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(reject);
    });
  } catch (err) {
    try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    activeAudio = null;
    throw err;
  }

  return {
    engine: 'azure',
    voice: usedVoice,
    phoneme: phoneme || null,
    serverMs,
    ttftMs: Math.round(performance.now() - started),
    totalMs: Math.round(performance.now() - started),
    stop: () => {
      try { audio.pause(); } catch (err) { /* ignore */ }
      try { URL.revokeObjectURL(url); } catch (err) { /* ignore */ }
      if (activeAudio === audio) activeAudio = null;
    }
  };
}

/**
 * Speak with the selected engine; Azure failures degrade to the browser voice
 * instead of breaking the turn (the caller still sees `warning`).
 */
export async function speak(text, { engine = 'browser', rate = SPEECH_RATE, voice } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('There is nothing to play yet.');

  if (engine === 'azure') {
    try {
      return await speakWithAzure(trimmed, { rate, voice });
    } catch (err) {
      const result = await speakWithBrowser(trimmed, { rate });
      return { ...result, fallbackFrom: 'azure', warning: err.message };
    }
  }
  return speakWithBrowser(trimmed, { rate });
}

/**
 * Plays an isolated IPA phone via SSML `<phoneme>` (Azure). `word` is used as
 * the SSML inner text so the synthesiser keeps the source word in context
 * (`<phoneme alphabet="ipa" ph="juː">Houston</phoneme>`); when it is missing the
 * grapheme is spoken instead. If the phoneme request fails, the word/grapheme is
 * spoken by the browser voice so the student still hears something useful.
 */
export async function speakPhoneme(phoneme, { engine = 'azure', rate = SPEECH_RATE, voice, grapheme, word } = {}) {
  const phone = String(phoneme || '').trim();
  if (!phone) throw new Error('No phoneme to play.');
  const spoken = String(word || '').trim() || grapheme || phone;

  if (engine === 'azure') {
    try {
      return await speakWithAzure(spoken, { rate, voice, phoneme: phone });
    } catch (err) {
      const result = await speakWithBrowser(spoken, { rate });
      return { ...result, fallbackFrom: 'azure', warning: err.message };
    }
  }
  return speakWithBrowser(spoken, { rate });
}
