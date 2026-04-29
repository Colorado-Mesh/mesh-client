import type { MeshProtocol } from '../../types';
import { MESHTASTIC_CAPABILITIES, type ProtocolCapabilities } from '../BaseRadioProvider';
import {
  type ChannelConfigInput,
  type ConnectParams,
  notImplemented,
  type RadioDriver,
  type SendMessageOptions,
  type SendPositionOptions,
  type SendReactionOptions,
  type SetOwnerOptions,
} from './RadioDriver';

export class MeshtasticDriver implements RadioDriver {
  readonly protocol: MeshProtocol = 'meshtastic';
  readonly capabilities: ProtocolCapabilities = MESHTASTIC_CAPABILITIES;

  start(_params: ConnectParams): Promise<void> {
    return notImplemented(this.protocol, 'start');
  }
  stop(): Promise<void> {
    return notImplemented(this.protocol, 'stop');
  }

  sendMessage(_options: SendMessageOptions): Promise<void> {
    return notImplemented(this.protocol, 'sendMessage');
  }
  sendReaction(_options: SendReactionOptions): Promise<void> {
    return notImplemented(this.protocol, 'sendReaction');
  }

  deleteNode(_nodeId: number): Promise<void> {
    return notImplemented(this.protocol, 'deleteNode');
  }
  setNodeFavorited(_nodeId: number, _favorited: boolean): Promise<void> {
    return notImplemented(this.protocol, 'setNodeFavorited');
  }
  requestPosition(_nodeId: number): Promise<void> {
    return notImplemented(this.protocol, 'requestPosition');
  }
  traceRoute(_nodeId: number): Promise<void> {
    return notImplemented(this.protocol, 'traceRoute');
  }

  setChannel(_index: number, _config: ChannelConfigInput): Promise<void> {
    return notImplemented(this.protocol, 'setChannel');
  }
  clearChannel(_index: number): Promise<void> {
    return notImplemented(this.protocol, 'clearChannel');
  }

  setOwner(_options: SetOwnerOptions): Promise<void> {
    return notImplemented(this.protocol, 'setOwner');
  }

  sendPositionToDevice(_options: SendPositionOptions): Promise<void> {
    return notImplemented(this.protocol, 'sendPositionToDevice');
  }
  setGpsInterval(_intervalSec: number): Promise<void> {
    return notImplemented(this.protocol, 'setGpsInterval');
  }

  reboot(_delaySec?: number): Promise<void> {
    return notImplemented(this.protocol, 'reboot');
  }
  shutdown(_delaySec?: number): Promise<void> {
    return notImplemented(this.protocol, 'shutdown');
  }
  factoryReset(): Promise<void> {
    return notImplemented(this.protocol, 'factoryReset');
  }
  resetNodeDb(): Promise<void> {
    return notImplemented(this.protocol, 'resetNodeDb');
  }
  rebootOta(): Promise<void> {
    return notImplemented(this.protocol, 'rebootOta');
  }
  enterDfuMode(): Promise<void> {
    return notImplemented(this.protocol, 'enterDfuMode');
  }
  requestRefresh(): Promise<void> {
    return notImplemented(this.protocol, 'requestRefresh');
  }
}
