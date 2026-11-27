import { errLikeToLogString } from './errLikeToLogString';
import {
  validateLetsMeshManualCredentials,
  validateLetsMeshPresetConnect,
} from './letsMeshConnectionGuards';
import {
  generateLetsMeshAuthToken,
  letsMeshMqttUsernameFromIdentity,
  meshcoreIdentityHasFullKeyPair,
  readMeshcoreIdentityAsync,
} from './letsMeshJwt';
import { loadMeshcoreMqttFeeds, type MeshcoreMqttFeed } from './meshcoreMqttFeeds';
import { type MeshcoreMqttPreset, usesMeshcoreDeviceSigningMqtt } from './meshcoreMqttPresets';
import { prepareMeshcoreIataMqttTopicPrefix } from './meshcoreMqttTopicPrefix';
import type { MQTTSettings } from './types';

/** MQTT settings plus the connection routing hints main uses to pick a pool slot. */
export type MeshcoreMqttConnectSettings = MQTTSettings & {
  connectionId?: string;
  role?: 'chat' | 'feed';
};

/** Structured preparation failure so the panel can translate `errorKey` instead of raw text. */
export class MeshcoreMqttConnectError extends Error {
  readonly failure: MeshcoreMqttConnectFailure;

  constructor(failure: MeshcoreMqttConnectFailure) {
    super(failure.message);
    this.name = 'MeshcoreMqttConnectError';
    this.failure = failure;
  }
}

export interface MeshcoreMqttConnectFailure {
  /** i18n key when the caller can render a translated message. */
  errorKey?: string;
  /** Already-rendered detail (broker/JWT errors) for callers without `t()`. */
  message: string;
  params?: Record<string, string>;
}

export type MeshcoreMqttConnectResult =
  | { ok: true; settings: MeshcoreMqttConnectSettings }
  | { ok: false; failure: MeshcoreMqttConnectFailure };

function fail(
  message: string,
  errorKey?: string,
  params?: Record<string, string>,
): MeshcoreMqttConnectResult {
  return { ok: false, failure: { message, errorKey, params } };
}

/**
 * Shared MeshCore connect preparation: IATA topic-prefix normalization plus device-signed JWT
 * minting. Used by the Connection panel (chat + feed buttons) and startup auto-launch so the two
 * can never drift.
 */
export async function prepareMeshcoreMqttConnect(args: {
  preset: MeshcoreMqttPreset | null;
  settings: MQTTSettings;
  /** Import a MeshCore identity before minting when the user has not created one yet. */
  ensureIdentity?: () => Promise<void>;
}): Promise<MeshcoreMqttConnectResult> {
  const settings: MQTTSettings = { ...args.settings };

  const iataPrepared = prepareMeshcoreIataMqttTopicPrefix(args.preset, settings);
  if (!iataPrepared.ok) {
    return fail(
      'MeshCore topic prefix must be meshcore/{IATA} or meshcore/test',
      iataPrepared.errorKey,
    );
  }
  settings.topicPrefix = iataPrepared.topicPrefix;

  if (!usesMeshcoreDeviceSigningMqtt(args.preset, settings)) {
    return { ok: true, settings };
  }

  const presetErr = validateLetsMeshPresetConnect(settings);
  if (presetErr) return fail(presetErr);

  if (args.ensureIdentity && !meshcoreIdentityHasFullKeyPair()) {
    await args.ensureIdentity();
  }
  const identity = await readMeshcoreIdentityAsync();
  if (!identity) {
    // Manual credentials (v1_ username + broker token) still work without a radio identity.
    if (!settings.password.trim()) {
      return fail(
        'MeshCore MQTT needs an imported identity or a password',
        'connectionPanel.meshcoreMqttIdentity.noIdentity',
      );
    }
    const manualErr = validateLetsMeshManualCredentials(settings);
    if (manualErr) return fail(manualErr);
    return { ok: true, settings };
  }
  const hasFullIdentity = Boolean(identity.private_key && identity.public_key);

  if (!hasFullIdentity) {
    if (!identity.public_key) {
      return fail(
        'MeshCore identity is missing its public key',
        'connectionPanel.meshcoreMqttIdentity.publicKeyMissing',
      );
    }
    if (!settings.password.trim()) {
      return fail(
        'MeshCore identity is missing its key pair',
        'connectionPanel.meshcoreMqttIdentity.usernameBuildFailed',
      );
    }
    const manualErr = validateLetsMeshManualCredentials(settings);
    if (manualErr) return fail(manualErr);
    return { ok: true, settings };
  }

  try {
    const username = letsMeshMqttUsernameFromIdentity(identity);
    if (username) settings.username = username;
    const { token, expiresAt } = await generateLetsMeshAuthToken(identity, settings.server);
    settings.password = token;
    settings.tokenExpiresAt = expiresAt;
  } catch (e) {
    // catch-no-log-ok returned to the caller, which shows the JWT failure in the panel or logs it
    const message = e instanceof Error ? e.message : String(e);
    return fail(message, 'connectionPanel.authTokenFailed', { message });
  }

  return { ok: true, settings };
}

/** Prepare + connect one publish-only analyzer feed. Returns false when the feed was deleted. */
export async function connectMeshcoreMqttFeed(
  feed: MeshcoreMqttFeed,
  options?: { isStillCurrent?: () => boolean },
): Promise<boolean> {
  const prepared = await prepareMeshcoreMqttConnect({
    preset: feed.preset,
    settings: feed.settings,
  });
  if (!prepared.ok) {
    throw new MeshcoreMqttConnectError(prepared.failure);
  }
  // Startup attempts only connect feeds that are still saved and enabled. Identity/JWT prep can
  // take seconds, so an explicit one-off connect supplies its own live attempt check.
  const stillCurrent =
    options?.isStillCurrent ??
    (() => loadMeshcoreMqttFeeds().some((current) => current.id === feed.id && current.enabled));
  if (!stillCurrent()) {
    console.debug('[meshcoreMqttConnect] feed removed before connect; skipping');
    return false;
  }
  await window.electronAPI.mqtt.connect({
    ...prepared.settings,
    mqttTransportProtocol: 'meshcore',
    connectionId: feed.id,
    role: 'feed',
  });
  return true;
}

/**
 * Connect every enabled analyzer feed. One failing broker must not block the others; failures are
 * collected so the caller can surface them together.
 */
export async function connectEnabledMeshcoreMqttFeeds(
  feeds: readonly MeshcoreMqttFeed[],
): Promise<{ connected: number; failures: MeshcoreMqttConnectFailure[] }> {
  const failures: MeshcoreMqttConnectFailure[] = [];
  let connected = 0;
  for (const feed of feeds) {
    if (!feed.enabled) continue;
    try {
      if (await connectMeshcoreMqttFeed(feed)) connected += 1;
    } catch (e) {
      failures.push(
        e instanceof MeshcoreMqttConnectError
          ? e.failure
          : { message: e instanceof Error ? e.message : String(e) },
      );
      console.warn('mcL1510 [meshcoreMqttConnect] feed connect failed ' + errLikeToLogString(e));
    }
  }
  return { connected, failures };
}
