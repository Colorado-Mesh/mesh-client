/** US LetsMesh broker (WebSocket TLS on 443). */
export const LETSMESH_HOST_US = 'mqtt-us-v1.letsmesh.net';
/** EU LetsMesh broker (WebSocket TLS on 443). */
export const LETSMESH_HOST_EU = 'mqtt-eu-v1.letsmesh.net';

/** @deprecated Use {@link LETSMESH_HOST_US} */
export const LETSMESH_HOST = LETSMESH_HOST_US;

const LETSMESH_HOSTS = new Set([LETSMESH_HOST_US, LETSMESH_HOST_EU]);

export function isLetsMeshSettings(server: string): boolean {
  return LETSMESH_HOSTS.has(server.trim());
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

// Read the identity cached by RadioPanel after a config-file import.
export function readMeshcoreIdentity(): {
  private_key?: string | number[];
  public_key?: string | number[];
} | null {
  try {
    const raw = localStorage.getItem('mesh-client:meshcoreIdentity');
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
    if (publicKey.length < 32) return null;
    return Array.from(publicKey.slice(0, 32))
      .map((b) => Number(b).toString(16).padStart(2, '0'))
      .join('');
  }
  const raw = String(publicKey).trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return raw.toLowerCase();
  try {
    const s = raw.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s);
    if (bin.length === 32) {
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
  if (Array.isArray(privateKey)) {
    if (privateKey.length >= 64) {
      return Array.from(privateKey.slice(0, 64))
        .map((b) => Number(b).toString(16).padStart(2, '0'))
        .join('');
    }
    if (privateKey.length >= 32) {
      const seed = Array.from(privateKey.slice(0, 32))
        .map((b) => Number(b).toString(16).padStart(2, '0'))
        .join('');
      return seed + publicKeyHex;
    }
    return null;
  }
  const s = String(privateKey ?? '')
    .trim()
    .replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{128}$/.test(s)) return s.toLowerCase();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase() + publicKeyHex;
  return null;
}

/**
 * Generate a LetsMesh MQTT password token compatible with meshcore-mqtt-broker / verifyAuthToken.
 * Uses {@link letsMeshJwtAudience} for `aud`.
 */
export async function generateLetsMeshAuthToken(
  identity: { private_key?: string | number[]; public_key?: string | number[] },
  serverHost: string,
): Promise<string> {
  const pub = normalizePublicKeyHex(identity.public_key);
  const priv = meshcoreOrlpPrivateKeyHex(identity.private_key, pub);
  if (!pub) throw new Error('LetsMesh auth: public key missing or invalid');
  if (!priv) throw new Error('LetsMesh auth: private key missing or invalid');
  const { createAuthToken } = await import('@michaelhart/meshcore-decoder');
  const now = Math.floor(Date.now() / 1000);
  const aud = letsMeshJwtAudience(serverHost);
  return createAuthToken(
    {
      publicKey: pub.toUpperCase(),
      aud,
      iat: now,
      exp: now + 3600,
    },
    priv,
    pub,
  );
}
