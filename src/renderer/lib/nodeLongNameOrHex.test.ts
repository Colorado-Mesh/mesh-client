import { describe, expect, it } from 'vitest';

import { nodeLongNameOrHexLabel } from './nodeLongNameOrHex';
import type { MeshNode } from './types';

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
