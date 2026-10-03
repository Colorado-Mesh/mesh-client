import type { TAKRemoteStatus } from '@/shared/tak-types';

import { rfMaxReconnectAttemptsForTransport } from './rfReconnectShared';
import type { DeviceState, MQTTStatus } from './types';

/** Max reconnect attempts shown in the connection banner for the active transport. */
export function reconnectBannerMaxAttempts(connectionType: string | null | undefined): number {
  return rfMaxReconnectAttemptsForTransport(connectionType);
}

/** Text stays fully opaque; pulse animation is on the status dot/icon only (contrast). */
export const CONNECTION_HEADER_PULSE_RED_TEXT = 'text-red-400';
export const CONNECTION_HEADER_PULSE_RED_ICON = 'animate-pulse motion-status text-red-400';
export const CONNECTION_HEADER_PULSE_RED_DOT = 'bg-red-500 animate-pulse motion-status';
export const CONNECTION_HEADER_IDLE_TEXT = 'text-ink-400';
export const CONNECTION_HEADER_IDLE_DOT = 'bg-ink-500';
export const CONNECTION_HEADER_WARN_TEXT = 'text-orange-400';
export const CONNECTION_HEADER_WARN_ICON = 'animate-pulse motion-status text-orange-400';
export const CONNECTION_HEADER_WARN_DOT = 'bg-orange-500 animate-pulse motion-status';
export const CONNECTION_HEADER_OK_TEXT = 'text-green-400';
export const CONNECTION_HEADER_OK_DOT = 'bg-green-500';
/** Small pulsing dot for in-progress room login (matches header connecting style, green). */
export const ROOM_LOGIN_PROGRESS_DOT =
  'inline-block h-2 w-2 shrink-0 rounded-full bg-green-500 animate-pulse motion-status';
export const CONNECTION_HEADER_CONNECTED_DOT = 'bg-indigo-500';
export const CONNECTION_HEADER_MUTED_TEXT = 'text-muted';

export function isMqttErrorDisconnect(status: MQTTStatus, connectionLoss: boolean): boolean {
  return status === 'error' || connectionLoss;
}

export function isDeviceErrorDisconnect(
  status: DeviceState['status'],
  connectionLoss: boolean,
): boolean {
  return connectionLoss || status === 'reconnecting';
}

export function isTakErrorDisconnect(
  running: boolean,
  serverError: boolean,
  clientLoss: boolean,
): boolean {
  return (!running && serverError) || (running && clientLoss);
}

export type ConnectionHeaderVariant = 'ok' | 'warn' | 'error' | 'idle' | 'connected' | 'muted';

export function mqttHeaderVariant(
  status: MQTTStatus,
  connectionLoss: boolean,
): ConnectionHeaderVariant {
  if (isMqttErrorDisconnect(status, connectionLoss)) return 'error';
  if (status === 'connected') return 'ok';
  if (status === 'connecting') return 'warn';
  return 'idle';
}

export function deviceHeaderVariant(
  status: DeviceState['status'],
  connectionLoss: boolean,
): ConnectionHeaderVariant {
  if (isDeviceErrorDisconnect(status, connectionLoss)) return 'error';
  if (status === 'connecting' || status === 'stale') return 'warn';
  if (status === 'configured') return 'ok';
  if (status === 'connected') return 'connected';
  return 'idle';
}

/** Remote TAK relay is failing: retrying after an error, or stopped for good with one. */
export function isTakRemoteError(remote: Pick<TAKRemoteStatus, 'state' | 'error'>): boolean {
  return remote.state !== 'connected' && Boolean(remote.error);
}

/** One TAK status combining the local server and, when given, the remote relay. */
export function takHeaderVariant(
  running: boolean,
  serverError: boolean,
  clientLoss: boolean,
  remote?: Pick<TAKRemoteStatus, 'state' | 'error'>,
): ConnectionHeaderVariant {
  if (isTakErrorDisconnect(running, serverError, clientLoss)) return 'error';
  if (remote && isTakRemoteError(remote)) return 'error';
  if (remote?.state === 'connecting') return 'warn';
  if (running || remote?.state === 'connected') return 'ok';
  return 'idle';
}

export function headerTextClass(variant: ConnectionHeaderVariant): string {
  switch (variant) {
    case 'ok':
      return CONNECTION_HEADER_OK_TEXT;
    case 'warn':
      return CONNECTION_HEADER_WARN_TEXT;
    case 'error':
      return CONNECTION_HEADER_PULSE_RED_TEXT;
    case 'connected':
      return CONNECTION_HEADER_MUTED_TEXT;
    case 'muted':
      return CONNECTION_HEADER_MUTED_TEXT;
    default:
      return CONNECTION_HEADER_IDLE_TEXT;
  }
}

export function headerIconClass(variant: ConnectionHeaderVariant): string {
  switch (variant) {
    case 'warn':
      return CONNECTION_HEADER_WARN_ICON;
    case 'error':
      return CONNECTION_HEADER_PULSE_RED_ICON;
    default:
      return headerTextClass(variant);
  }
}

export function headerDotClass(variant: ConnectionHeaderVariant): string {
  switch (variant) {
    case 'ok':
      return CONNECTION_HEADER_OK_DOT;
    case 'warn':
      return CONNECTION_HEADER_WARN_DOT;
    case 'error':
      return CONNECTION_HEADER_PULSE_RED_DOT;
    case 'connected':
      return CONNECTION_HEADER_CONNECTED_DOT;
    case 'muted':
      return CONNECTION_HEADER_MUTED_TEXT;
    default:
      return CONNECTION_HEADER_IDLE_DOT;
  }
}

/** Status-dot tone names shared with `components/ui/StatusDot` (kept here so lib stays UI-free). */
export type HeaderDotTone = 'ok' | 'info' | 'warn' | 'error' | 'off';

/** Dot tone and pulse for a header variant: in-progress and error states pulse the dot only. */
export function headerVariantDot(variant: ConnectionHeaderVariant): {
  tone: HeaderDotTone;
  pulse: boolean;
} {
  switch (variant) {
    case 'ok':
      return { tone: 'ok', pulse: false };
    case 'connected':
      return { tone: 'info', pulse: false };
    case 'warn':
      return { tone: 'warn', pulse: true };
    case 'error':
      return { tone: 'error', pulse: true };
    default:
      return { tone: 'off', pulse: false };
  }
}
