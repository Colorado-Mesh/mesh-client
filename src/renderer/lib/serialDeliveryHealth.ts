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

let lastTransportLossAt = 0;
let lastNudgeAt = 0;
let deliveryFailCountSinceLoss = 0;
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

function maybeNudge(reason: SerialDeliveryFailureReason, identityId?: IdentityId | null): void {
  const now = Date.now();
  if (now - lastNudgeAt < NUDGE_COOLDOWN_MS) return;
  lastNudgeAt = now;
  console.warn(`[serialDeliveryHealth] nudge reason=${reason}`);
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
  lastTransportLossAt = Date.now();
  deliveryFailCountSinceLoss = 0;
  console.warn('[serialDeliveryHealth] transport-loss');
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

  if (opts.reason === 'transport-loss') {
    noteSerialTransportLoss({ connectionType, identityId: opts.identityId });
    return;
  }

  console.warn(`[serialDeliveryHealth] delivery-failure reason=${opts.reason}`);

  if (opts.reason === 'probe-failed' || opts.reason === 'watchdog-dead') {
    maybeNudge(opts.reason, opts.identityId);
    return;
  }

  const now = Date.now();
  const recentLoss =
    lastTransportLossAt > 0 && now - lastTransportLossAt <= TRANSPORT_LOSS_WINDOW_MS;
  if (!recentLoss && opts.reason !== 'auto-resend-gave-up') {
    return;
  }
  deliveryFailCountSinceLoss += 1;
  if (
    deliveryFailCountSinceLoss >= DELIVERY_FAIL_THRESHOLD ||
    opts.reason === 'auto-resend-gave-up'
  ) {
    maybeNudge(opts.reason, opts.identityId);
  }
}

/** Mark serial links as untrusted after OS resume until a probe succeeds. */
export function noteSerialPostWakeUntrusted(windowMs: number): void {
  postWakeSerialUntrusted = true;
  postWakeGeneration += 1;
  console.warn(`[serialDeliveryHealth] post-wake-untrusted windowMs=${windowMs}`);
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
  lastTransportLossAt = 0;
  lastNudgeAt = 0;
  deliveryFailCountSinceLoss = 0;
  postWakeSerialUntrusted = false;
  postWakeGeneration = 0;
}
