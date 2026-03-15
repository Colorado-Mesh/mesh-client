import type { ProtocolCapabilities } from '../radio/BaseRadioProvider';
import type { MeshNode } from '../types';
import { snrMeaningfulForNodeDiagnostics } from './snrMeaningfulForNodeDiagnostics';

export interface RFDiagnosis {
  condition: string;
  cause: string;
  severity: 'warning' | 'info';
  /** When true, SNR-based interpretation is last-hop only (remote nodes). */
  isLastHop?: boolean;
  /** Extra lines under cause (template-only; render muted in UI). */
  hints?: string[];
}

/** 24h CU history stats from diagnosticsStore.getCuStats24h */
export interface CuStats24h {
  average: number;
  sampleCount: number;
  spanMs: number;
}

export interface ConnectedNodeDiagnosticContext {
  cuStats24h?: CuStats24h | null;
  capabilities?: ProtocolCapabilities;
}

/** Same CU spike context for any node_id with cuHistory */
export interface OtherNodeDiagnosticContext {
  cuStats24h?: CuStats24h | null;
  capabilities?: ProtocolCapabilities;
}

// Thresholds
const HIGH_CU = 25; // channel_utilization > 25%
const LOW_TX = 5; // air_util_tx < 5%
const LOW_SNR = 0; // snr < 0 dB (only used when snrMeaningfulForNodeDiagnostics)
const HIGH_BAD_RATE = 0.1; // > 10% of rx packets are bad
const SPIKE_BAD_RATE = 0.2; // > 20% — "spiking"
const HIGH_DUPE_RATE = 0.15; // > 15% of rx packets are dupes
const MIN_SAMPLE = 5; // minimum packet count for ratio checks
const HIDDEN_TERMINAL_CU = 40;
// Hidden Terminal: moderate bad band only — skip if industrial present; ≤ HIGH_BAD_RATE avoids duplicating collision catch-all (Risk 2)
const HIDDEN_TERMINAL_BAD_MIN = 0.05;

// CU spike gates (Risk 1)
const MIN_CU_SAMPLES = 12;
const MIN_CU_SPAN_MS = 30 * 60 * 1000; // 30 min
const MIN_CU_AVERAGE = 1; // percent — below this baseline is too noisy for 2× rule
const CU_SPIKE_COOLDOWN_MS = 15 * 60 * 1000; // Risk 1-D: suppress repeat spike for same node

const cuSpikeLastFired = new Map<number, number>();

/** Call when diagnostics are cleared so spike can fire again after reconnect */
export function resetCuSpikeCooldown(): void {
  cuSpikeLastFired.clear();
}

/**
 * If current CU is more than double the 24h average, return a finding.
 * Returns null when gates fail (insufficient history).
 * Cooldown: after firing for nodeId, suppress re-fire until cooldown elapses unless currentCu dropped back to or below average.
 */
export function detectCuSpike(
  currentCu: number,
  stats: CuStats24h | null | undefined,
  nodeId?: number,
): RFDiagnosis | null {
  if (!stats || stats.sampleCount < MIN_CU_SAMPLES) return null;
  if (stats.spanMs < MIN_CU_SPAN_MS) return null;
  if (stats.average < MIN_CU_AVERAGE) return null;
  if (currentCu <= 2 * stats.average) return null;
  if (nodeId != null) {
    const last = cuSpikeLastFired.get(nodeId);
    if (last != null && Date.now() - last < CU_SPIKE_COOLDOWN_MS && currentCu > stats.average) {
      return null;
    }
    cuSpikeLastFired.set(nodeId, Date.now());
  }
  return {
    condition: 'Channel Utilization Spike',
    cause: `Current ${currentCu.toFixed(0)}% is over 2× the recent average (${stats.average.toFixed(1)}%) — possible congestion or interference surge.`,
    severity: 'warning',
  };
}

/**
 * Diagnose the connected node using LocalStats telemetry fields.
 * Optional context: CU spike (needs 24h history), Mesh Congestion hints from path mix.
 * Returns [] immediately when the protocol does not provide RF stats (e.g. MeshCore).
 */
export function diagnoseConnectedNode(
  node: MeshNode,
  context?: ConnectedNodeDiagnosticContext,
): RFDiagnosis[] {
  if (context?.capabilities?.hasRfStats === false) return [];
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

  // 2. High CU + rx_bad = 0 → non-LoRa interference
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

  // CU spike vs 24h average (after baseline checks; uses same cu)
  const cuSpike = detectCuSpike(cu, context?.cuStats24h ?? null, node.node_id);
  if (cuSpike) findings.push(cuSpike);

  // 6. High rx_duplicate → mesh congestion (detail shown once in node detail UI, not duplicated as hints here)
  if (dupeRate > HIGH_DUPE_RATE) {
    findings.push({
      condition: 'Mesh Congestion',
      cause: 'Excessive redundant repeating of the same packets.',
      severity: 'warning',
    });
  }

  // Hidden Terminal: CU > 40% + moderate bad rate only; skip if industrial present; stay ≤10% so collision block remains catch-all above that
  const industrialPresent = findings.some((f) => f.condition === '900MHz Industrial Interference');
  if (
    cu > HIDDEN_TERMINAL_CU &&
    rxTotal > MIN_SAMPLE &&
    badRate > HIDDEN_TERMINAL_BAD_MIN &&
    badRate <= HIGH_BAD_RATE &&
    !industrialPresent
  ) {
    findings.push({
      condition: 'Hidden Terminal Risk',
      cause:
        'High channel load with elevated decode failures — concurrent transmitters may not hear each other, increasing collisions at your node.',
      severity: 'warning',
    });
  }

  // 7. rx_bad general high count (catch-all)
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
 * SNR-based findings set isLastHop when interpretation is last-hop only.
 * Optional context: CU spike when cuHistory exists for this node_id.
 * Returns null immediately when the protocol does not provide RF stats (e.g. MeshCore).
 */
export function diagnoseOtherNode(
  node: MeshNode,
  context?: OtherNodeDiagnosticContext,
): RFDiagnosis[] | null {
  if (context?.capabilities?.hasRfStats === false) return null;
  if (node.channel_utilization == null && node.air_util_tx == null) return null;

  const findings: RFDiagnosis[] = [];
  const cu = node.channel_utilization ?? 0;
  const tx = node.air_util_tx ?? 0;
  const snrMeaningful = snrMeaningfulForNodeDiagnostics(node, context?.capabilities);
  const snr = node.snr ?? 0;

  if (cu > HIGH_CU && tx < LOW_TX) {
    findings.push({
      condition: 'External Interference',
      cause: 'Nearby transmitter dominating the channel — your node backs off to avoid collisions.',
      severity: 'warning',
    });
  }

  const cuSpike = detectCuSpike(cu, context?.cuStats24h ?? null, node.node_id);
  if (cuSpike) findings.push(cuSpike);

  // SNR only when meaningful (0-hop RF) — still last-hop into client; label for clarity
  if (snrMeaningful && cu > HIGH_CU && snr < LOW_SNR) {
    findings.push({
      condition: 'Wideband Noise Floor',
      cause:
        'Broadband interference (faulty electronics, power-line noise, etc.) elevating the noise floor.',
      severity: 'warning',
      isLastHop: true,
    });
  }

  if (snrMeaningful && cu <= 10 && snr < LOW_SNR) {
    findings.push({
      condition: 'Fringe / Weak Coverage',
      cause: 'Node is too far away or poorly connected to the rest of the mesh.',
      severity: 'info',
      isLastHop: true,
    });
  }

  return findings;
}
