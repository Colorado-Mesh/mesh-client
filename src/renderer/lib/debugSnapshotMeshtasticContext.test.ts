// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES } from '@/shared/meshtasticDefaultPublicPsk';

import { buildDebugSnapshotMeshtasticContextFromRuntime } from './debugSnapshotMeshtasticContext';

describe('buildDebugSnapshotMeshtasticContextFromRuntime', () => {
  it('returns empty channel fields and null mqttChannelKeyEntryCount when configs are empty', () => {
    expect(buildDebugSnapshotMeshtasticContextFromRuntime([], [])).toEqual({
      channelPills: [],
      channelConfigsSummary: [],
      mqttChannelKeyEntryCount: null,
    });
  });

  it('maps channel pills and config summary including default-public PSK detection', () => {
    const ctx = buildDebugSnapshotMeshtasticContextFromRuntime(
      [
        { index: 0, name: 'Private' },
        { index: 1, name: 'LongFast' },
      ],
      [
        {
          index: 0,
          name: 'Private',
          role: 1,
          uplinkEnabled: true,
          psk: new Uint8Array(16).fill(9),
        },
        {
          index: 1,
          name: 'LongFast',
          role: 2,
          psk: MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES,
        },
      ],
    );

    expect(ctx.channelPills).toEqual([
      { index: 0, name: 'Private' },
      { index: 1, name: 'LongFast' },
    ]);
    expect(ctx.channelConfigsSummary).toHaveLength(2);
    expect(ctx.channelConfigsSummary[0]).toMatchObject({
      index: 0,
      uplinkEnabled: true,
      isDefaultPublicPsk: false,
    });
    expect(ctx.channelConfigsSummary[1]).toMatchObject({
      index: 1,
      uplinkEnabled: false,
      isDefaultPublicPsk: true,
    });
    expect(ctx.mqttChannelKeyEntryCount).toBeGreaterThan(0);
  });
});
