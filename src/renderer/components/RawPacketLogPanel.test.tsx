import { create, toBinary } from '@bufbuild/protobuf';
import { Mesh, Portnums } from '@meshtastic/protobufs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RxPacketEntry } from '../lib/meshcore/meshcoreHookTypes';
import type { MeshtasticRawPacketEntry } from '../lib/rawPacketLogConstants';
import RawPacketLogPanel from './RawPacketLogPanel';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({ index, start: index * 36 })),
    getTotalSize: () => opts.count * 36,
    measureElement: () => {},
  }),
}));

function hexToU8(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function meshcorePacket(rawHex: string, payloadTypeString: string): RxPacketEntry {
  return {
    ts: 1_710_000_000_000,
    snr: 2.5,
    rssi: -90,
    raw: hexToU8(rawHex),
    routeTypeString: 'FLOOD',
    payloadTypeString,
    hopCount: 1,
    fromNodeId: null,
    messageFingerprintHex: 'TEST1234',
    transportScopeCode: null,
    transportReturnCode: null,
    advertName: null,
    advertLat: null,
    advertLon: null,
    advertTimestampSec: null,
    parseOk: true,
  };
}

describe('RawPacketLogPanel meshcore expanded details', () => {
  it('shows GRP_TXT channel hash plus MAC/ciphertext info', () => {
    const packets = [
      meshcorePacket(
        '150107819d28f7a0d427af7cbd3c6057b29763736b3878eb027514687b110abe33456565ca1117316f81033b1de05496a57ab1c44335f53749008b593a19cd9c9e340d34f076',
        'GRP_TXT',
      ),
    ];
    render(
      <RawPacketLogPanel
        variant="meshcore"
        packets={packets}
        onClear={vi.fn()}
        getNodeLabel={() => 'node'}
      />,
    );

    fireEvent.click(screen.getByText('GRP_TXT'));
    expect(screen.getByText(/Channel hash:/)).toBeInTheDocument();
    expect(screen.getByText(/MAC:/)).toBeInTheDocument();
    expect(screen.getByText(/Ciphertext bytes:/)).toBeInTheDocument();
  });

  it('shows CONTROL subtype details for payload nibble 0xB', () => {
    const packets = [
      meshcorePacket(
        '2e0092f3420d28240700fecd503efbf79ee0d400fbf0dfb7c1a3da95be0e71ab1ba8da3d1bd0d0b3',
        'CONTROL',
      ),
    ];
    render(
      <RawPacketLogPanel
        variant="meshcore"
        packets={packets}
        onClear={vi.fn()}
        getNodeLabel={() => 'node'}
      />,
    );

    fireEvent.click(screen.getByText('CONTROL'));
    expect(screen.getByText(/Control:/)).toBeInTheDocument();
    expect(screen.getByText(/subtype=0x9\(DISCOVER_RESP\)/)).toBeInTheDocument();
    expect(screen.getByText(/tag=0x24280D42/)).toBeInTheDocument();
  });
});

function meshtasticPacket(
  overrides: Partial<MeshtasticRawPacketEntry> & Pick<MeshtasticRawPacketEntry, 'portLabel'>,
): MeshtasticRawPacketEntry {
  const raw =
    overrides.raw ??
    toBinary(
      Mesh.MeshPacketSchema,
      create(Mesh.MeshPacketSchema, {
        id: 0x12345678,
        from: 0xabcdef01,
        to: 0x11111111,
        channel: 2,
        hopStart: 7,
        hopLimit: 4,
        payloadVariant: {
          case: 'decoded',
          value: {
            portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
            payload: new Uint8Array([1, 2, 3]),
          },
        },
      }) as never,
    );
  return {
    ts: 1_710_000_000_000,
    snr: 2.5,
    rssi: -90,
    raw,
    fromNodeId: 0xabcdef01,
    portLabel: overrides.portLabel,
    viaMqtt: overrides.viaMqtt ?? false,
    isLocal: overrides.isLocal,
  };
}

describe('RawPacketLogPanel meshtastic expanded details', () => {
  it('shows port, transport, hops, and debug line when row expands', () => {
    const packets = [meshtasticPacket({ portLabel: 'TEXT_MESSAGE_APP' })];
    render(
      <RawPacketLogPanel
        variant="meshtastic"
        packets={packets}
        onClear={vi.fn()}
        getNodeLabel={() => 'TestNode'}
      />,
    );

    fireEvent.click(screen.getByText('TEXT_MESSAGE_APP'));
    expect(screen.getByText(/hops=3 \(hopStart=7 hopLimit=4\)/)).toBeInTheDocument();
    expect(screen.getByText(/id=0x12345678/)).toBeInTheDocument();
    expect(screen.getByText(/to=0x11111111/)).toBeInTheDocument();
    expect(screen.getByText(/channel=2/)).toBeInTheDocument();
    expect(screen.getByText(/payload=decoded/)).toBeInTheDocument();
  });

  it('node name click opens details without expanding raw hex', () => {
    const onNodeClick = vi.fn();
    const packets = [meshtasticPacket({ portLabel: 'TEXT_MESSAGE_APP' })];
    render(
      <RawPacketLogPanel
        variant="meshtastic"
        packets={packets}
        onClear={vi.fn()}
        getNodeLabel={() => 'TestNode'}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open node details for TestNode/i }));
    expect(onNodeClick).toHaveBeenCalledOnce();
    expect(onNodeClick).toHaveBeenCalledWith(0xabcdef01);
    expect(screen.queryByText(/Raw hex/)).not.toBeInTheDocument();
  });

  it('collapses expanded row when filter excludes it', () => {
    const packets = [
      meshtasticPacket({ portLabel: 'TEXT_MESSAGE_APP' }),
      meshtasticPacket({ portLabel: 'POSITION_APP' }),
    ];
    render(
      <RawPacketLogPanel
        variant="meshtastic"
        packets={packets}
        onClear={vi.fn()}
        getNodeLabel={() => 'TestNode'}
      />,
    );

    fireEvent.click(screen.getByText('TEXT_MESSAGE_APP'));
    expect(screen.getByText(/id=0x12345678/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'POSITION' } });
    expect(screen.queryByText(/id=0x12345678/)).not.toBeInTheDocument();
    expect(screen.getByText('POSITION_APP')).toBeInTheDocument();
  });
});
