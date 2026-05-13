import { errLikeToLogString } from './errLikeToLogString';
import { meshcoreIsSyntheticPlaceholderPubKeyHex } from './meshcoreUtils';

/** Ed25519 / MeshCore identity public key length in bytes (32-byte raw pubkey, 64 hex chars). */
export const MESHCORE_PUBLIC_KEY_LENGTH = 32;

/** JWT `exp` offset from `iat` for {@link generateLetsMeshAuthToken} (1 hour). */
const TOKEN_EXPIRY_SECONDS = 3600;

/** localStorage key for MeshCore keys used by LetsMesh / device-signing MQTT JWT (Radio import or radio export). */
export const MESHCORE_IDENTITY_STORAGE_KEY = 'mesh-client:meshcoreIdentity';

/** localStorage key for the safeStorage-encrypted private key (base64 ciphertext). */
export const MESHCORE_ENC_PK_KEY = 'mesh-client:meshcoreIdentityEncPK';

/** US LetsMesh broker (WebSocket TLS on 443). */
export const LETSMESH_HOST_US = 'mqtt-us-v1.letsmesh.net';
/** EU LetsMesh broker (WebSocket TLS on 443). */
export const LETSMESH_HOST_EU = 'mqtt-eu-v1.letsmesh.net';
/** MeshMapper broker (WebSocket TLS on 443). */
export const MESHMAPPER_HOST = 'mqtt.meshmapper.cc';
/** Colorado Mesh broker (WebSocket, TLS enabled, port 1883). */
export const COLORADO_MESH_HOST = 'mqtt.meshcore.coloradomesh.org';

/** @deprecated Use {@link LETSMESH_HOST_US} */
export const LETSMESH_HOST = LETSMESH_HOST_US;

/** All device-signing MQTT brokers (WebSocket TLS on 443, JWT auth). */
const DEVICE_SIGNING_HOSTS = new Set([
  LETSMESH_HOST_US,
  LETSMESH_HOST_EU,
  MESHMAPPER_HOST,
  COLORADO_MESH_HOST,
]);

export function isLetsMeshSettings(server: string): boolean {
  return DEVICE_SIGNING_HOSTS.has(server.trim());
}

/**
 * JWT `aud` for `createAuthToken`: trimmed MQTT server hostname (must match broker
 * `AUTH_EXPECTED_AUDIENCE` when set). Public LetsMesh US/EU use the regional broker host
 * (`mqtt-us-v1.letsmesh.net`, `mqtt-eu-v1.letsmesh.net`), matching common tooling such as
 * meshcoretomqtt. If an operator uses a different audience, use Custom MQTT with a manually
 * generated token.
 */
export function letsMeshJwtAudience(serverHost: string): string {
  return serverHost.trim();
}

function meshcorePubKeyBytesToHexLower(pub: Uint8Array): string {
  return Array.from(pub, (b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
}

/**
 * After a MeshCore radio connects, persist identity from firmware export so LetsMesh MQTT can sign
 * JWTs without a separate JSON import (same storage shape as RadioPanel config import).
 *
 * Private key is stored encrypted via Electron safeStorage when available; falls back to
 * plaintext localStorage on platforms without an OS keychain (e.g. Linux without keyring).
 *
 * Both `publicKey` and `privateKeyBytes` allow `null` and `undefined` so callers can pass through
 * MeshCore export results without branching: e.g. `coerceMeshcoreExportPrivateKeyResult` returns
 * `null` on failure, while `getSelfInfo` may omit keys until the device is ready.
 *
 * @returns true if storage was updated.
 */
export async function tryPersistMeshcoreIdentityFromRadioExport(
  publicKey: Uint8Array | null | undefined,
  privateKeyBytes: Uint8Array | null | undefined,
): Promise<boolean> {
  if (publicKey?.length !== MESHCORE_PUBLIC_KEY_LENGTH) return false;
  const pubHex = meshcorePubKeyBytesToHexLower(publicKey);
  if (meshcoreIsSyntheticPlaceholderPubKeyHex(pubHex)) return false;
  const fullSkLen = MESHCORE_PUBLIC_KEY_LENGTH * 2;
  if (
    !privateKeyBytes ||
    (privateKeyBytes.length !== MESHCORE_PUBLIC_KEY_LENGTH && privateKeyBytes.length !== fullSkLen)
  ) {
    return false;
  }
  try {
    const privArray = Array.from(privateKeyBytes);
    const ciphertext = await window.electronAPI.safeStorage.encrypt(JSON.stringify(privArray));
    if (ciphertext !== null) {
      localStorage.setItem(
        MESHCORE_IDENTITY_STORAGE_KEY,
        JSON.stringify({ public_key: Array.from(publicKey) }),
      );
      localStorage.setItem(MESHCORE_ENC_PK_KEY, ciphertext);
    } else {
      // safeStorage unavailable — store plaintext as before
      localStorage.setItem(
        MESHCORE_IDENTITY_STORAGE_KEY,
        JSON.stringify({ public_key: Array.from(publicKey), private_key: privArray }),
      );
    }
    window.dispatchEvent(new Event('meshclient:meshcoreIdentityUpdated'));
    return true;
  } catch (err) {
    // Still return false (no partial identity write); log for safeStorage / quota / private mode.
    console.warn(
      '[letsMeshJwt] tryPersistMeshcoreIdentityFromRadioExport failed ' + errLikeToLogString(err),
    );
    return false;
  }
}

/** Returns true if a private key exists (encrypted or plaintext), without decrypting it. */
export function meshcoreIdentityHasPrivateKey(): boolean {
  try {
    if (localStorage.getItem(MESHCORE_ENC_PK_KEY) !== null) return true;
    const raw = localStorage.getItem(MESHCORE_IDENTITY_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { private_key?: unknown };
    return parsed.private_key != null;
  } catch {
    // catch-no-log-ok
    return false;
  }
}

/**
 * Async version of readMeshcoreIdentity that decrypts the private key from safeStorage when
 * available, or falls back to the plaintext value stored in localStorage.
 */
export async function readMeshcoreIdentityAsync(): Promise<{
  private_key?: string | number[];
  public_key?: string | number[];
} | null> {
  const base = readMeshcoreIdentity();
  if (!base) return null;
  const ciphertext = localStorage.getItem(MESHCORE_ENC_PK_KEY);
  if (ciphertext !== null) {
    try {
      const plaintext = await window.electronAPI.safeStorage.decrypt(ciphertext);
      if (plaintext !== null) {
        const private_key = JSON.parse(plaintext) as number[];
        return { ...base, private_key };
      }
    } catch {
      // catch-no-log-ok safeStorage decrypt failed — fall through to plaintext path
    }
  }
  return base;
}

// Read the identity cached by RadioPanel after a config-file import.
export function readMeshcoreIdentity(): {
  private_key?: string | number[];
  public_key?: string | number[];
} | null {
  try {
    const raw = localStorage.getItem(MESHCORE_IDENTITY_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { private_key?: string | number[]; public_key?: string | number[] };
  } catch {
    // catch-no-log-ok localStorage read — non-critical identity cache; returns null on any parse error
    return null;
  }
}

/** MQTT username for MeshCore MQTT brokers: `v1_` + 64 hex chars (uppercase) public key. */
export function letsMeshMqttUsernameFromIdentity(
  identity: {
    public_key?: string | number[];
  } | null,
): string | null {
  const pk = normalizePublicKeyHex(identity?.public_key);
  if (!pk) return null;
  return `v1_${pk.toUpperCase()}`;
}

function normalizePublicKeyHex(publicKey: string | number[] | undefined): string | null {
  if (!publicKey) return null;
  if (Array.isArray(publicKey)) {
    if (publicKey.length < MESHCORE_PUBLIC_KEY_LENGTH) return null;
    return Array.from(publicKey.slice(0, MESHCORE_PUBLIC_KEY_LENGTH))
      .map((b: number) => (b & 0xff).toString(16).padStart(2, '0'))
      .join('');
  }
  const raw = publicKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return raw.toLowerCase();
  try {
    const s = raw.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s);
    if (bin.length === MESHCORE_PUBLIC_KEY_LENGTH) {
      return Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // catch-no-log-ok base64 decode attempt for public key
  }
  return null;
}

/**
 * 64-byte orlp/MeshCore private key as lowercase hex (128 chars), for createAuthToken.
 * MeshCore NaCl-style extended secret = 32-byte seed || 32-byte public key when only a seed is stored.
 */
function meshcoreOrlpPrivateKeyHex(
  privateKey: string | number[] | undefined,
  publicKeyHex: string | null,
): string | null {
  if (!publicKeyHex) return null;
  const fullSkLen = MESHCORE_PUBLIC_KEY_LENGTH * 2;
  if (Array.isArray(privateKey)) {
    if (privateKey.length >= fullSkLen) {
      return Array.from(privateKey.slice(0, fullSkLen))
        .map((b: number) => (b & 0xff).toString(16).padStart(2, '0'))
        .join('');
    }
    if (privateKey.length >= MESHCORE_PUBLIC_KEY_LENGTH) {
      const seed = Array.from(privateKey.slice(0, MESHCORE_PUBLIC_KEY_LENGTH))
        .map((b: number) => (b & 0xff).toString(16).padStart(2, '0'))
        .join('');
      return seed + publicKeyHex;
    }
    return null;
  }
  const s = (typeof privateKey === 'string' ? privateKey : '').trim().replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{128}$/.test(s)) return s.toLowerCase();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase() + publicKeyHex;
  return null;
}

/**
 * Generate a LetsMesh MQTT password token compatible with meshcore-mqtt-broker / verifyAuthToken.
 * Uses {@link letsMeshJwtAudience} for `aud`.
 * @returns Object with the JWT token and expiration timestamp (epoch ms).
 */
export async function generateLetsMeshAuthToken(
  identity: { private_key?: string | number[]; public_key?: string | number[] },
  serverHost: string,
): Promise<{ token: string; expiresAt: number }> {
  const pub = normalizePublicKeyHex(identity.public_key);
  const priv = meshcoreOrlpPrivateKeyHex(identity.private_key, pub);
  if (!pub) throw new Error('LetsMesh auth: public key missing or invalid');
  if (!priv) throw new Error('LetsMesh auth: private key missing or invalid');
  const { createAuthToken } = await import('@michaelhart/meshcore-decoder');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_EXPIRY_SECONDS;
  const aud = letsMeshJwtAudience(serverHost);
  const token = await createAuthToken(
    {
      publicKey: pub.toUpperCase(),
      aud,
      iat: now,
      exp,
    },
    priv,
    pub,
  );
  return { token, expiresAt: exp * 1000 };
}
