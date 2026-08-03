import { describe, expect, it } from 'vitest';

import { meshcoreUserMessageKey } from './meshcore/meshcoreMessageI18n';
import { meshcoreMqttUserFacingHint } from './meshcoreMqttUserHint';

describe('meshcoreMqttUserFacingHint', () => {
  it('returns prefixed auth hint key for Not authorized', () => {
    const out = meshcoreMqttUserFacingHint('Connection refused: Not authorized');
    expect(out).toEqual({
      type: 'prefixed',
      message: 'Connection refused: Not authorized',
      hintKey: 'meshcore.mqttHints.notAuthorized',
    });
  });

  it('returns network hint key for ECONNREFUSED', () => {
    const out = meshcoreMqttUserFacingHint('connect ECONNREFUSED');
    expect(meshcoreUserMessageKey(out)).toBe('meshcore.mqttHints.network');
  });

  it('returns transport hint key for connect-phase timeout', () => {
    const out = meshcoreMqttUserFacingHint(
      'MeshCore MQTT: timed out before MQTT session (no CONNACK within 30s). …',
    );
    expect(meshcoreUserMessageKey(out)).toBe('meshcore.mqttHints.connackTimeout');
  });

  it('returns subscribe hint key for Subscribe to … failed', () => {
    const out = meshcoreMqttUserFacingHint('Subscribe to msh/# failed: denied');
    expect(meshcoreUserMessageKey(out)).toBe('meshcore.mqttHints.subscribeFailed');
  });

  it('returns keepalive hint key for keepalive timeout', () => {
    const out = meshcoreMqttUserFacingHint('Keepalive timeout');
    expect(meshcoreUserMessageKey(out)).toBe('meshcore.mqttHints.keepalive');
  });

  it('returns tlsHandshake hint for EPROTO / TLSV1_ALERT_INTERNAL_ERROR', () => {
    const out = meshcoreMqttUserFacingHint(
      'write EPROTO 30458176:error:10000438:SSL routines:OPENSSL_internal:TLSV1_ALERT_INTERNAL_ERROR:../../third_party/boringssl/src/ssl/tls_record.cc:486:SSL alert number 80',
    );
    expect(meshcoreUserMessageKey(out)).toBe('meshcore.mqttHints.tlsHandshake');
  });

  it('passes through unrelated messages unchanged', () => {
    expect(meshcoreMqttUserFacingHint('Something else')).toBe('Something else');
  });
});
