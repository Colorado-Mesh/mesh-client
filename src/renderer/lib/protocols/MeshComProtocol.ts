/* eslint-disable @typescript-eslint/require-await -- UnsupportedOperation stubs for Protocol surface not used on MeshCom yet */
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { parseMeshcomAprsPhoneFrame } from '../meshcom/meshcomAprsPhone';
import {
  encodeMeshcomBleCommand,
  MESHCOM_BLE_MH_TYPE,
  parseMeshcomBleFrames,
} from '../meshcom/meshcomBleFrame';
import {
  callsignToNodeId,
  normalizeMeshcomCallsign,
  parseMeshcomSrcPath,
} from '../meshcom/meshcomCallsign';
import { meshcomOutboundDest, resolveMeshcomDestination } from '../meshcom/meshcomChannel';
import {
  emptyMeshcomDeviceSettingsAccum,
  mergeMeshcomBleSettingsJson,
  type MeshcomDeviceSettingsAccum,
} from '../meshcom/meshcomDeviceSettings';
import { parseMeshcomExtUdp, serializeMeshcomExtUdp } from '../meshcom/meshcomExtUdpCodec';
import { meshcomFirmwareDisplay, meshcomHwLabel } from '../meshcom/meshcomHwIds';
import {
  buildMeshcomKissTxMessage,
  type MeshcomKissEvent,
  MeshcomKissSession,
  parseMeshcomInfoField,
} from '../meshcom/meshcomKissCodec';
import { parseMeshcomMhJson } from '../meshcom/meshcomMheard';
import { MeshcomSerialLineBuffer, meshcomSerialSendText } from '../meshcom/meshcomSerial';
import { MESHCOM_CAPABILITIES } from '../radio/BaseRadioProvider';
import type { TransportParams } from '../types';
import {
  createMeshComConnection,
  type MeshComConnection,
  transportParamsToMeshCom,
} from './meshcom/MeshComTransport';
import { meshcomIdentitySignature } from './meshcomIdentitySignature';
import type { DomainEvent, Protocol, SendMessageOptions, SendResult } from './Protocol';
import { UnsupportedOperation } from './Protocol';

const unsupported = (op: string) => {
  throw new UnsupportedOperation(`meshcom ${op}`);
};

/** How long sendMessage waits for a KISS TX_RESULT before failing the promise. */
const MESHCOM_KISS_TX_ACK_TIMEOUT_MS = 8 * MS_PER_SECOND;

function settleKissTxWaiter(
  handle: MeshComDeviceHandle,
  msgId: number,
  outcome: 'ack' | 'nack',
  statusByte: number,
): void {
  const waiter = handle.kissTxWaiters.get(msgId);
  if (!waiter) return;
  handle.kissTxWaiters.delete(msgId);
  clearTimeout(waiter.timer);
  if (outcome === 'ack') {
    waiter.resolve();
    return;
  }
  waiter.reject(new Error(`KISS TX rejected status=0x${statusByte.toString(16)}`));
}

function clearKissTxWaiters(handle: MeshComDeviceHandle): void {
  for (const waiter of handle.kissTxWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('MeshCom connection closed'));
  }
  handle.kissTxWaiters.clear();
}

/** Runtime handle returned by {@link meshcomProtocol.createDevice}. */
export interface MeshComDeviceHandle {
  connection: MeshComConnection;
  transport: 'udp' | 'tcp' | 'serial' | 'ble';
  /** Operator callsign for KISS TX src (SSID 0–15). */
  operatorCallsign: string;
  /** nodeId → callsign learned from inbound traffic. */
  callsignByNodeId: Map<number, string>;
  kissSession: MeshcomKissSession | null;
  nextMsgNumber: number;
  /** Pending KISS TX_RESULT waiters keyed by msg number (TCP only). */
  kissTxWaiters: Map<
    number,
    { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >;
  /** BLE `{HELLO}` / `--info` settings accumulator (mutated by subscribe). */
  deviceSettings: MeshcomDeviceSettingsAccum;
  /** Resolvers waiting for BLE `CONFFIN` (or serial collect finish). */
  deviceSettingsWaiters: (() => void)[];
}

function rememberCallsign(handle: MeshComDeviceHandle, callsign: string): number {
  const normalized = normalizeMeshcomCallsign(callsign);
  if (!normalized) return 0;
  const nodeId = callsignToNodeId(normalized);
  handle.callsignByNodeId.set(nodeId, normalized);
  return nodeId;
}

function notifyDeviceSettingsWaiters(handle: MeshComDeviceHandle): void {
  const waiters = handle.deviceSettingsWaiters.splice(0, handle.deviceSettingsWaiters.length);
  for (const resolve of waiters) resolve();
}

function emitDeviceTelemetry(
  emit: (event: DomainEvent) => void,
  opts: {
    nodeId: number;
    batteryLevel?: number;
    voltage?: number;
    temperature?: number;
    relativeHumidity?: number;
    barometricPressure?: number;
    gasResistance?: number;
    co2?: number;
  },
): void {
  const hasDevice =
    opts.batteryLevel != null ||
    opts.voltage != null ||
    opts.temperature != null ||
    opts.relativeHumidity != null ||
    opts.barometricPressure != null ||
    opts.gasResistance != null ||
    opts.co2 != null;
  if (!hasDevice) return;
  emit({
    type: 'telemetry',
    payload: {
      nodeId: opts.nodeId,
      timestamp: Date.now(),
      batteryLevel: opts.batteryLevel,
      voltage: opts.voltage,
      temperature: opts.temperature,
      relativeHumidity: opts.relativeHumidity,
      barometricPressure: opts.barometricPressure,
      gasResistance: opts.gasResistance,
      co2: opts.co2,
    },
  });
}

function emitSelfFromSettings(
  handle: MeshComDeviceHandle,
  emit: (event: DomainEvent) => void,
): void {
  const call = handle.deviceSettings.call;
  if (!call) return;
  handle.operatorCallsign = call;
  const nodeId = rememberCallsign(handle, call);
  const now = Date.now();
  const freqMhz = Number.parseFloat(handle.deviceSettings.freqMhz ?? '');
  const txPower = Number.parseInt(handle.deviceSettings.txPower ?? '', 10);
  emit({
    type: 'device_self_info',
    payload: {
      name: call,
      publicKey: new Uint8Array(0),
      type: 0,
      txPower: Number.isFinite(txPower) ? txPower : 0,
      radioFreq: Number.isFinite(freqMhz) ? Math.round(freqMhz * 1_000_000) : 0,
      batteryMilliVolts:
        handle.deviceSettings.battVoltage != null
          ? Math.round(handle.deviceSettings.battVoltage * 1000)
          : undefined,
      manualAddContacts: false,
    },
  });
  const selfFw = meshcomFirmwareDisplay(handle.deviceSettings.fwver);
  emit({
    type: 'node_info',
    payload: {
      nodeId,
      longName: call,
      shortName: (handle.deviceSettings.operatorName || call).slice(0, 4),
      lastHeardAt: now,
      batteryLevel: handle.deviceSettings.battPercent,
      voltage: handle.deviceSettings.battVoltage,
      firmwareVersion: selfFw ?? undefined,
    },
  });
  emitDeviceTelemetry(emit, {
    nodeId,
    batteryLevel: handle.deviceSettings.battPercent,
    voltage: handle.deviceSettings.battVoltage,
    temperature: handle.deviceSettings.temperatureC,
    relativeHumidity: handle.deviceSettings.humidityPct,
    barometricPressure: handle.deviceSettings.pressureHpa,
    gasResistance: handle.deviceSettings.gasResistance,
    co2: handle.deviceSettings.co2Ppm,
  });
  if (selfFw) {
    emit({
      type: 'device_metadata',
      payload: { firmwareVersion: selfFw },
    });
  }
}

function tryIngestSettingsJson(
  handle: MeshComDeviceHandle,
  text: string,
  emit: (event: DomainEvent) => void,
): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes('"TYP"')) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (e) {
    console.debug(
      '[MeshComProtocol] settings JSON parse failed ' +
        (e instanceof Error ? e.message : String(e)),
    );
    return false;
  }
  const { confFin } = mergeMeshcomBleSettingsJson(handle.deviceSettings, parsed);
  let typ = '';
  if (typeof parsed === 'object' && parsed !== null && 'TYP' in parsed) {
    const typVal = (parsed as Record<string, unknown>).TYP;
    if (typeof typVal === 'string' || typeof typVal === 'number') typ = String(typVal);
  }
  if (typ === 'MH') {
    const station = parseMeshcomMhJson(parsed);
    if (station) {
      const nodeId = rememberCallsign(handle, station.callsign);
      const now = Date.now();
      emit({
        type: 'node_info',
        payload: {
          nodeId,
          longName: station.callsign,
          shortName: station.callsign.slice(0, 4),
          lastHeardAt: now,
          snr: station.snr,
          rssi: station.rssi,
          hwModel: meshcomHwLabel(station.hwId) || undefined,
        },
      });
    }
  }
  if (typ === 'IO') {
    emit({
      type: 'device_log',
      payload: {
        message: typeof parsed === 'object' ? JSON.stringify(parsed) : 'IO',
        time: Date.now(),
        source: 'meshcom-io',
        level: 0,
      },
    });
  }
  // Emit self + telemetry as soon as call/battery/weather arrive (not only on CONFFIN).
  if (handle.deviceSettings.call && (typ === 'I' || typ === 'W' || typ === 'IS1' || confFin)) {
    emitSelfFromSettings(handle, emit);
  }
  if (confFin) {
    notifyDeviceSettingsWaiters(handle);
  }
  return true;
}

function resolveDestinationCallsign(handle: MeshComDeviceHandle, opts: SendMessageOptions): string {
  if (opts.channelIndex != null && opts.channelIndex > 0) {
    return meshcomOutboundDest({ channelIndex: opts.channelIndex });
  }
  if (opts.destination == null || opts.destination === 0xffffffff) {
    return '*';
  }
  const known = handle.callsignByNodeId.get(opts.destination);
  if (known) return known;
  throw new Error(
    `meshcom sendMessage: unknown destination nodeId ${opts.destination} (no callsign mapping)`,
  );
}

function textMessageToFromDest(
  handle: MeshComDeviceHandle,
  destRaw: string | undefined,
): { to: number; channelIndex: number } {
  const dest = resolveMeshcomDestination(destRaw);
  if (dest.channelIndex === 0) return { to: 0xffffffff, channelIndex: 0 };
  if (dest.channelIndex > 0) return { to: 0xffffffff, channelIndex: dest.channelIndex };
  const to = dest.toNodeId || rememberCallsign(handle, dest.wireDest);
  return { to, channelIndex: -1 };
}

function emitPhoneAprsEvents(
  handle: MeshComDeviceHandle,
  bytes: Uint8Array,
  emit: (event: DomainEvent) => void,
): void {
  const parsed = parseMeshcomAprsPhoneFrame(bytes);
  const now = Date.now();
  if (parsed.kind === 'ack') {
    emit({
      type: 'device_log',
      payload: {
        message: `ACK msg=${parsed.ackMsgId.toString(16)} type=${parsed.ackType}`,
        time: now,
        source: 'meshcom-ack',
        level: 0,
      },
    });
    emit({
      type: 'meshtastic_routing_ack',
      payload: {
        requestId: parsed.ackMsgId,
        ackProofStatus: parsed.ackType,
        isAck: true,
      },
    });
    return;
  }
  if (parsed.kind === 'text') {
    const from = rememberCallsign(handle, parsed.sourceCall);
    const { to, channelIndex } = textMessageToFromDest(handle, parsed.destCall);
    emit({
      type: 'text_message',
      payload: {
        id: `meshcom-ble-${parsed.msgId.toString(16)}`,
        from,
        to,
        payload: parsed.text,
        channelIndex,
        timestamp: now,
        hopCount: parsed.hopCount,
      },
    });
    emit({
      type: 'node_info',
      payload: {
        nodeId: from,
        longName: parsed.sourceCall,
        shortName: parsed.sourceCall.slice(0, 4),
        lastHeardAt: now,
        hopsAway: parsed.hopCount,
        hwModel: meshcomHwLabel(parsed.hwId) || undefined,
      },
    });
    return;
  }
  if (parsed.kind === 'position') {
    const from = rememberCallsign(handle, parsed.sourceCall);
    emit({
      type: 'node_info',
      payload: {
        nodeId: from,
        longName: parsed.sourceCall,
        shortName: parsed.sourceCall.slice(0, 4),
        lastHeardAt: now,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        altitude: parsed.altitudeM,
        batteryLevel: parsed.batteryPercent,
        hopsAway: parsed.hopCount,
        hwModel: meshcomHwLabel(parsed.hwId) || undefined,
      },
    });
    emit({
      type: 'position',
      payload: {
        nodeId: from,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        altitude: parsed.altitudeM,
        timestamp: now,
      },
    });
    if (parsed.batteryPercent != null) {
      emitDeviceTelemetry(emit, { nodeId: from, batteryLevel: parsed.batteryPercent });
    }
  }
}

function emitExtUdpEvents(
  handle: MeshComDeviceHandle,
  raw: Uint8Array,
  emit: (event: DomainEvent) => void,
): void {
  const parsed = parseMeshcomExtUdp(raw);
  if (!parsed) return;
  const now = Date.now();

  if (parsed.type === 'msg') {
    const { origin, hopCount } = parseMeshcomSrcPath(parsed.src);
    const from = rememberCallsign(handle, origin || parsed.src);
    const { to, channelIndex } = textMessageToFromDest(handle, parsed.dst);
    emit({
      type: 'text_message',
      payload: {
        id: parsed.msg_id ?? `meshcom-udp-${from}-${now}`,
        from,
        to,
        payload: parsed.msg,
        channelIndex,
        timestamp: now,
        rxSnr: parsed.snr,
        rxRssi: parsed.rssi,
        hopCount,
      },
    });
    if (origin) {
      emit({
        type: 'node_info',
        payload: {
          nodeId: from,
          longName: origin,
          shortName: origin.slice(0, 4),
          lastHeardAt: now,
          snr: parsed.snr,
          rssi: parsed.rssi,
          hopsAway: hopCount,
          hwModel: meshcomHwLabel(parsed.hw_id) || undefined,
          firmwareVersion: meshcomFirmwareDisplay(parsed.firmware, parsed.fw_sub) ?? undefined,
        },
      });
    }
    return;
  }

  if (parsed.type === 'pos') {
    const { origin, hopCount } = parseMeshcomSrcPath(parsed.src);
    const nodeId = rememberCallsign(handle, origin || parsed.src);
    let latitude = parsed.lat;
    let longitude = parsed.long;
    if (latitude != null && parsed.lat_dir?.toUpperCase() === 'S') latitude = -latitude;
    if (longitude != null && parsed.long_dir?.toUpperCase() === 'W') longitude = -longitude;

    emit({
      type: 'node_info',
      payload: {
        nodeId,
        longName: origin || parsed.src,
        shortName: (origin || parsed.src).slice(0, 4),
        lastHeardAt: now,
        latitude: latitude ?? undefined,
        longitude: longitude ?? undefined,
        altitude: parsed.alt,
        batteryLevel: parsed.batt,
        snr: parsed.snr,
        rssi: parsed.rssi,
        hopsAway: hopCount,
        hwModel: meshcomHwLabel(parsed.hw_id) || undefined,
        firmwareVersion: meshcomFirmwareDisplay(parsed.firmware, parsed.fw_sub) ?? undefined,
      },
    });
    if (parsed.batt != null) {
      emitDeviceTelemetry(emit, {
        nodeId,
        batteryLevel: parsed.batt,
      });
    }
    if (
      latitude != null &&
      longitude != null &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude)
    ) {
      emit({
        type: 'position',
        payload: {
          nodeId,
          latitude,
          longitude,
          altitude: parsed.alt,
          timestamp: now,
        },
      });
    }
    return;
  }

  // Remaining inbound variant is `tele` (msg/pos returned above).
  const { origin } = parseMeshcomSrcPath(parsed.src ?? '');
  if (!origin && !parsed.src) return;
  const nodeId = rememberCallsign(handle, origin || parsed.src || '');
  emit({
    type: 'node_info',
    payload: {
      nodeId,
      longName: origin || parsed.src,
      shortName: (origin || parsed.src || '').slice(0, 4),
      lastHeardAt: now,
      batteryLevel: parsed.batt,
    },
  });
  emitDeviceTelemetry(emit, {
    nodeId,
    batteryLevel: parsed.batt,
    temperature: parsed.temp ?? parsed.temp2,
    relativeHumidity: parsed.hum,
    barometricPressure: parsed.press ?? parsed.qnh,
    gasResistance: parsed.gasres,
    co2: parsed.co2,
  });
}

/**
 * Serial/BLE console line:
 * - `{CALL}text` / `::text` → chat inject
 * - other lines (e.g. `--info` replies) → device_log for the Device Commands console
 * - outbound `--` echoes are ignored
 */
function emitConsoleTextLine(
  handle: MeshComDeviceHandle,
  line: string,
  emit: (event: DomainEvent) => void,
): void {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('--')) return;

  const now = Date.now();
  const brace = /^\{([^}]+)\}(.*)$/.exec(trimmed);
  if (brace) {
    const destRaw = brace[1].trim();
    const text = brace[2].trimEnd();
    if (!destRaw || !text) return;
    // EXTUDP JSON also starts with `{` — only treat as brace-directed when not JSON.
    if (trimmed.startsWith('{"') || trimmed.startsWith('{ ')) return;
    const dest = resolveMeshcomDestination(destRaw);
    // Inbound `{CALL}text` is from that callsign (ALL/group dest is rare on serial RX).
    const fromCall =
      dest.channelIndex === -1 ? dest.wireDest : normalizeMeshcomCallsign(destRaw) || destRaw;
    const from = rememberCallsign(handle, fromCall);
    const { to, channelIndex } =
      dest.channelIndex > 0
        ? { to: 0xffffffff, channelIndex: dest.channelIndex }
        : dest.channelIndex === 0
          ? { to: 0xffffffff, channelIndex: 0 }
          : { to: 0xffffffff, channelIndex: 0 };
    emit({
      type: 'text_message',
      payload: {
        id: `meshcom-console-${from}-${now}`,
        from,
        to,
        payload: text,
        channelIndex,
        timestamp: now,
      },
    });
    emit({
      type: 'node_info',
      payload: {
        nodeId: from,
        longName: fromCall,
        shortName: fromCall.slice(0, 4),
        lastHeardAt: now,
      },
    });
    return;
  }

  // Serial ALL inject uses `::text` (two colons).
  if (trimmed.startsWith('::')) {
    const text = trimmed.slice(2).trim();
    if (!text) return;
    emit({
      type: 'text_message',
      payload: {
        id: `meshcom-console-all-${now}-${text.length}`,
        from: 0,
        to: 0xffffffff,
        payload: text,
        channelIndex: 0,
        timestamp: now,
      },
    });
    return;
  }

  emit({
    type: 'device_log',
    payload: {
      message: trimmed,
      time: now,
      source: 'meshcom-console',
      level: 0,
    },
  });
}

function emitKissEvents(
  handle: MeshComDeviceHandle,
  events: MeshcomKissEvent[],
  emit: (event: DomainEvent) => void,
): void {
  const now = Date.now();
  for (const event of events) {
    if (event.type === 'tx_result') {
      const { status, msgId } = event.result;
      // Firmware: 0x01 = accepted (+ msg_id); other codes = reject / fail (msg_id often omitted).
      const isAck = status === 0x01;
      const settleId =
        msgId != null && Number.isFinite(msgId)
          ? msgId >>> 0
          : handle.kissTxWaiters.size === 1
            ? handle.kissTxWaiters.keys().next().value
            : undefined;
      if (settleId != null) {
        settleKissTxWaiter(handle, settleId, isAck ? 'ack' : 'nack', status);
        emit({
          type: 'meshtastic_routing_ack',
          payload: {
            requestId: settleId,
            ackProofStatus: isAck ? 1 : 0,
            isAck,
          },
        });
      }
      emit({
        type: 'device_log',
        payload: {
          message: `KISS TX status=0x${status.toString(16)}${msgId != null ? ` msg=${msgId.toString(16)}` : ''}`,
          time: now,
          source: 'meshcom-kiss',
          level: 0,
        },
      });
      continue;
    }
    const { frame } = event;
    const from = rememberCallsign(handle, frame.src);
    const hopCount = frame.digis.length;
    const info = parseMeshcomInfoField(frame.info);

    if (info.kind === 'message') {
      if (info.ackNumber != null) {
        const requestId = Number.parseInt(info.ackNumber, 10);
        const isAck = /^ack/i.test(info.text);
        emit({
          type: 'meshtastic_routing_ack',
          payload: {
            requestId: Number.isFinite(requestId) ? requestId : 0,
            ackProofStatus: isAck ? 1 : 0,
            isAck,
          },
        });
        emit({
          type: 'device_log',
          payload: {
            message: `KISS ${info.text}`,
            time: now,
            source: 'meshcom-kiss',
            level: 0,
          },
        });
        continue;
      }
      const { to, channelIndex } = textMessageToFromDest(handle, info.addressee);
      emit({
        type: 'text_message',
        payload: {
          id: `meshcom-kiss-${from}-${now}-${frame.info.length}`,
          from,
          to,
          payload: info.text,
          channelIndex,
          timestamp: now,
          rxSnr: frame.meta?.snr,
          rxRssi: frame.meta?.rssi,
          hopCount,
        },
      });
      emit({
        type: 'node_info',
        payload: {
          nodeId: from,
          longName: frame.src,
          shortName: frame.src.slice(0, 4),
          lastHeardAt: now,
          snr: frame.meta?.snr,
          rssi: frame.meta?.rssi,
          hopsAway: hopCount,
        },
      });
      continue;
    }

    if (info.kind === 'position') {
      const altitudeM =
        info.altitudeFt != null && Number.isFinite(info.altitudeFt)
          ? Math.round(info.altitudeFt * 0.3048)
          : undefined;
      emit({
        type: 'node_info',
        payload: {
          nodeId: from,
          longName: frame.src,
          shortName: frame.src.slice(0, 4),
          lastHeardAt: now,
          latitude: info.latitude,
          longitude: info.longitude,
          altitude: altitudeM,
          batteryLevel: info.batteryPercent,
          snr: frame.meta?.snr,
          rssi: frame.meta?.rssi,
          hopsAway: hopCount,
        },
      });
      emit({
        type: 'position',
        payload: {
          nodeId: from,
          latitude: info.latitude,
          longitude: info.longitude,
          altitude: altitudeM,
          timestamp: now,
        },
      });
    }
  }
}

/**
 * MeshCom protocol adapter — EXTUDP + KISS/TCP transports.
 */
export const meshcomProtocol: Protocol = {
  type: 'meshcom',
  capabilities: MESHCOM_CAPABILITIES,

  async createDevice(params: TransportParams): Promise<MeshComDeviceHandle> {
    const transportParams = transportParamsToMeshCom(params);
    const connection = await createMeshComConnection(transportParams);
    return {
      connection,
      transport: transportParams.transport,
      operatorCallsign: '',
      callsignByNodeId: new Map(),
      kissSession: transportParams.transport === 'tcp' ? new MeshcomKissSession() : null,
      nextMsgNumber: 1,
      kissTxWaiters: new Map(),
      deviceSettings: emptyMeshcomDeviceSettingsAccum(),
      deviceSettingsWaiters: [],
    };
  },

  async destroyDevice(handle: unknown): Promise<void> {
    const device = handle as MeshComDeviceHandle | null;
    if (!device) return;
    clearKissTxWaiters(device);
    device.kissSession?.reset();
    await device.connection.close();
  },

  subscribe(handle: unknown, emit: (event: DomainEvent) => void): () => void {
    const device = handle as MeshComDeviceHandle;
    const serialLines = new MeshcomSerialLineBuffer();
    const ingestTextOrJson = (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('{')) {
        if (tryIngestSettingsJson(device, trimmed, emit)) return;
        const parsed = parseMeshcomExtUdp(trimmed);
        if (parsed) {
          emitExtUdpEvents(device, new TextEncoder().encode(trimmed), emit);
          return;
        }
        emitConsoleTextLine(device, trimmed, emit);
        return;
      }
      emitConsoleTextLine(device, trimmed, emit);
    };
    const onData = (bytes: Uint8Array): void => {
      try {
        if (device.transport === 'udp') {
          emitExtUdpEvents(device, bytes, emit);
          return;
        }
        if (device.transport === 'tcp' && device.kissSession) {
          const events = device.kissSession.pushBytes(bytes);
          emitKissEvents(device, events, emit);
          return;
        }
        if (device.transport === 'serial') {
          for (const line of serialLines.push(bytes)) {
            ingestTextOrJson(line);
          }
          return;
        }
        if (device.transport === 'ble') {
          for (const frame of parseMeshcomBleFrames(bytes)) {
            if (frame.kind === 'phone_aprs') {
              emitPhoneAprsEvents(device, frame.bytes, emit);
              continue;
            }
            if (frame.kind === 'text' || frame.kind === 'json') {
              ingestTextOrJson(frame.kind === 'text' ? frame.text : frame.json);
              continue;
            }
            if (frame.kind === 'binary' && frame.type === MESHCOM_BLE_MH_TYPE) {
              // Legacy MH type byte; modern firmware sends TYP MH as D{JSON}.
              const asText = new TextDecoder('utf-8', { fatal: false }).decode(frame.payload);
              const jsonStart = asText.indexOf('{');
              if (jsonStart >= 0) ingestTextOrJson(asText.slice(jsonStart));
            }
          }
        }
      } catch (err) {
        console.error(
          '[MeshComProtocol] inbound parse failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    };
    const onDisconnected = (): void => {
      if (device.kissSession) {
        emitKissEvents(device, device.kissSession.flush(), emit);
      }
      clearKissTxWaiters(device);
      serialLines.reset();
      emit({ type: 'device_status', payload: { status: 'disconnected' } });
    };
    device.connection.onData = onData;
    device.connection.onDisconnected = onDisconnected;
    return () => {
      device.connection.onData = null;
      device.connection.onDisconnected = null;
    };
  },

  identitySignature(params: TransportParams): string {
    return meshcomIdentitySignature(params);
  },

  async sendMessage(handle: unknown, opts: SendMessageOptions): Promise<SendResult> {
    const device = handle as MeshComDeviceHandle;
    const dst = resolveDestinationCallsign(device, opts);
    const text = opts.text;

    if (device.transport === 'udp') {
      const json = serializeMeshcomExtUdp({ type: 'msg', dst, msg: text });
      await device.connection.write(new TextEncoder().encode(json));
      return { packetId: device.nextMsgNumber++ };
    }

    if (device.transport === 'tcp') {
      const operator = normalizeMeshcomCallsign(device.operatorCallsign);
      if (!operator) {
        throw new Error('meshcom KISS sendMessage: operatorCallsign not set');
      }
      const msgNumber = device.nextMsgNumber++;
      const frame = buildMeshcomKissTxMessage({
        operatorCallsign: operator,
        destination: dst,
        text,
        msgNumber,
      });
      const ackPromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          device.kissTxWaiters.delete(msgNumber);
          reject(new Error('KISS TX timeout'));
        }, MESHCOM_KISS_TX_ACK_TIMEOUT_MS);
        device.kissTxWaiters.set(msgNumber, { resolve, reject, timer });
      });
      try {
        await device.connection.write(frame);
        await ackPromise;
      } catch (err) {
        const pending = device.kissTxWaiters.get(msgNumber);
        if (pending) {
          device.kissTxWaiters.delete(msgNumber);
          clearTimeout(pending.timer);
        }
        throw err;
      }
      return { packetId: msgNumber };
    }

    if (device.transport === 'serial') {
      await device.connection.write(meshcomSerialSendText(dst, text));
      return { packetId: device.nextMsgNumber++ };
    }

    // Remaining MeshCom transport is BLE (udp/tcp/serial handled above).
    const line = new TextDecoder('utf-8', { fatal: false }).decode(
      meshcomSerialSendText(dst, text),
    );
    await device.connection.write(encodeMeshcomBleCommand(line.replace(/\r?\n$/, '')));
    return { packetId: device.nextMsgNumber++ };
  },

  async sendPosition(): Promise<void> {
    unsupported('sendPosition');
  },
  async sendTraceRoute(): Promise<void> {
    unsupported('sendTraceRoute');
  },
  async sendWaypoint(): Promise<void> {
    unsupported('sendWaypoint');
  },
  async deleteWaypoint(): Promise<void> {
    unsupported('deleteWaypoint');
  },
  async reboot(): Promise<void> {
    unsupported('reboot');
  },
  async shutdown(): Promise<void> {
    unsupported('shutdown');
  },
  async factoryReset(): Promise<void> {
    unsupported('factoryReset');
  },
  async resetNodeDb(): Promise<void> {
    unsupported('resetNodeDb');
  },
  async rebootOta(): Promise<void> {
    unsupported('rebootOta');
  },
  async enterDfuMode(): Promise<void> {
    unsupported('enterDfuMode');
  },
  async factoryResetConfig(): Promise<void> {
    unsupported('factoryResetConfig');
  },
  async requestRefresh(): Promise<void> {
    return Promise.resolve();
  },
  async setConfig(): Promise<void> {
    unsupported('setConfig');
  },
  async commitConfig(): Promise<void> {
    unsupported('commitConfig');
  },
  async setChannel(): Promise<void> {
    unsupported('setChannel');
  },
  async clearChannel(): Promise<void> {
    unsupported('clearChannel');
  },
  async setOwner(
    handle: unknown,
    opts: { longName: string; shortName: string; isLicensed: boolean },
  ): Promise<void> {
    const device = handle as MeshComDeviceHandle;
    const callsign = normalizeMeshcomCallsign(opts.longName);
    if (!callsign) {
      throw new Error('meshcom setOwner: callsign required (--setcall)');
    }
    device.operatorCallsign = callsign;
    // Persist on the radio only over Serial/BLE console; KISS/EXTUDP just need local TX src.
    if (device.transport === 'serial' || device.transport === 'ble') {
      const { sendMeshcomDeviceCommand } = await import('../meshcom/meshcomDeviceCommands');
      await sendMeshcomDeviceCommand(device, `--setcall ${callsign}`);
      const operator = opts.shortName.trim();
      if (operator) {
        await sendMeshcomDeviceCommand(device, `--operatorname ${operator.slice(0, 19)}`);
      }
    }
  },
  async setModuleConfig(): Promise<void> {
    unsupported('setModuleConfig');
  },
  async setCannedMessages(): Promise<void> {
    unsupported('setCannedMessages');
  },
  async setRingtone(): Promise<void> {
    unsupported('setRingtone');
  },
  async sendPositionToDevice(
    handle: unknown,
    lat: number,
    lon: number,
    alt?: number,
  ): Promise<void> {
    const device = handle as MeshComDeviceHandle;
    if (device.transport !== 'serial' && device.transport !== 'ble') {
      throw new Error('meshcom sendPositionToDevice requires Serial or BLE');
    }
    const { sendMeshcomDeviceCommand } = await import('../meshcom/meshcomDeviceCommands');
    await sendMeshcomDeviceCommand(device, `--setlat ${lat}`);
    await sendMeshcomDeviceCommand(device, `--setlon ${lon}`);
    if (typeof alt === 'number' && Number.isFinite(alt)) {
      await sendMeshcomDeviceCommand(device, `--setalt ${Math.round(alt)}`);
    }
  },
  async requestPosition(): Promise<void> {
    unsupported('requestPosition');
  },
  async deleteNode(): Promise<void> {
    unsupported('deleteNode');
  },
};
