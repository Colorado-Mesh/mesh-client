/** Plain-text forms of trace route results, for copying into a message to someone else. */

const HOP_SEPARATOR = ` ${String.fromCodePoint(0x2192)} `;

/** Hops in order on one line, separated by arrows (Meshtastic traceroute, diagnostics). */
export function formatTraceRouteHops(hops: readonly string[]): string {
  return hops.join(HOP_SEPARATOR);
}

/** SNR as the trace views print it: sign, two decimals, dB. */
function formatTraceSnrDb(snr: number): string {
  return `${snr > 0 ? '+' : ''}${snr.toFixed(2)} dB`;
}

export interface MeshcoreTraceCopyHop {
  /** Resolved contact name, or the hash when nothing matched. */
  label: string;
  /** Path hash segment in hex. */
  hex: string;
  snr: number;
}

export interface MeshcoreTraceCopyInput {
  hops: readonly MeshcoreTraceCopyHop[];
  destLabel: string;
  /** SNR the destination heard the trace at. */
  lastSnr: number;
  /** Label for a hop with neither name nor hash; `n` is 1-based. */
  hopFallbackLabel?: (n: number) => string;
}

function meshcoreHopName(hop: MeshcoreTraceCopyHop, n: number, fallback?: (n: number) => string) {
  if (hop.label && hop.hex && hop.label !== hop.hex) return `${hop.label} [${hop.hex}]`;
  return hop.label || hop.hex || fallback?.(n) || String(n);
}

/** MeshCore path trace: each hop with its hash and SNR, then the destination and its SNR. */
export function formatMeshcoreTraceRoute(input: MeshcoreTraceCopyInput): string {
  const parts: string[] = [];
  input.hops.forEach((hop, i) => {
    parts.push(
      `${meshcoreHopName(hop, i + 1, input.hopFallbackLabel)} ${formatTraceSnrDb(hop.snr)}`,
    );
  });
  parts.push(`${input.destLabel} ${formatTraceSnrDb(input.lastSnr)}`);
  return parts.join(HOP_SEPARATOR);
}
