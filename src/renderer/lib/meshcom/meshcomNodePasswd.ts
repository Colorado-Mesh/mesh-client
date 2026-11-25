/**
 * Per-endpoint MeshCom `--passwd` for KISS / NET Console HMAC.
 * Secrets are keyed by transport + normalized host:port so reconnecting to node B
 * never reuses node A's password (and cannot answer B's nonce with A's secret).
 */

import { sha256 } from '@noble/hashes/sha2.js';

import { parseConnectHostPort } from '@/shared/connectHost';
import { MESHCOM_KISS_TCP_PORT, MESHCOM_NETCONSOLE_PORT } from '@/shared/meshcomConstants';

import { getCachedSecureSecret, removeSecureSecret, setSecureSecret } from '../secureSecretStorage';

/** Legacy single-slot key (pre per-endpoint). Migrated on first use of an endpoint. */
export const MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY = 'meshcom:node-passwd';

export const MESHCOM_NODE_PASSWD_SECRET_PREFIX = 'meshcom:node-passwd:';

export type MeshcomAuthTransport = 'tcp' | 'netconsole';

/**
 * In-memory one-shot claim of the legacy password. Set synchronously before return from
 * {@link getMeshcomNodePasswd} so a second endpoint cannot inherit the secret while
 * `setSecureSecret` / `removeSecureSecret` are still in flight. Cleared only after the
 * claimed endpoint's migration succeeds (or that endpoint clears the password).
 */
let legacyClaimEndpointKey: string | null = null;
let legacyClaimPassword: string | null = null;

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    s += b.toString(16).padStart(2, '0');
  }
  return s;
}

/** Lowercase host + explicit port (defaults applied). */
export function normalizeMeshcomAuthEndpoint(host: string, defaultPort: number): string {
  const { host: h, port } = parseConnectHostPort(host.trim() || '127.0.0.1', defaultPort);
  return `${h.toLowerCase()}:${port}`;
}

function defaultPortFor(transport: MeshcomAuthTransport): number {
  return transport === 'netconsole' ? MESHCOM_NETCONSOLE_PORT : MESHCOM_KISS_TCP_PORT;
}

/**
 * Stable secure-secret key: `meshcom:node-passwd:` + SHA-256 hex of
 * `transport|host:port` (transport is `tcp` for KISS UI `http`).
 */
export function meshcomNodePasswdSecretKey(transport: MeshcomAuthTransport, host: string): string {
  const endpoint = normalizeMeshcomAuthEndpoint(host, defaultPortFor(transport));
  const material = new TextEncoder().encode(`${transport}|${endpoint}`);
  return `${MESHCOM_NODE_PASSWD_SECRET_PREFIX}${bytesToHex(sha256(material))}`;
}

function clearLegacyClaimIfEndpoint(endpointKey: string): void {
  if (legacyClaimEndpointKey === endpointKey) {
    legacyClaimEndpointKey = null;
    legacyClaimPassword = null;
  }
}

/** Drop the legacy single-slot secret when present. */
async function removeLegacyMeshcomNodePasswd(): Promise<void> {
  if (getCachedSecureSecret(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY) != null) {
    await removeSecureSecret(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY);
  }
}

/**
 * Read the password for this endpoint. Migrates the legacy single-slot secret
 * into this endpoint key (and deletes the legacy key) when present.
 * The legacy value is claimed synchronously for the first endpoint so a concurrent
 * read for another endpoint cannot receive it.
 */
export function getMeshcomNodePasswd(transport: MeshcomAuthTransport, host: string): string {
  const key = meshcomNodePasswdSecretKey(transport, host);
  const scoped = getCachedSecureSecret(key);
  if (scoped != null && scoped.length > 0) return scoped;

  // This endpoint already claimed legacy; keep serving it across persist retries.
  if (legacyClaimEndpointKey === key && legacyClaimPassword != null) {
    return legacyClaimPassword;
  }

  // Another endpoint owns the one-shot legacy migrate.
  if (legacyClaimEndpointKey != null) {
    return '';
  }

  const legacy = getCachedSecureSecret(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY);
  if (legacy == null || legacy.length === 0) return '';

  // Claim before any async work so B cannot race-read the same legacy slot.
  legacyClaimEndpointKey = key;
  legacyClaimPassword = legacy;

  void setSecureSecret(key, legacy)
    .then(() => removeLegacyMeshcomNodePasswd())
    .then(() => {
      clearLegacyClaimIfEndpoint(key);
    })
    .catch(() => {
      // catch-no-log-ok keep claim for this endpoint's retries; do not release to others
    });

  return legacy;
}

/** Persist or clear the password for this endpoint. Never logs the value. */
export async function setMeshcomNodePasswd(
  transport: MeshcomAuthTransport,
  host: string,
  password: string,
): Promise<void> {
  const key = meshcomNodePasswdSecretKey(transport, host);
  const trimmed = password.slice(0, 14);
  if (!trimmed) {
    await removeSecureSecret(key);
    // Block re-migrate until legacy wipe completes (claim stays if wipe fails).
    legacyClaimEndpointKey = key;
    legacyClaimPassword = null;
    await removeLegacyMeshcomNodePasswd();
    clearLegacyClaimIfEndpoint(key);
    return;
  }
  await setSecureSecret(key, trimmed);
  clearLegacyClaimIfEndpoint(key);
  // Drop legacy so it cannot answer another endpoint's challenge.
  try {
    await removeLegacyMeshcomNodePasswd();
  } catch {
    // catch-no-log-ok best-effort legacy cleanup after a successful scoped write
  }
}

/** Map UI / TransportParams type onto the auth transport discriminator. */
export function meshcomAuthTransportFromConnectionType(type: string): MeshcomAuthTransport | null {
  if (type === 'http' || type === 'tcp') return 'tcp';
  if (type === 'netconsole') return 'netconsole';
  return null;
}

/** Test helper — clear the in-memory legacy claim between cases. */
export function resetMeshcomNodePasswdLegacyClaimForTests(): void {
  legacyClaimEndpointKey = null;
  legacyClaimPassword = null;
}
