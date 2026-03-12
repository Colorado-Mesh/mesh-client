import type { MeshNode } from '../types';
import { snrMeaningfulForNodeDiagnostics } from './snrMeaningfulForNodeDiagnostics';

export interface RFDiagnosis {
  condition: string;
  cause: string;
  severity: 'warning' | 'info';
}

// Thresholds
const HIGH_CU = 25; // channel_utilization > 25%
const LOW_TX = 5; // air_util_tx < 5%
const LOW_SNR = 0; // snr < 0 dB (only used when snrMeaningfulForNodeDiagnostics)
const HIGH_BAD_RATE = 0.1; // > 10% of rx packets are bad
const SPIKE_BAD_RATE = 0.2; // > 20% — "spiking"
const HIGH_DUPE_RATE = 0.15; // > 15% of rx packets are dupes
const MIN_SAMPLE = 5; // minimum packet count for ratio checks

/**
 * Diagnose the connected node using LocalStats telemetry fields.
 * Returns an array of findings (may be empty = all clear).
 */
export function diagnoseConnectedNode(node: MeshNode): RFDiagnosis[] {
  const findings: RFDiagnosis[] = [];

  const cu = node.channel_utilization ?? 0;
  const tx = node.air_util_tx ?? 0;
  const rxBad = node.num_packets_rx_bad ?? 0;
  const rxDupe = node.num_rx_dupe ?? 0;
  const rxTotal = node.num_packets_rx ?? 0;

  const badRate = rxTotal > MIN_SAMPLE ? rxBad / rxTotal : 0;
  const dupeRate = rxTotal > MIN_SAMPLE ? rxDupe / rxTotal : 0;

  // 1. High CU + Low TX → noise floor / nearby busy node
  if (cu > HIGH_CU && tx < LOW_TX) {
    findings.push({
      condition: 'Utilization vs. TX',
      cause: 'High noise floor or nearby busy node; your node stays quiet to avoid collisions.',
      severity: 'warning',
    });
  }

  // 2. High CU + rx_bad = 0 → non-LoRa interference (channel busy but nothing decodeable is bad)
  if (cu > HIGH_CU && rxTotal > MIN_SAMPLE && rxBad === 0) {
    findings.push({
      condition: 'Non-LoRa Noise / RFI',
      cause: 'Interference from motors, baby monitors, leaky power lines, etc.',
      severity: 'warning',
    });
  }

  // 3. rx_bad spiking + channel_util spiking → bursty industrial interference
  if (badRate > SPIKE_BAD_RATE && cu > HIGH_CU) {
    findings.push({
      condition: '900MHz Industrial Interference',
      cause: 'Bursty high-power sources (Smart Meters, industrial telemetry, etc.).',
      severity: 'warning',
    });
  }

  // 4–5. SNR not used on connected node: node.snr is client-merged from mesh
  // packets (last-hop / arbitrary from), not LocalStats. badRate-only path is
  // covered by check 7 when not already covered by 3.

  // 6. High rx_duplicate → mesh congestion
  if (dupeRate > HIGH_DUPE_RATE) {
    findings.push({
      condition: 'Mesh Congestion',
      cause: 'Excessive redundant repeating of the same packets.',
      severity: 'warning',
    });
  }

  // 7. rx_bad general high count (catch-all if not already covered by checks 3/4/5)
  const badRateCovered = findings.some((f) => f.condition === '900MHz Industrial Interference');
  if (badRate > HIGH_BAD_RATE && !badRateCovered) {
    findings.push({
      condition: 'LoRa Collision or Corruption',
      cause: 'Preamble detected but CRC/decode failed (most often non-Meshtastic LoRa traffic).',
      severity: 'warning',
    });
  }

  return findings;
}

/** True if the connected node has enough LocalStats data to run full RF diagnostics. */
export function hasLocalStatsData(node: MeshNode): boolean {
  return node.num_packets_rx !== undefined || node.num_packets_rx_bad !== undefined;
}

/**
 * Diagnose another node using observed telemetry (channel_utilization, air_util_tx, snr).
 * Returns null if no telemetry is available for the node.
 */
export function diagnoseOtherNode(node: MeshNode): RFDiagnosis[] | null {
  if (node.channel_utilization == null && node.air_util_tx == null) return null;

  const findings: RFDiagnosis[] = [];
  const cu = node.channel_utilization ?? 0;
  const tx = node.air_util_tx ?? 0;
  const snrMeaningful = snrMeaningfulForNodeDiagnostics(node);
  const snr = node.snr ?? 0;

  // High CU + Low TX → external interference causing node to back off
  if (cu > HIGH_CU && tx < LOW_TX) {
    findings.push({
      condition: 'External Interference',
      cause: 'Nearby transmitter dominating the channel — your node backs off to avoid collisions.',
      severity: 'warning',
    });
  }

  // High CU + Low SNR → wideband noise floor (SNR only if direct RF context)
  if (snrMeaningful && cu > HIGH_CU && snr < LOW_SNR) {
    findings.push({
      condition: 'Wideband Noise Floor',
      cause:
        'Broadband interference (faulty electronics, power-line noise, etc.) elevating the noise floor.',
      severity: 'warning',
    });
  }

  // Low CU + Low SNR → fringe / weak coverage
  if (snrMeaningful && cu <= 10 && snr < LOW_SNR) {
    findings.push({
      condition: 'Fringe / Weak Coverage',
      cause: 'Node is too far away or poorly connected to the rest of the mesh.',
      severity: 'info',
    });
  }

  return findings;
}
