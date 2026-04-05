import { describe, expect, it } from 'vitest';

import type { MeshNode } from '../../renderer/lib/types';
import { meshNodeToCot } from './cot-converter';

function makeNode(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 1234567890,
    long_name: 'Test Node',
    short_name: 'TST',
    hw_model: 'TBEAM',
    snr: 5,
    battery: 75,
    last_heard: Date.now(),
    latitude: 39.7392,
    longitude: -104.9903,
    altitude: 1600,
    ...overrides,
  };
}

describe('meshNodeToCot', () => {
  it('returns null when latitude is null', () => {
    const node = makeNode({ latitude: null });
    expect(meshNodeToCot(node)).toBeNull();
  });

  it('returns null when longitude is null', () => {
    const node = makeNode({ longitude: null });
    expect(meshNodeToCot(node)).toBeNull();
  });

  it('produces valid XML for a node with position', () => {
    const node = makeNode();
    const cot = meshNodeToCot(node);
    expect(cot).not.toBeNull();
    expect(cot).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(cot).toContain('<event ');
    expect(cot).toContain('</event>');
  });

  it('uses correct CoT type for friendly ground unit', () => {
    const cot = meshNodeToCot(makeNode());
    expect(cot).toContain('type="a-f-G-U-C"');
  });

  it('uses MESH- prefix with decimal node_id', () => {
    const node = makeNode({ node_id: 987654 });
    const cot = meshNodeToCot(node);
    expect(cot).toContain('uid="MESH-987654"');
  });

  it('embeds lat/lon in the point element', () => {
    const node = makeNode({ latitude: 39.7392, longitude: -104.9903 });
    const cot = meshNodeToCot(node);
    expect(cot).toContain('lat="39.7392"');
    expect(cot).toContain('lon="-104.9903"');
  });

  it('uses altitude as hae value', () => {
    const node = makeNode({ altitude: 1600 });
    const cot = meshNodeToCot(node);
    expect(cot).toContain('hae="1600"');
  });

  it('defaults hae to 0 when altitude is missing', () => {
    const node = makeNode({ altitude: undefined });
    const cot = meshNodeToCot(node);
    expect(cot).toContain('hae="0"');
  });

  it('includes battery in status element', () => {
    const node = makeNode({ battery: 82 });
    const cot = meshNodeToCot(node);
    expect(cot).toContain('battery="82"');
  });

  it('includes short_name as callsign', () => {
    const node = makeNode({ short_name: 'ALPHA' });
    const cot = meshNodeToCot(node);
    expect(cot).toContain('callsign="ALPHA"');
  });

  it('escapes XML special chars in short_name', () => {
    const node = makeNode({ short_name: 'A&B<C>' });
    const cot = meshNodeToCot(node);
    expect(cot).toContain('callsign="A&amp;B&lt;C&gt;"');
  });

  it('escapes XML special chars in long_name', () => {
    const node = makeNode({ long_name: '"Hello" & <World>' });
    const cot = meshNodeToCot(node);
    expect(cot).toContain('&quot;Hello&quot; &amp; &lt;World&gt;');
  });

  it('sets stale approximately 10 minutes after time', () => {
    const before = Date.now();
    const cot = meshNodeToCot(makeNode())!;
    const after = Date.now();

    const timeMatch = /time="([^"]+)"/.exec(cot);
    const staleMatch = /stale="([^"]+)"/.exec(cot);
    expect(timeMatch).not.toBeNull();
    expect(staleMatch).not.toBeNull();

    const timeMs = new Date(timeMatch![1]).getTime();
    const staleMs = new Date(staleMatch![1]).getTime();
    const diff = staleMs - timeMs;

    expect(timeMs).toBeGreaterThanOrEqual(before);
    expect(timeMs).toBeLessThanOrEqual(after);
    expect(diff).toBeGreaterThanOrEqual(9 * 60 * 1000);
    expect(diff).toBeLessThanOrEqual(11 * 60 * 1000);
  });

  it('falls back to node_id string when short_name is empty', () => {
    const node = makeNode({ node_id: 42, short_name: '' });
    const cot = meshNodeToCot(node);
    expect(cot).toContain('callsign="42"');
  });
});
