// @vitest-environment jsdom
/**
 * Exercises the patched @meshtastic/core decode pipe end to end (#1142): firmware 2.8 frames the
 * SDK has no handler for, and a throwing subscriber, must not error the fromDevice WritableStream.
 * Before the patch, NODE_STATUS_APP (port 36) threw "Unhandled case 36", pipeTo rejected, and
 * every later inbound frame was silently dropped until the dead-link watchdog reconnected.
 */
import { create, toBinary } from '@bufbuild/protobuf';
import { MeshDevice, type Types } from '@meshtastic/core';
import { Mesh, Portnums } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

const BROADCAST = 0xffffffff;

function packetFrame(id: number, portnum: number, payload: Uint8Array): Uint8Array {
  return toBinary(
    Mesh.FromRadioSchema,
    create(Mesh.FromRadioSchema, {
      id,
      payloadVariant: {
        case: 'packet',
        value: create(Mesh.MeshPacketSchema, {
          id,
          from: 0x1234,
          to: BROADCAST,
          payloadVariant: {
            case: 'decoded',
            value: create(Mesh.DataSchema, { portnum, payload }),
          },
        }),
      },
    }),
  );
}

function regionPresetsFrame(id: number): Uint8Array {
  return toBinary(
    Mesh.FromRadioSchema,
    create(Mesh.FromRadioSchema, {
      id,
      payloadVariant: { case: 'regionPresets', value: create(Mesh.LoRaRegionPresetMapSchema) },
    }),
  );
}

function createDevice(frames: Uint8Array[]) {
  const fromDevice = new ReadableStream<Types.DeviceOutput>({
    start(controller) {
      for (const data of frames) controller.enqueue({ type: 'packet', data });
      controller.close();
    },
  });
  const toDevice = new WritableStream<Uint8Array>({ write: vi.fn() });
  const transport = { fromDevice, toDevice } as unknown as Types.Transport;
  const device = new MeshDevice(transport) as MeshDevice & {
    onFromDevicePipeError?: (err: unknown) => void;
    _fromDevicePipe: Promise<void>;
  };
  // Silence tslog output; warnings/errors are still exercised.
  device.log.settings.minLevel = 7;
  return device;
}

const enc = new TextEncoder();

describe('patched @meshtastic/core decode pipe resilience (#1142)', () => {
  it('keeps delivering text after firmware 2.8 frames, unknown ports and a throwing subscriber', async () => {
    const THROWING_FRAME_ID = 4;
    const device = createDevice([
      packetFrame(1, Portnums.PortNum.NODE_STATUS_APP, new Uint8Array([1, 2, 3])),
      regionPresetsFrame(2),
      packetFrame(3, 999, new Uint8Array([9])),
      packetFrame(THROWING_FRAME_ID, Portnums.PortNum.TEXT_MESSAGE_APP, enc.encode('boom')),
      packetFrame(5, Portnums.PortNum.TEXT_MESSAGE_APP, enc.encode('hello after 2.8')),
    ]);
    const pipeError = vi.fn();
    device.onFromDevicePipeError = pipeError;
    device.events.onFromRadio.subscribe((fr) => {
      if (fr.id === THROWING_FRAME_ID) throw new Error('subscriber exploded');
    });
    const texts: string[] = [];
    device.events.onMessagePacket.subscribe((pkt) => {
      texts.push(pkt.data);
    });
    const logError = vi.spyOn(device.log, 'error');
    const logWarn = vi.spyOn(device.log, 'warn');

    await device._fromDevicePipe;

    expect(texts).toEqual(['hello after 2.8']);
    expect(pipeError).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Dropped FromRadio frame: subscriber exploded'),
    );
    expect(logWarn).toHaveBeenCalledWith(expect.any(String), '⚠️ Unhandled portnum: 999');
    expect(logWarn).not.toHaveBeenCalledWith(expect.any(String), expect.stringContaining('36'));
  });

  it('still dispatches the raw mesh packet for ports core has no event for', async () => {
    const device = createDevice([
      packetFrame(1, Portnums.PortNum.NODE_STATUS_APP, new Uint8Array([7])),
    ]);
    const portnums: number[] = [];
    device.events.onMeshPacket.subscribe((pkt) => {
      if (pkt.payloadVariant.case === 'decoded') portnums.push(pkt.payloadVariant.value.portnum);
    });

    await device._fromDevicePipe;

    expect(portnums).toEqual([Portnums.PortNum.NODE_STATUS_APP]);
  });
});
