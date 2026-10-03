import { describe, expect, it } from 'vitest';

import {
  buildMeshcoreChannelAddUri,
  classifyMeshClientDeepLink,
} from '@/shared/meshClientDeepLink';

import { FLOOD_SCOPE_OVERRIDE_UNSCOPED } from './chatPanelProtocolStorage';
import {
  effectiveMeshcoreChannelScope,
  meshcoreChannelScopeKey,
  meshcoreScopeOverrideForQr,
  meshcoreScopeOverrideFromQr,
} from './meshcoreChannelScope';

const radioA = 'meshcore:pk:' + 'a'.repeat(64);
const radioB = 'meshcore:pk:' + 'b'.repeat(64);
const channel = { index: 1, name: 'Metro', secret: new Uint8Array(16).fill(12) };

describe('channel scope identity', () => {
  it('retains a scope on reconnect but isolates another radio and reused channel slots', () => {
    const key = meshcoreChannelScopeKey(radioA, channel)!;
    expect(meshcoreChannelScopeKey(radioA, { ...channel })).toBe(key);
    expect(key).not.toBe('ch:1');
    for (const otherKey of [
      meshcoreChannelScopeKey(radioB, channel),
      meshcoreChannelScopeKey(radioA, { ...channel, name: 'New' }),
      meshcoreChannelScopeKey(radioA, { ...channel, secret: new Uint8Array(16).fill(13) }),
    ])
      expect(otherKey).not.toBe(key);
    expect(key).not.toContain('0c'.repeat(16));
  });

  it('waits for full radio identity and valid channel key metadata', () => {
    expect(meshcoreChannelScopeKey(undefined, channel)).toBeNull();
    expect(meshcoreChannelScopeKey('meshcore:tcp:localhost', channel)).toBeNull();
    expect(meshcoreChannelScopeKey(radioA, { index: 1, name: 'Metro' })).toBeNull();
  });
});

describe('channel scope QR compatibility', () => {
  it.each(['', FLOOD_SCOPE_OVERRIDE_UNSCOPED, '#metro', '#us-co/denver'])(
    'roundtrips %s',
    (override) => {
      const uri = buildMeshcoreChannelAddUri({
        name: channel.name,
        secretHex: '0c'.repeat(16),
        ...meshcoreScopeOverrideForQr(override),
      });
      const parsed = classifyMeshClientDeepLink(uri);
      expect(parsed.kind).toBe('meshcoreChannelAdd');
      if (parsed.kind !== 'meshcoreChannelAdd') throw new Error('unexpected QR kind');
      expect(meshcoreScopeOverrideFromQr(parsed.regionScope)).toBe(override);
      expect(uri.includes('region_scope=')).toBe(override.startsWith('#'));
      expect(uri.includes('mesh_client_scope=unscoped')).toBe(
        override === FLOOD_SCOPE_OVERRIDE_UNSCOPED,
      );
    },
  );

  it('keeps standard named scopes and unknown extensions compatible', () => {
    const uri = buildMeshcoreChannelAddUri({
      name: 'Metro',
      secretHex: '0c'.repeat(16),
      regionScope: 'NA',
    });
    const parsed = classifyMeshClientDeepLink(uri + '&mesh_client_scope=future');
    expect(parsed).toMatchObject({ kind: 'meshcoreChannelAdd', regionScope: 'NA' });
    expect(meshcoreScopeOverrideFromQr('NA')).toBe('#NA');
    expect(meshcoreScopeOverrideFromQr('*')).toBe('#*');
  });

  it('lets explicit app Unscoped win if a URI contains both fields', () => {
    const uri = buildMeshcoreChannelAddUri({
      name: 'Metro',
      secretHex: '0c'.repeat(16),
      regionScope: '#metro',
      unscoped: true,
    });
    expect(uri).not.toContain('region_scope');
    expect(classifyMeshClientDeepLink(uri + '&region_scope=%23metro')).toMatchObject({
      regionScope: '',
    });
  });

  it('distinguishes Default from Unscoped when Radio has a named default', () => {
    expect(effectiveMeshcoreChannelScope('', '#us-co')).toBe('#us-co');
    expect(effectiveMeshcoreChannelScope(FLOOD_SCOPE_OVERRIDE_UNSCOPED, '#us-co')).toBe('');
    expect(effectiveMeshcoreChannelScope('#metro', '#us-co')).toBe('#metro');
  });
});
