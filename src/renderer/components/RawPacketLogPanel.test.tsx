import { create, toBinary } from '@bufbuild/protobuf';
import { Mesh, Portnums } from '@meshtastic/protobufs';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VIRTUALIZER_SCROLL_END_THRESHOLD } from '../lib/chatScrollUtils';
import type { RxPacketEntry } from '../lib/meshcore/meshcoreHookTypes';
import type {
  MeshtasticRawPacketEntry,
  ReticulumRawPacketEntry,
} from '../lib/rawPacketLogConstants';
import RawPacketLogPanel from './RawPacketLogPanel';

let mockIsAtEnd = true;
const mockScrollToEnd = vi.fn();
const mockScrollToIndex = vi.fn();
let lastVirtualizerOptions: Record<string, unknown> | undefined;
let lastVirtualizerInstance: Record<string, unknown> | undefined;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: Record<string, unknown> & { count: number }) => {
    lastVirtualizerOptions = opts;
    const count = opts.count;
    const getItemKey = opts.getItemKey as ((index: number) => string | number) | undefined;
    const instance = {
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: getItemKey?.(index) ?? index,
          start: index * 36,
        })),
      getTotalSize: () => count * 36,
      measureElement: () => {},
      isAtEnd: () => mockIsAtEnd,
      scrollToEnd: mockScrollToEnd,
      scrollToIndex: mockScrollToIndex,
      get scrollDirection() {
        return 'forward' as const;
      },
      shouldAdjustScrollPositionOnItemSizeChange: undefined as
        | ((
            item: { index: number },
            delta: number,
            inst: { scrollDirection: string | null; isAtEnd: () => boolean },
          ) => boolean)
        | undefined,
    };
    lastVirtualizerInstance = instance;
    return instance;
  },
}));

beforeEach(() => {
  mockIsAtEnd = true;
  mockScrollToEnd.mockClear();
  mockScrollToIndex.mockClear();
  lastVirtualizerOptions = undefined;
  lastVirtualizerInstance = undefined;
});

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

function reticulumPacket(ts: number, interfaceName = 'RNode'): ReticulumRawPacketEntry {
  return {
    ts,
    direction: 'rx',
    interfaceId: 1,
    interfaceName,
    raw: new Uint8Array([0x01, 0x02, ts & 0xff]),
    packetType: 'DATA',
    headerType: 'SINGLE',
  };
}

describe('RawPacketLogPanel scroll pinning', () => {
  it('configures TanStack Virtual with sniffer scroll contract', () => {
    render(
      <RawPacketLogPanel
        variant="reticulum"
        packets={[reticulumPacket(1_710_000_000_000)]}
        onClear={vi.fn()}
        getNodeLabel={() => 'node'}
      />,
    );
    expect(lastVirtualizerOptions?.anchorTo).toBe('end');
    expect(lastVirtualizerOptions?.followOnAppend).toBe(true);
    expect(lastVirtualizerOptions?.scrollEndThreshold).toBe(VIRTUALIZER_SCROLL_END_THRESHOLD);
    const adjust = lastVirtualizerInstance?.shouldAdjustScrollPositionOnItemSizeChange as (
      item: { index: number },
      delta: number,
      instance: {
        scrollDirection: 'forward' | 'backward' | null;
        isAtEnd: () => boolean;
      },
    ) => boolean;
    expect(adjust).toBeTypeOf('function');
    expect(adjust({ index: 0 }, 0, { scrollDirection: 'forward', isAtEnd: () => true })).toBe(true);
    expect(adjust({ index: 0 }, 0, { scrollDirection: 'forward', isAtEnd: () => false })).toBe(
      false,
    );
  });

  it('scrolls to end when pinned and new packets arrive', () => {
    mockIsAtEnd = true;
    const initial = reticulumPacket(1_710_000_000_000);
    const { rerender } = render(
      <RawPacketLogPanel
        variant="reticulum"
        packets={[initial]}
        onClear={vi.fn()}
        getNodeLabel={() => 'node'}
      />,
    );

    mockScrollToEnd.mockClear();
    const newer = reticulumPacket(1_710_000_001_000, 'TCP');
    rerender(
      <RawPacketLogPanel
        variant="reticulum"
        packets={[initial, newer]}
        onClear={vi.fn()}
        getNodeLabel={() => 'node'}
      />,
    );

    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(mockScrollToIndex).not.toHaveBeenCalled();
  });

  it('preserves scroll anchor when not pinned and new packets arrive', () => {
    mockIsAtEnd = false;
    const packets = [reticulumPacket(1_710_000_000_000), reticulumPacket(1_710_000_001_000)];
    const { container, rerender } = render(
      <RawPacketLogPanel
        variant="reticulum"
        packets={packets}
        onClear={vi.fn()}
        getNodeLabel={() => 'node'}
      />,
    );

    const scrollContainer = container.querySelector('[role="log"]')!;
    fireEvent.scroll(scrollContainer);

    mockScrollToEnd.mockClear();
    mockScrollToIndex.mockClear();

    rerender(
      <RawPacketLogPanel
        variant="reticulum"
        packets={[...packets, reticulumPacket(1_710_000_002_000)]}
        onClear={vi.fn()}
        getNodeLabel={() => 'node'}
      />,
    );

    expect(mockScrollToEnd).not.toHaveBeenCalled();
    expect(mockScrollToIndex).toHaveBeenCalledWith(0, { align: 'start' });
  });
});

describe('RawPacketLogPanel duplicate row keys', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does not warn when two identical captures share content but differ by index', () => {
    const packet = meshcorePacket(
      '150107819d28f7a0d427af7cbd3c6057b29763736b3878eb027514687b110abe33456565ca1117316f81033b1de05496a57ab1c44335f53749008b593a19cd9c9e340d34f076',
      'GRP_TXT',
    );
    render(
      <RawPacketLogPanel
        variant="meshcore"
        packets={[packet, { ...packet }]}
        onClear={vi.fn()}
        getNodeLabel={() => 'node'}
      />,
    );

    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter((args: unknown[]) =>
      String(args[0]).includes('Encountered two children with the same key'),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);
  });
});

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
    ts: overrides.ts ?? 1_710_000_000_000,
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

  it('keeps expanded row open when new packets arrive', () => {
    const initial = meshtasticPacket({ portLabel: 'TEXT_MESSAGE_APP' });
    const { rerender } = render(
      <RawPacketLogPanel
        variant="meshtastic"
        packets={[initial]}
        onClear={vi.fn()}
        getNodeLabel={() => 'TestNode'}
      />,
    );

    fireEvent.click(screen.getByText('TEXT_MESSAGE_APP'));
    expect(screen.getByText(/id=0x12345678/)).toBeInTheDocument();

    const newer = meshtasticPacket({ portLabel: 'POSITION_APP', ts: 1_710_000_001_000 });
    rerender(
      <RawPacketLogPanel
        variant="meshtastic"
        packets={[initial, newer]}
        onClear={vi.fn()}
        getNodeLabel={() => 'TestNode'}
      />,
    );

    expect(screen.getByText(/id=0x12345678/)).toBeInTheDocument();
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
      meshtasticPacket({ portLabel: 'POSITION_APP', ts: 1_710_000_001_000 }),
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
