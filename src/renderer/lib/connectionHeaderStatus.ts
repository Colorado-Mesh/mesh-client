import type { DeviceState, MQTTStatus } from './types';

export const CONNECTION_HEADER_PULSE_RED_TEXT = 'animate-pulse text-red-400';
export const CONNECTION_HEADER_PULSE_RED_DOT = 'bg-red-500 animate-pulse';
export const CONNECTION_HEADER_IDLE_TEXT = 'text-gray-400';
export const CONNECTION_HEADER_IDLE_DOT = 'bg-gray-500';
export const CONNECTION_HEADER_WARN_TEXT = 'animate-pulse text-yellow-400';
export const CONNECTION_HEADER_WARN_DOT = 'bg-yellow-500 animate-pulse';
export const CONNECTION_HEADER_OK_TEXT = 'text-brand-green';
export const CONNECTION_HEADER_OK_DOT = 'bg-green-500';
/** Small pulsing dot for in-progress room login (matches header connecting style, green). */
export const ROOM_LOGIN_PROGRESS_DOT =
  'inline-block h-2 w-2 shrink-0 rounded-full bg-brand-green animate-pulse';
export const CONNECTION_HEADER_CONNECTED_DOT = 'bg-blue-500';
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

export function takHeaderVariant(
  running: boolean,
  serverError: boolean,
  clientLoss: boolean,
): ConnectionHeaderVariant {
  if (isTakErrorDisconnect(running, serverError, clientLoss)) return 'error';
  if (running) return 'ok';
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
  return headerTextClass(variant);
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
