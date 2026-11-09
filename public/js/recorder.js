/**
 * Raw-PCM microphone recorder.
 *
 * ScriptProcessorNode is used (not AudioWorklet) because it needs no separate
 * module file and is available in every browser that ships getUserMedia. The
 * processor is routed through a zero-gain node so nothing is played back into
 * the speakers (no feedback loop).
 */

import {
  TARGET_SAMPLE_RATE, downsample, encodeWav, mergeChunks, blobToBase64
} from './wav.js';

export class RecordingError extends Error {}

export class MicrophoneRecorder {
  constructor({ targetRate = TARGET_SAMPLE_RATE, maxMs = 30000, onTick, onLimit } = {}) {
    this.targetRate = targetRate;
    this.maxMs = maxMs;
    this.onTick = onTick;
    this.onLimit = onLimit;
    this.recording = false;
    this.chunks = [];
    this.sampleCount = 0;
    this.peak = 0;
    this.level = 0;
    this.stream = null;
    this.ctx = null;
    this.source = null;
    this.processor = null;
    this.sink = null;
    this.timer = null;
    this.startedAt = 0;
    this.sampleRate = targetRate;
  }

  get isRecording() {
    return this.recording;
  }

  static get supported() {
    return Boolean(
      navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function'
      && (window.AudioContext || window.webkitAudioContext)
    );
  }

  elapsedMs() {
    if (!this.sampleRate) return 0;
    return Math.round((this.sampleCount / this.sampleRate) * 1000);
  }

  async start() {
    if (this.recording) return;
    if (!MicrophoneRecorder.supported) {
      throw new RecordingError('This browser cannot capture microphone audio. Try Chrome, Edge or Firefox on localhost/HTTPS.');
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    } catch (err) {
      const reason = err && err.name === 'NotAllowedError'
        ? 'Microphone permission was blocked. Allow the mic in your browser and try again.'
        : `Could not open the microphone (${err && err.name ? err.name : 'unknown error'}).`;
      throw new RecordingError(reason);
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (err) { /* ignore */ }
    }

    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;

    this.chunks = [];
    this.sampleCount = 0;
    this.peak = 0;
    this.level = 0;
    this.sampleRate = ctx.sampleRate;
    this.stream = stream;
    this.ctx = ctx;
    this.source = source;
    this.processor = processor;
    this.sink = sink;

    processor.onaudioprocess = (event) => {
      if (!this.recording) return;
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.chunks.push(copy);
      this.sampleCount += copy.length;

      let p = 0;
      for (let i = 0; i < copy.length; i += 1) {
        const abs = copy[i] < 0 ? -copy[i] : copy[i];
        if (abs > p) p = abs;
      }
      this.level = p;
      if (p > this.peak) this.peak = p;
    };

    source.connect(processor);
    processor.connect(sink);
    sink.connect(ctx.destination);

    this.recording = true;
    this.startedAt = performance.now();
    this.timer = window.setInterval(() => {
      const elapsed = this.elapsedMs();
      if (typeof this.onTick === 'function') this.onTick(elapsed, this.level);
      if (elapsed >= this.maxMs && typeof this.onLimit === 'function') this.onLimit(elapsed);
    }, 100);
  }

  async stop() {
    if (!this.recording) return null;
    this.recording = false;
    window.clearInterval(this.timer);
    this.timer = null;

    const recordMs = Math.round(performance.now() - this.startedAt);
    const inputRate = this.sampleRate;
    const peak = this.peak;

    const ctx = this.ctx;
    this.release();
    try { if (ctx && ctx.state !== 'closed') await ctx.close(); } catch (err) { /* ignore */ }

    const merged = mergeChunks(this.chunks, this.sampleCount);
    this.chunks = [];
    this.sampleCount = 0;

    const encodeStart = performance.now();
    const mono = downsample(merged, inputRate, this.targetRate);
    const blob = encodeWav(mono, this.targetRate);
    const base64 = await blobToBase64(blob);
    const encodeMs = Math.round(performance.now() - encodeStart);

    return {
      blob,
      base64,
      mimeType: 'audio/wav',
      inputSampleRate: inputRate,
      sampleRate: this.targetRate,
      durationMs: Math.round((mono.length / this.targetRate) * 1000),
      recordMs,
      encodeMs,
      totalRecMs: recordMs + encodeMs,
      peak: Math.round(peak * 100) / 100
    };
  }

  /** Detaches the audio graph and releases the microphone. */
  release() {
    try { if (this.processor) this.processor.onaudioprocess = null; } catch (err) { /* ignore */ }
    try { if (this.source) this.source.disconnect(); } catch (err) { /* ignore */ }
    try { if (this.processor) this.processor.disconnect(); } catch (err) { /* ignore */ }
    try { if (this.sink) this.sink.disconnect(); } catch (err) { /* ignore */ }
    try { if (this.stream) this.stream.getTracks().forEach((track) => track.stop()); } catch (err) { /* ignore */ }
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.sink = null;
    this.ctx = null;
  }

  async cancel() {
    if (!this.recording) return;
    this.recording = false;
    window.clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    this.release();
    try { if (ctx && ctx.state !== 'closed') await ctx.close(); } catch (err) { /* ignore */ }
    this.chunks = [];
    this.sampleCount = 0;
  }
}
