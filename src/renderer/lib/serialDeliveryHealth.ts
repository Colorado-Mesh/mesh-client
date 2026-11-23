import { pushAppToast } from '../components/Toast';
import { getConnection, setConnection, useConnectionStore } from '../stores/connectionStore';
import type { ConnectionType, IdentityId } from './types';

export type SerialDeliveryFailureReason =
  | 'delivery-ack-timeout'
  | 'transport-loss'
  | 'watchdog-dead'
  | 'probe-failed'
  | 'auto-resend-gave-up';

const NUDGE_COOLDOWN_MS = 5 * 60 * 1000;
const TRANSPORT_LOSS_WINDOW_MS = 15 * 60 * 1000;
const DELIVERY_FAIL_THRESHOLD = 2;

interface SerialDeliveryHealthState {
  lastTransportLossAt: number;
  lastNudgeAt: number;
  deliveryFailCountSinceLoss: number;
}

const globalSerialHealth: SerialDeliveryHealthState = {
  lastTransportLossAt: 0,
  lastNudgeAt: 0,
  deliveryFailCountSinceLoss: 0,
};

const perIdentitySerialHealth = new Map<string, SerialDeliveryHealthState>();

function serialHealthKey(identityId?: IdentityId | null): string | null {
  return identityId != null && identityId !== '' ? identityId : null;
}

function getSerialHealthState(identityId?: IdentityId | null): SerialDeliveryHealthState {
  const key = serialHealthKey(identityId);
  if (key == null) return globalSerialHealth;
  let state = perIdentitySerialHealth.get(key);
  if (state == null) {
    state = {
      lastTransportLossAt: 0,
      lastNudgeAt: 0,
      deliveryFailCountSinceLoss: 0,
    };
    perIdentitySerialHealth.set(key, state);
  }
  return state;
}

/**
 * Sticky until {@link clearSerialPostWakeUntrusted}: accelerated dead threshold stays active
 * until a probe succeeds or the session tears down (not wall-clock alone).
 */
let postWakeSerialUntrusted = false;
let postWakeGeneration = 0;

function elevateSerialNeedsReselect(identityId?: IdentityId | null): void {
  if (identityId != null && identityId !== '') {
    const rec = getConnection(identityId);
    if (rec?.connectionType === 'serial' && !rec.serialNeedsReselect) {
      setConnection(identityId, {
        serialNeedsReselect: true,
        status: 'stale',
        connectionLoss: true,
      });
    }
    return;
  }
  for (const [id, rec] of Object.entries(useConnectionStore.getState().connections)) {
    if (rec.connectionType === 'serial' && !rec.serialNeedsReselect) {
      setConnection(id, { serialNeedsReselect: true, status: 'stale', connectionLoss: true });
    }
  }
}

function maybeNudge(
  reason: SerialDeliveryFailureReason,
  identityId?: IdentityId | null,
  health?: SerialDeliveryHealthState,
): void {
  const state = health ?? getSerialHealthState(identityId);
  const now = Date.now();
  if (now - state.lastNudgeAt < NUDGE_COOLDOWN_MS) return;
  state.lastNudgeAt = now;
  console.warn(`mcL1130 [serialDeliveryHealth] nudge reason=${reason}`);
  // Lazy i18n: avoid pulling the locale graph into ACK/runtime import cycles (jsdom tests).
  void import('./i18n')
    .then((mod) => {
      pushAppToast(mod.default.t('connectionBanner.serialDeliveryUnhealthy'), 'warning', 8000);
    })
    .catch(() => {
      pushAppToast('connectionBanner.serialDeliveryUnhealthy', 'warning', 8000);
    });
  elevateSerialNeedsReselect(identityId);
}

/** Record that Web Serial / USB transport was lost (DOMException, disconnect, etc.). */
export function noteSerialTransportLoss(opts?: {
  connectionType?: ConnectionType | null;
  identityId?: IdentityId | null;
}): void {
  const connectionType =
    opts?.connectionType ??
    (opts?.identityId != null ? (getConnection(opts.identityId)?.connectionType ?? null) : null);
  if (connectionType !== 'serial') return;
  const state = getSerialHealthState(opts?.identityId);
  state.lastTransportLossAt = Date.now();
  state.deliveryFailCountSinceLoss = 0;
  console.warn('mcL1131 [serialDeliveryHealth] transport-loss');
}

/**
 * After a delivery/hop ACK timeout (or probe failure) on USB serial, count toward a
 * replug/reboot nudge when a recent transport-loss was also seen.
 * Callers must pass the originating connection's `connectionType` (and preferably
 * `identityId`); there is no global "any serial" fallback.
 */
export function noteSerialDeliveryFailure(opts: {
  reason: SerialDeliveryFailureReason;
  connectionType?: ConnectionType | null;
  identityId?: IdentityId | null;
}): void {
  const connectionType =
    opts.connectionType ??
    (opts.identityId != null ? (getConnection(opts.identityId)?.connectionType ?? null) : null);
  if (connectionType !== 'serial') return;

  const state = getSerialHealthState(opts.identityId);

  if (opts.reason === 'transport-loss') {
    noteSerialTransportLoss({ connectionType, identityId: opts.identityId });
    return;
  }

  console.warn(`mcL1132 [serialDeliveryHealth] delivery-failure reason=${opts.reason}`);

  if (opts.reason === 'probe-failed' || opts.reason === 'watchdog-dead') {
    maybeNudge(opts.reason, opts.identityId, state);
    return;
  }

  const now = Date.now();
  const identityScopedLoss =
    state.lastTransportLossAt > 0 && now - state.lastTransportLossAt <= TRANSPORT_LOSS_WINDOW_MS;
  const globalLoss =
    opts.identityId != null &&
    globalSerialHealth.lastTransportLossAt > 0 &&
    now - globalSerialHealth.lastTransportLossAt <= TRANSPORT_LOSS_WINDOW_MS;
  const recentLoss = identityScopedLoss || globalLoss;
  if (!recentLoss && opts.reason !== 'auto-resend-gave-up') {
    return;
  }
  state.deliveryFailCountSinceLoss += 1;
  if (
    state.deliveryFailCountSinceLoss >= DELIVERY_FAIL_THRESHOLD ||
    opts.reason === 'auto-resend-gave-up'
  ) {
    maybeNudge(opts.reason, opts.identityId, state);
  }
}

/** Mark serial links as untrusted after OS resume until a probe succeeds. */
export function noteSerialPostWakeUntrusted(windowMs: number): void {
  postWakeSerialUntrusted = true;
  postWakeGeneration += 1;
  console.warn(`mcL1133 [serialDeliveryHealth] post-wake-untrusted windowMs=${windowMs}`);
}

export function clearSerialPostWakeUntrusted(): void {
  postWakeSerialUntrusted = false;
}

export function isSerialPostWakeUntrusted(): boolean {
  return postWakeSerialUntrusted;
}

/** Generation token for probes started in the current post-wake window. */
export function getSerialPostWakeGeneration(): number {
  return postWakeGeneration;
}

export function isSerialPostWakeGenerationCurrent(generation: number): boolean {
  return postWakeSerialUntrusted && generation === postWakeGeneration;
}

/** Test seam. */
export function resetSerialDeliveryHealthForTests(): void {
  globalSerialHealth.lastTransportLossAt = 0;
  globalSerialHealth.lastNudgeAt = 0;
  globalSerialHealth.deliveryFailCountSinceLoss = 0;
  perIdentitySerialHealth.clear();
  postWakeSerialUntrusted = false;
  postWakeGeneration = 0;
}
