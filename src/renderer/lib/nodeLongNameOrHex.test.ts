import { describe, expect, it } from 'vitest';

import {
  meshcoreRawPacketSenderColumnText,
  nodeDisplayName,
  nodeLabelForRawPacket,
  nodeLongNameOrHexLabel,
} from './nodeLongNameOrHex';
import type { MeshNode } from './types';

describe('nodeDisplayName', () => {
  it('MeshCore prefers long_name then short_name', () => {
    const a = { long_name: 'L', short_name: 'S' } as MeshNode;
    expect(nodeDisplayName(a, 'meshcore')).toBe('L');
    const b = { short_name: 'OnlyShort' } as MeshNode;
    expect(nodeDisplayName(b, 'meshcore')).toBe('OnlyShort');
  });

  it('Meshtastic prefers short_name then long_name', () => {
    const a = { long_name: 'L', short_name: 'S' } as MeshNode;
    expect(nodeDisplayName(a, 'meshtastic')).toBe('S');
    const b = { long_name: 'LongOnly' } as MeshNode;
    expect(nodeDisplayName(b, 'meshtastic')).toBe('LongOnly');
  });
});

describe('nodeLabelForRawPacket', () => {
  it('returns display name when set', () => {
    const node = { long_name: 'Alice', short_name: 'A' } as MeshNode;
    expect(nodeLabelForRawPacket(node, 0x10, 'meshcore')).toBe('Alice');
  });

  it('returns uppercase hex when no name (matches legacy bare id)', () => {
    expect(nodeLabelForRawPacket(undefined, 0xdeadbeef, 'meshcore')).toBe('DEADBEEF');
    expect(nodeLabelForRawPacket({ short_name: 'Bob' } as MeshNode, 0x1, 'meshtastic')).toBe('Bob');
  });
});

describe('nodeLongNameOrHexLabel', () => {
  it('returns trimmed long_name when set', () => {
    const node = { long_name: '  Alice  ' } as MeshNode;
    expect(nodeLongNameOrHexLabel(node, 0x1234)).toBe('Alice');
  });

  it('returns uppercase hex when long_name missing or empty', () => {
    expect(nodeLongNameOrHexLabel(undefined, 0xdeadbeef)).toBe('DEADBEEF');
    expect(nodeLongNameOrHexLabel({ long_name: '' } as MeshNode, 0x1a)).toBe('1A');
    expect(nodeLongNameOrHexLabel({ long_name: '   ' } as MeshNode, 0xff)).toBe('FF');
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
