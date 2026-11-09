/**
 * Minimal WAV (RIFF/PCM) toolkit.
 *
 * The browser recorder always produces 16-bit mono PCM WAV at 16 kHz, which is
 * exactly what the Azure Speech SDK wants. We still parse the header (instead
 * of trusting the client) so the SDK gets a correct AudioStreamFormat, and so
 * the researcher inspector can show the true audio duration.
 */

function findDataChunks(buffer) {
  if (buffer.length < 44) return null;
  const riff = buffer.toString('ascii', 0, 4);
  if (riff !== 'RIFF') return null;
  const wave = buffer.toString('ascii', 8, 12);
  if (wave !== 'WAVE') return null;

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > buffer.length) {
      // Truncated file: take what we have for the data chunk.
      if (id === 'data') return { fmt, data: buffer.subarray(body) };
      break;
    }
    if (id === 'fmt ' && size >= 16) {
      fmt = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        blockAlign: buffer.readUInt16LE(body + 12),
        bitsPerSample: buffer.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      data = buffer.subarray(body, body + size);
    }
    offset = body + size + (size % 2); // chunks are word aligned
  }
  if (!fmt || !data) return null;
  return { fmt, data };
}

function analyzePcm16(pcm) {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return { peak: 0, rms: 0 };
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    const value = pcm.readInt16LE(i * 2) / 32768;
    const abs = value < 0 ? -value : value;
    if (abs > peak) peak = abs;
    sum += value * value;
  }
  return { peak, rms: Math.sqrt(sum / samples) };
}

/**
 * Digital-silence floors. Deliberately far below soft / L1-accented speech
 * (a tentative utterance peaks around 0.002-0.02). Env-tunable for studies.
 */
const SILENCE_PEAK_THRESHOLD = Number(process.env.SILENCE_PEAK_THRESHOLD || 0.001);
const SILENCE_RMS_THRESHOLD = Number(process.env.SILENCE_RMS_THRESHOLD || 0.0002);

/**
 * @returns {{sampleRate:number, channels:number, bitsPerSample:number, pcm:Buffer,
 *   durationMs:number, format:string, peak:number, rms:number, silent:boolean}}
 */
function parseWav(buffer) {
  const parsed = findDataChunks(buffer);
  if (!parsed) {
    const err = new Error('Uploaded audio is not a readable PCM WAV file.');
    err.code = 'INVALID_WAV';
    throw err;
  }
  const { fmt, data } = parsed;
  const blockAlign = fmt.blockAlign || (fmt.channels * fmt.bitsPerSample) / 8;
  const frames = blockAlign > 0 ? Math.floor(data.length / blockAlign) : 0;
  const level = fmt.bitsPerSample === 16 ? analyzePcm16(data) : { peak: 1, rms: 1 };
  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    audioFormat: fmt.audioFormat,
    pcm: data,
    durationMs: fmt.sampleRate > 0 ? Math.round((frames / fmt.sampleRate) * 1000) : 0,
    format: `${fmt.bitsPerSample}-bit ${fmt.channels === 1 ? 'mono' : 'multi'} @ ${fmt.sampleRate} Hz`,
    peak: Math.round(level.peak * 10000) / 10000,
    rms: Math.round(level.rms * 100000) / 100000,
    // Only digital/room silence is short-circuited; soft accented speech passes.
    silent: fmt.bitsPerSample === 16
      && level.peak < SILENCE_PEAK_THRESHOLD
      && level.rms < SILENCE_RMS_THRESHOLD,
    silenceThresholds: {
      peak: SILENCE_PEAK_THRESHOLD,
      rms: SILENCE_RMS_THRESHOLD
    }
  };
}

/** Strips `data:audio/wav;base64,` prefixes and decodes to a Buffer. */
function decodeAudioPayload(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    const err = new Error('`audio` must be a base64-encoded WAV string.');
    err.code = 'INVALID_AUDIO';
    throw err;
  }
  const comma = raw.indexOf(',');
  const base64 = raw.startsWith('data:') && comma > -1 ? raw.slice(comma + 1) : raw;
  return Buffer.from(base64, 'base64');
}

module.exports = { parseWav, decodeAudioPayload };
