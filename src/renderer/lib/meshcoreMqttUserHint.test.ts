import { describe, expect, it } from 'vitest';

import { meshcoreMqttUserFacingHint } from './meshcoreMqttUserHint';

describe('meshcoreMqttUserFacingHint', () => {
  it('appends auth hint for Not authorized', () => {
    const out = meshcoreMqttUserFacingHint('Connection refused: Not authorized');
    expect(out).toContain('letsmesh-mqtt-auth.md');
    expect(out).toContain('Connection refused: Not authorized');
    expect(out).toContain('JWT audience');
  });

  it('appends network hint for ECONNREFUSED', () => {
    const out = meshcoreMqttUserFacingHint('connect ECONNREFUSED');
    expect(out).toContain('firewall');
  });

  it('appends transport hint for connect-phase timeout', () => {
    const out = meshcoreMqttUserFacingHint(
      'MeshCore MQTT: timed out before MQTT session (no CONNACK within 30s). …',
    );
    expect(out).toContain('IPv4');
    expect(out).toContain('CONNACK');
  });

  it('appends subscribe hint for Subscribe to … failed', () => {
    const out = meshcoreMqttUserFacingHint('Subscribe to msh/# failed: denied');
    expect(out).toContain('wildcard subscribe');
    expect(out).toContain('Subscribe to msh/# failed');
  });

  it('appends hint for keepalive timeout', () => {
    const out = meshcoreMqttUserFacingHint('Keepalive timeout');
    expect(out).toContain('MQTT pings');
    expect(out).toContain('Keepalive timeout');
  });

  it('passes through unrelated messages unchanged', () => {
    expect(meshcoreMqttUserFacingHint('Something else')).toBe('Something else');
  });
});
