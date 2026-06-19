import { Utils, verifyAuthToken } from '@michaelhart/meshcore-decoder';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  generateLetsMeshAuthToken,
  isLetsMeshSettings,
  LETSMESH_HOST_EU,
  LETSMESH_HOST_US,
  letsMeshJwtAudience,
  letsMeshMqttUsernameFromIdentity,
  MESHCORE_ENC_PK_KEY,
  MESHCORE_IDENTITY_STORAGE_KEY,
  MESHCORE_PUBLIC_KEY_LENGTH,
  meshcoreIdentityHasPrivateKey,
  MESHMAPPER_HOST,
  readMeshcoreIdentity,
  tryPersistMeshcoreIdentityFromRadioExport,
  tryPersistMeshcorePublicKeyFromRadio,
} from './letsMeshJwt';
import { meshcoreSyntheticPlaceholderPubKeyHex } from './meshcoreUtils';

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

  it('isLetsMeshSettings matches MeshMapper host', () => {
    expect(isLetsMeshSettings(MESHMAPPER_HOST)).toBe(true);
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
    const { token, expiresAt } = await generateLetsMeshAuthToken(identity, LETSMESH_HOST_US);
    expect(typeof expiresAt).toBe('number');
    expect(expiresAt).toBeGreaterThan(Date.now());
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
    const { token, expiresAt } = await generateLetsMeshAuthToken(identity, LETSMESH_HOST_EU);
    expect(typeof expiresAt).toBe('number');
    expect(expiresAt).toBeGreaterThan(Date.now());
    const verified = await verifyAuthToken(token, sampleKeyPair.publicKey);
    expect(verified).not.toBeNull();
    expect(verified?.aud).toBe(LETSMESH_HOST_EU);
  });

  it('tryPersistMeshcoreIdentityFromRadioExport stores NaCl-style seed for JWT path', async () => {
    const pub = Uint8Array.from(
      sampleKeyPair.publicKey.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    const seedHex = sampleKeyPair.privateKey.slice(0, 64);
    const priv = Uint8Array.from(seedHex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
    expect(await tryPersistMeshcoreIdentityFromRadioExport(pub, priv)).toBe(true);
    const id = readMeshcoreIdentity();
    expect(Array.isArray(id?.public_key)).toBe(true);
    expect((id?.public_key as number[]).length).toBe(MESHCORE_PUBLIC_KEY_LENGTH);
    // safeStorage mock returns null → plaintext fallback stores private_key in localStorage
    expect(Array.isArray(id?.private_key)).toBe(true);
    expect((id?.private_key as number[]).length).toBe(MESHCORE_PUBLIC_KEY_LENGTH);
    localStorage.removeItem(MESHCORE_IDENTITY_STORAGE_KEY);
    localStorage.removeItem(MESHCORE_ENC_PK_KEY);
  });

  it('tryPersistMeshcoreIdentityFromRadioExport persists full 64-byte private key', async () => {
    const pub = Uint8Array.from(
      sampleKeyPair.publicKey.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    const priv = Uint8Array.from(
      sampleKeyPair.privateKey.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    expect(await tryPersistMeshcoreIdentityFromRadioExport(pub, priv)).toBe(true);
    expect((readMeshcoreIdentity()?.private_key as number[]).length).toBe(64);
    localStorage.removeItem(MESHCORE_IDENTITY_STORAGE_KEY);
    localStorage.removeItem(MESHCORE_ENC_PK_KEY);
  });

  it('tryPersistMeshcoreIdentityFromRadioExport rejects synthetic placeholder pubkey', async () => {
    const hex = meshcoreSyntheticPlaceholderPubKeyHex(0xabc);
    const pub = Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    const priv = new Uint8Array(32).fill(1);
    expect(await tryPersistMeshcoreIdentityFromRadioExport(pub, priv)).toBe(false);
    expect(localStorage.getItem(MESHCORE_IDENTITY_STORAGE_KEY)).toBeNull();
  });

  it('tryPersistMeshcoreIdentityFromRadioExport rejects invalid private length', async () => {
    const pub = Uint8Array.from(
      sampleKeyPair.publicKey.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    const priv = new Uint8Array(16);
    expect(await tryPersistMeshcoreIdentityFromRadioExport(pub, priv)).toBe(false);
  });

  it('tryPersistMeshcoreIdentityFromRadioExport logs and returns false when safeStorage.encrypt throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const encrypt = vi.mocked(window.electronAPI.safeStorage.encrypt);
    encrypt.mockRejectedValueOnce(new Error('encrypt failed'));
    const pub = Uint8Array.from(
      sampleKeyPair.publicKey.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    const priv = Uint8Array.from(
      sampleKeyPair.privateKey.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    expect(await tryPersistMeshcoreIdentityFromRadioExport(pub, priv)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[letsMeshJwt] tryPersistMeshcoreIdentityFromRadioExport failed'),
    );
    expect(warnSpy.mock.calls[0]?.[0]).toContain('encrypt failed');
    encrypt.mockResolvedValue(null);
    warnSpy.mockRestore();
  });

  it('tryPersistMeshcorePublicKeyFromRadio stores public key only', () => {
    const pub = Uint8Array.from(
      sampleKeyPair.publicKey.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    expect(tryPersistMeshcorePublicKeyFromRadio(pub)).toBe(true);
    const id = readMeshcoreIdentity();
    expect((id?.public_key as number[]).length).toBe(MESHCORE_PUBLIC_KEY_LENGTH);
    expect(id?.private_key).toBeUndefined();
    localStorage.removeItem(MESHCORE_IDENTITY_STORAGE_KEY);
  });

  it('tryPersistMeshcorePublicKeyFromRadio clears stale private key when pubkey changes', async () => {
    const pubA = Uint8Array.from(
      sampleKeyPair.publicKey.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    const priv = Uint8Array.from(
      sampleKeyPair.privateKey.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    expect(await tryPersistMeshcoreIdentityFromRadioExport(pubA, priv)).toBe(true);
    expect(meshcoreIdentityHasPrivateKey()).toBe(true);

    const pubB = Uint8Array.from(pubA);
    pubB[0] = (pubB[0] + 1) & 0xff;
    expect(tryPersistMeshcorePublicKeyFromRadio(pubB)).toBe(true);
    expect(meshcoreIdentityHasPrivateKey()).toBe(false);
    localStorage.removeItem(MESHCORE_IDENTITY_STORAGE_KEY);
    localStorage.removeItem(MESHCORE_ENC_PK_KEY);
  });

  it('tryPersistMeshcorePublicKeyFromRadio rejects synthetic placeholder pubkey', () => {
    const hex = meshcoreSyntheticPlaceholderPubKeyHex(0xabc);
    const pub = Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    expect(tryPersistMeshcorePublicKeyFromRadio(pub)).toBe(false);
    expect(localStorage.getItem(MESHCORE_IDENTITY_STORAGE_KEY)).toBeNull();
  });
});
