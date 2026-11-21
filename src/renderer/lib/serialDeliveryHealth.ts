import { pushAppToast } from '../components/Toast';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import type { ConnectionType } from './types';

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
/** When true, post-wake silence watchdog uses the accelerated dead threshold. */
let postWakeSerialUntrustedUntil = 0;

function anySerialConnectionType(): ConnectionType | null {
  for (const rec of Object.values(useConnectionStore.getState().connections)) {
    if (rec.connectionType === 'serial') return 'serial';
  }
  return null;
}

function elevateSerialNeedsReselect(): void {
  for (const [id, rec] of Object.entries(useConnectionStore.getState().connections)) {
    if (rec.connectionType === 'serial' && !rec.serialNeedsReselect) {
      setConnection(id, { serialNeedsReselect: true, status: 'stale', connectionLoss: true });
    }
  }
}

function maybeNudge(reason: SerialDeliveryFailureReason): void {
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
  elevateSerialNeedsReselect();
}

/** Record that Web Serial / USB transport was lost (DOMException, disconnect, etc.). */
export function noteSerialTransportLoss(opts?: { connectionType?: ConnectionType | null }): void {
  const connectionType = opts?.connectionType ?? anySerialConnectionType();
  if (connectionType !== 'serial') return;
  lastTransportLossAt = Date.now();
  deliveryFailCountSinceLoss = 0;
  console.warn('[serialDeliveryHealth] transport-loss');
}

/**
 * After a delivery/hop ACK timeout (or probe failure) on USB serial, count toward a
 * replug/reboot nudge when a recent transport-loss was also seen.
 */
export function noteSerialDeliveryFailure(opts: {
  reason: SerialDeliveryFailureReason;
  connectionType?: ConnectionType | null;
}): void {
  const connectionType = opts.connectionType ?? anySerialConnectionType();
  if (connectionType !== 'serial') return;

  if (opts.reason === 'transport-loss') {
    noteSerialTransportLoss({ connectionType });
    return;
  }

  console.warn(`[serialDeliveryHealth] delivery-failure reason=${opts.reason}`);

  if (opts.reason === 'probe-failed' || opts.reason === 'watchdog-dead') {
    maybeNudge(opts.reason);
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
    maybeNudge(opts.reason);
  }
}

/** Mark serial links as untrusted after OS resume until a probe succeeds. */
export function noteSerialPostWakeUntrusted(windowMs: number): void {
  postWakeSerialUntrustedUntil = Date.now() + windowMs;
  console.warn(`[serialDeliveryHealth] post-wake-untrusted windowMs=${windowMs}`);
}

export function clearSerialPostWakeUntrusted(): void {
  postWakeSerialUntrustedUntil = 0;
}

export function isSerialPostWakeUntrusted(now: number = Date.now()): boolean {
  return postWakeSerialUntrustedUntil > 0 && now < postWakeSerialUntrustedUntil;
}

/** Test seam. */
export function resetSerialDeliveryHealthForTests(): void {
  lastTransportLossAt = 0;
  lastNudgeAt = 0;
  deliveryFailCountSinceLoss = 0;
  postWakeSerialUntrustedUntil = 0;
}
