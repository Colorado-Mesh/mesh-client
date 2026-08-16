/**
 * Compute a downsampled waveform from a Float32Array of audio samples.
 * Returns an array of N normalized peak values in [0, 1].
 */
export function computeWaveform(samples: Float32Array, barCount = 40): number[] {
  if (samples.length === 0 || barCount <= 0) {
    return new Array<number>(barCount).fill(0);
  }
  const chunkSize = Math.max(1, Math.floor(samples.length / barCount));
  const bars: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, samples.length);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(samples[j] ?? 0);
      if (abs > peak) peak = abs;
    }
    bars.push(peak);
  }
  const globalMax = bars.reduce((m, v) => (v > m ? v : m), 0);
  if (globalMax === 0) return bars.map(() => 0);
  return bars.map((v) => v / globalMax);
}

/**
 * Compute a waveform from a base64-encoded OggS blob using Web Audio decodeAudioData.
 * Resolves to null when decoding fails (unsupported codec, empty data, etc.).
 */
export async function computeWaveformFromOgg(
  dataBase64: string,
  barCount = 40,
): Promise<{ bars: number[]; durationSec: number } | null> {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  try {
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
    await ctx.close();
    const channelData = buffer.getChannelData(0);
    return {
      bars: computeWaveform(channelData, barCount),
      durationSec: buffer.duration,
    };
  } catch {
    // catch-no-log-ok: OggS decode may fail if the codec isn't supported — fall back to flat bars
    return null;
  }
}
