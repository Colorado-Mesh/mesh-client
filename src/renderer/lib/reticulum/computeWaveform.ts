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
