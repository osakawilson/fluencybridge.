/**
 * WAV helpers. Azure Pronunciation Assessment needs PCM, and MediaRecorder
 * only produces WebM/Opus in Chrome, so we capture raw Float32 samples with
 * the Web Audio API, downsample to 16 kHz mono and encode a RIFF/WAVE file.
 */

export const TARGET_SAMPLE_RATE = 16000;

/** Box-average downsampling (cheap anti-aliasing) to the target rate. */
export function downsample(input, inputRate, outputRate = TARGET_SAMPLE_RATE) {
  if (!input || input.length === 0) return new Float32Array(0);
  if (outputRate >= inputRate) return input;
  const ratio = inputRate / outputRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

/** Concatenates recorded Float32 chunks into one buffer. */
export function mergeChunks(chunks, totalSamples) {
  const length = totalSamples || chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged;
}

/** 16-bit PCM WAV (little endian) from normalised Float32 samples. */
export function encodeWav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);       // PCM chunk size
  view.setUint16(20, 1, true);        // format = PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true);              // block align
  view.setUint16(34, 16, true);       // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([view], { type: 'audio/wav' });
}

/** base64 (no data: prefix) for JSON transport. */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma > -1 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read the recording.'));
    reader.readAsDataURL(blob);
  });
}

export function formatClock(ms) {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}
