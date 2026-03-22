import { Utils, verifyAuthToken } from '@michaelhart/meshcore-decoder';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  generateLetsMeshAuthToken,
  isLetsMeshSettings,
  LETSMESH_HOST_EU,
  LETSMESH_HOST_US,
  letsMeshJwtAudience,
  letsMeshMqttUsernameFromIdentity,
} from './letsMeshJwt';

// Sample key pair from @michaelhart/meshcore-decoder tests (auth-token.test.ts)
const sampleKeyPair = {
  publicKey: '4852b69364572b52efa1b6bb3e6d0abed4f389a1cbfbb60a9bba2cce649caf0e',
  privateKey:
    '18469d6140447f77de13cd8d761e605431f52269fbff43b0925752ed9e6745435dc6a86d2568af8b70d3365db3f88234760c8ecc645ce469829bc45b65f1d5d5',
};

describe('letsMeshJwt', () => {
  beforeAll(async () => {
    await Utils.derivePublicKey(sampleKeyPair.privateKey);
  });

  it('letsMeshMqttUsernameFromIdentity uses v1_<uppercase public key>', () => {
    expect(
      letsMeshMqttUsernameFromIdentity({
        public_key: sampleKeyPair.publicKey,
      }),
    ).toBe(`v1_${sampleKeyPair.publicKey.toUpperCase()}`);
  });

  it('isLetsMeshSettings matches US and EU hosts', () => {
    expect(isLetsMeshSettings(LETSMESH_HOST_US)).toBe(true);
    expect(isLetsMeshSettings(LETSMESH_HOST_EU)).toBe(true);
    expect(isLetsMeshSettings('mqtt.example.com')).toBe(false);
  });

  it('letsMeshJwtAudience uses trimmed MQTT server hostname as aud', () => {
    expect(letsMeshJwtAudience(LETSMESH_HOST_US)).toBe(LETSMESH_HOST_US);
    expect(letsMeshJwtAudience(LETSMESH_HOST_EU)).toBe(LETSMESH_HOST_EU);
    expect(letsMeshJwtAudience(' mqtt.example.com ')).toBe('mqtt.example.com');
  });

  it('generateLetsMeshAuthToken produces verifyAuthToken-valid tokens (full private key)', async () => {
    const identity = {
      public_key: sampleKeyPair.publicKey,
      private_key: sampleKeyPair.privateKey,
    };
    const token = await generateLetsMeshAuthToken(identity, LETSMESH_HOST_US);
    const verified = await verifyAuthToken(token, sampleKeyPair.publicKey);
    expect(verified).not.toBeNull();
    expect(verified?.publicKey.toUpperCase()).toBe(sampleKeyPair.publicKey.toUpperCase());
    expect(verified?.aud).toBe(LETSMESH_HOST_US);
  });

  it('generateLetsMeshAuthToken works with 32-byte seed + public key (NaCl-style)', async () => {
    const seedOnly = sampleKeyPair.privateKey.slice(0, 64);
    const identity = {
      public_key: sampleKeyPair.publicKey,
      private_key: seedOnly,
    };
    const token = await generateLetsMeshAuthToken(identity, LETSMESH_HOST_EU);
    const verified = await verifyAuthToken(token, sampleKeyPair.publicKey);
    expect(verified).not.toBeNull();
    expect(verified?.aud).toBe(LETSMESH_HOST_EU);
  });
});
