import type { DescMessage } from '@bufbuild/protobuf';
import { AppOnly, Channel, Config, Mesh, StoreForward } from '@meshtastic/protobufs';

/* eslint-disable @typescript-eslint/no-unsafe-member-access -- @meshtastic/protobufs has no strict typings in the shared ts program; narrow once here. */

export const meshtasticChannelSettingsSchema = Channel.ChannelSettingsSchema as DescMessage;
export const meshtasticModuleSettingsSchema = Channel.ModuleSettingsSchema as DescMessage;
export const meshtasticChannelSetSchema = AppOnly.ChannelSetSchema as DescMessage;
export const meshtasticLoRaConfigSchema = Config.Config_LoRaConfigSchema as DescMessage;
export const meshtasticStoreAndForwardSchema = StoreForward.StoreAndForwardSchema as DescMessage;
export const meshtasticDataSchema = Mesh.DataSchema as DescMessage;

export const meshtasticStoreForwardRequestResponse =
  StoreForward.StoreAndForward_RequestResponse as {
    readonly ROUTER_TEXT_BROADCAST: number;
    readonly ROUTER_HEARTBEAT: number;
    readonly ROUTER_HISTORY: number;
  };

/* eslint-enable @typescript-eslint/no-unsafe-member-access */
