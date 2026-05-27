import type { NodeRecord } from '../stores/nodeStore';
import { describe, expect, it } from 'vitest';

import {
  meshcoreRawPacketSenderColumnText,
  nodeDisplayName,
  nodeLabelForRawPacket,
  nodeLongNameOrHexLabel,
} from './nodeLongNameOrHex';
describe('nodeDisplayName', () => {
  it('MeshCore prefers longName then shortName', () => {
    const a = { nodeId: 1, longName: 'L', shortName: 'S' } as NodeRecord;
    expect(nodeDisplayName(a, 'meshcore')).toBe('L');
    const b = { nodeId: 1, shortName: 'OnlyShort' } as NodeRecord;
    expect(nodeDisplayName(b, 'meshcore')).toBe('OnlyShort');
  });

  it('Meshtastic prefers shortName then longName', () => {
    const a = { nodeId: 1, longName: 'L', shortName: 'S' } as NodeRecord;
    expect(nodeDisplayName(a, 'meshtastic')).toBe('S');
    const b = { nodeId: 1, longName: 'LongOnly' } as NodeRecord;
    expect(nodeDisplayName(b, 'meshtastic')).toBe('LongOnly');
  });
});

describe('nodeLabelForRawPacket', () => {
  it('returns display name when set', () => {
    const node = { nodeId: 1, longName: 'Alice', shortName: 'A' } as NodeRecord;
    expect(nodeLabelForRawPacket(node, 0x10, 'meshcore')).toBe('Alice');
  });

  it('returns uppercase hex when no name (matches legacy bare id)', () => {
    expect(nodeLabelForRawPacket(undefined, 0xdeadbeef, 'meshcore')).toBe('DEADBEEF');
    expect(nodeLabelForRawPacket({ nodeId: 1, shortName: 'Bob' } as NodeRecord, 0x1, 'meshtastic')).toBe('Bob');
  });
});

describe('nodeLongNameOrHexLabel', () => {
  it('returns trimmed longName when set', () => {
    const node = { nodeId: 1, longName: '  Alice  ' } as NodeRecord;
    expect(nodeLongNameOrHexLabel(node, 0x1234)).toBe('Alice');
  });

  it('returns uppercase hex when longName missing or empty', () => {
    expect(nodeLongNameOrHexLabel(undefined, 0xdeadbeef)).toBe('DEADBEEF');
    expect(nodeLongNameOrHexLabel({ nodeId: 1, longName: '' } as NodeRecord, 0x1a)).toBe('1A');
    expect(nodeLongNameOrHexLabel({ nodeId: 1, longName: '   ' } as NodeRecord, 0xff)).toBe('FF');
  });
});

describe('meshcoreRawPacketSenderColumnText', () => {
  it('shows 0x id once when label is bare hex fallback', () => {
    const getNodeLabel = (id: number) => id.toString(16).toUpperCase();
    expect(meshcoreRawPacketSenderColumnText(0xff, getNodeLabel)).toBe('0xFF');
  });

  it('shows name and 0x id when contact has a display name', () => {
    const getNodeLabel = () => 'Alice';
    expect(meshcoreRawPacketSenderColumnText(0xabc, getNodeLabel)).toBe('Alice · 0xABC');
  });
});
