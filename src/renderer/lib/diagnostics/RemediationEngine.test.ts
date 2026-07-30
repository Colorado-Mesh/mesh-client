import { describe, expect, it } from 'vitest';

import type { MeshNode } from '../types';
import { getRecommendedAction, getRecommendedActionForRfCondition } from './RemediationEngine';

function baseNode(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 0x1,
    long_name: 'N',
    short_name: 'N',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
    hops_away: 0,
    ...overrides,
  };
}

describe('getRecommendedActionForRfCondition', () => {
  it('returns a remedy for every known RF condition', () => {
    const known = [
      'Utilization vs. TX',
      'Non-LoRa Noise / RFI',
      '900MHz Industrial Interference',
      'Channel Utilization Spike',
      'Mesh Congestion',
      'Hidden Terminal Risk',
      'LoRa Collision or Corruption',
      'External Interference',
      'Wideband Noise Floor',
      'Fringe / Weak Coverage',
      'Elevated Noise Floor',
      'Excessive Flooding',
      'High Companion TX Queue',
    ];
    for (const condition of known) {
      const result = getRecommendedActionForRfCondition(condition);
      expect(result, `expected remedy for "${condition}"`).not.toBeNull();
      expect(result!.titleKey).toMatch(/^diagnosticsPanel\.remedyRf\./);
    }
  });

  it('returns null for an unknown condition', () => {
    expect(getRecommendedActionForRfCondition('Unknown Condition XYZ')).toBeNull();
  });
});

describe('getRecommendedAction', () => {
  const homeNode = baseNode({
    node_id: 0xffff,
    latitude: 37.0,
    longitude: -122.0,
  });

  it('returns null when no scenario matches', () => {
    const node = baseNode({ snr: 5, hops_away: 1, latitude: 37.001, longitude: -122.001 });
    expect(getRecommendedAction(node, homeNode, undefined)).toBeNull();
  });

  it('Scenario D: MQTT Ghost — 0 hops but >20 mi away', () => {
    // ~36 miles from home
    const node = baseNode({
      hops_away: 0,
      latitude: 37.5,
      longitude: -122.0,
    });
    const result = getRecommendedAction(node, homeNode, undefined);
    expect(result).not.toBeNull();
    expect(result!.titleKey).toBe('diagnosticsPanel.remedyScenario.mqttGhostTitle');
  });

  it('Scenario B2: mid-range duplication suggests MQTT/RF overlap when close', () => {
    // Very close node (< ~1 km)
    const node = baseNode({
      hops_away: 2,
      snr: 0,
      latitude: 37.0005,
      longitude: -122.0005,
    });
    const result = getRecommendedAction(node, homeNode, { total: 100, duplicates: 40 });
    expect(result).not.toBeNull();
    expect(result!.titleKey).toBe('diagnosticsPanel.remedyScenario.mqttRfOverlapTitle');
  });

  it('Scenario B: high duplication (>=50%) close in triggers interference remedy', () => {
    const node = baseNode({
      hops_away: 2,
      snr: 0,
      latitude: 37.0005,
      longitude: -122.0005,
    });
    const result = getRecommendedAction(node, homeNode, { total: 100, duplicates: 55 });
    expect(result).not.toBeNull();
    expect(result!.titleKey).toBe('diagnosticsPanel.remedyScenario.duplicateInterferenceTitle');
  });

  it('returns null when homeNode is null', () => {
    const node = baseNode({ hops_away: 5, snr: 10 });
    expect(getRecommendedAction(node, null, { total: 100, duplicates: 60 })).toBeNull();
  });

  it('returns null when packetStats total is 0', () => {
    const node = baseNode({ hops_away: 2, latitude: 37.0005, longitude: -122.0005 });
    expect(getRecommendedAction(node, homeNode, { total: 0, duplicates: 0 })).toBeNull();
  });
});
