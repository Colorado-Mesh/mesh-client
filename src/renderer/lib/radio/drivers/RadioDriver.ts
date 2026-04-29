import type { MeshProtocol } from '../../types';
import type { ProtocolCapabilities } from '../BaseRadioProvider';

export type ConnectParams =
  | { kind: 'ble'; peripheralId?: string; auto?: boolean }
  | { kind: 'serial'; portId?: string; auto?: boolean }
  | { kind: 'http'; address: string; auto?: boolean }
  | { kind: 'ip'; host: string; port?: number; auto?: boolean };

export interface SendMessageOptions {
  text: string;
  destination?: number;
  channelIndex?: number;
  emoji?: boolean;
  replyTo?: string;
}

export interface SendReactionOptions {
  target: number;
  emoji: string;
  replyTo?: string;
}

export interface SetOwnerOptions {
  longName: string;
  shortName?: string;
  isLicensed?: boolean;
}

export interface SendPositionOptions {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface ChannelConfigInput {
  name?: string;
  secret?: string;
  role?: 'PRIMARY' | 'SECONDARY' | 'DISABLED';
  uplinkEnabled?: boolean;
  downlinkEnabled?: boolean;
  positionPrecision?: number;
}

export interface RadioDriver {
  readonly protocol: MeshProtocol;
  readonly capabilities: ProtocolCapabilities;

  start(params: ConnectParams): Promise<void>;
  stop(): Promise<void>;

  sendMessage(options: SendMessageOptions): Promise<void>;
  sendReaction(options: SendReactionOptions): Promise<void>;

  deleteNode(nodeId: number): Promise<void>;
  setNodeFavorited(nodeId: number, favorited: boolean): Promise<void>;
  requestPosition(nodeId: number): Promise<void>;
  traceRoute(nodeId: number): Promise<void>;

  setChannel(index: number, config: ChannelConfigInput): Promise<void>;
  clearChannel(index: number): Promise<void>;

  setOwner(options: SetOwnerOptions): Promise<void>;

  sendPositionToDevice(options: SendPositionOptions): Promise<void>;
  setGpsInterval(intervalSec: number): Promise<void>;

  reboot(delaySec?: number): Promise<void>;
  shutdown(delaySec?: number): Promise<void>;
  factoryReset(): Promise<void>;
  resetNodeDb(): Promise<void>;
  rebootOta(): Promise<void>;
  enterDfuMode(): Promise<void>;
  requestRefresh(): Promise<void>;
}

export function notImplemented(protocol: MeshProtocol, method: string): never {
  throw new Error(`[${protocol}Driver] ${method}() not implemented`);
}
