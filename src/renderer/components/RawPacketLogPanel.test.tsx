import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RxPacketEntry } from '../hooks/useMeshCore';
import RawPacketLogPanel from './RawPacketLogPanel';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0 }],
    getTotalSize: () => 36,
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
