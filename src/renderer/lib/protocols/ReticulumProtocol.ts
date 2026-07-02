/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- Reticulum uses sidecar IPC, not RF transports */
import { RETICULUM_CAPABILITIES } from '../radio/BaseRadioProvider';
import type { TransportParams } from '../types';
import type {
  DiscoveryInfo,
  DomainEvent,
  Protocol,
  SendMessageOptions,
  SendPositionOptions,
  SendResult,
  SendWaypointOptions,
  SetChannelOptions,
  SetOwnerOptions,
} from './Protocol';
import { UnsupportedOperation } from './Protocol';

const unsupported = () => {
  throw new UnsupportedOperation('reticulum');
};

export const reticulumProtocol: Protocol = {
  type: 'reticulum',
  capabilities: RETICULUM_CAPABILITIES,

  async createDevice(_params: TransportParams): Promise<unknown> {
    return { kind: 'reticulum-sidecar' };
  },
  async destroyDevice(_handle: unknown): Promise<void> {
    return Promise.resolve();
  },
  subscribe(_handle: unknown, _emit: (event: DomainEvent) => void): () => void {
    return () => {};
  },
  identitySignature(): string {
    return 'reticulum:sidecar';
  },

  async sendMessage(_handle: unknown, _opts: SendMessageOptions): Promise<SendResult> {
    throw new UnsupportedOperation('reticulum');
  },
  async sendPosition(): Promise<void> {
    unsupported();
  },
  async sendTraceRoute(): Promise<void> {
    unsupported();
  },
  async sendWaypoint(): Promise<void> {
    unsupported();
  },
  async deleteWaypoint(): Promise<void> {
    unsupported();
  },
  async reboot(): Promise<void> {
    unsupported();
  },
  async shutdown(): Promise<void> {
    unsupported();
  },
  async factoryReset(): Promise<void> {
    unsupported();
  },
  async resetNodeDb(): Promise<void> {
    unsupported();
  },
  async rebootOta(): Promise<void> {
    unsupported();
  },
  async enterDfuMode(): Promise<void> {
    unsupported();
  },
  async factoryResetConfig(): Promise<void> {
    unsupported();
  },
  async requestRefresh(): Promise<void> {
    return Promise.resolve();
  },
  async setConfig(): Promise<void> {
    unsupported();
  },
  async commitConfig(): Promise<void> {
    unsupported();
  },
  async setChannel(): Promise<void> {
    unsupported();
  },
  async clearChannel(): Promise<void> {
    unsupported();
  },
  async setOwner(): Promise<void> {
    unsupported();
  },
  async setModuleConfig(): Promise<void> {
    unsupported();
  },
  async setCannedMessages(): Promise<void> {
    unsupported();
  },
  async setRingtone(): Promise<void> {
    unsupported();
  },
  async sendPositionToDevice(): Promise<void> {
    unsupported();
  },
  async requestPosition(): Promise<void> {
    unsupported();
  },
  async deleteNode(): Promise<void> {
    unsupported();
  },
};
