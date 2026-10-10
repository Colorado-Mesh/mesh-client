import { describe, expect, it } from 'vitest';

import type { MeshNode } from '../../renderer/lib/types';
import { cotDeleteEvent, cotPongEvent, meshNodeToCot } from './cot-converter';

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
    expect(cot!.startsWith('<event ')).toBe(true);
    expect(cot).not.toContain('<?xml');
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

describe('meshNodeToCot per protocol', () => {
  it('defaults to the Meshtastic uid prefix and short_name callsign', () => {
    const cot = meshNodeToCot(makeNode({ node_id: 7, short_name: 'ALPH', long_name: 'Alpha' }));
    expect(cot).toContain('uid="MESH-7"');
    expect(cot).toContain('callsign="ALPH"');
  });

  it('uses the MC- prefix and long_name callsign for MeshCore nodes', () => {
    const cot = meshNodeToCot(
      makeNode({ node_id: 7, short_name: '', long_name: 'Ridge Repeater' }),
      'meshcore',
    );
    expect(cot).toContain('uid="MC-7"');
    expect(cot).toContain('callsign="Ridge Repeater"');
  });

  it.each(['meshcore'] as const)(
    'falls back to node_id for %s nodes without a long_name',
    (protocol) => {
      const cot = meshNodeToCot(
        makeNode({ node_id: 99, short_name: 'X', long_name: '' }),
        protocol,
      );
      expect(cot).toContain('callsign="99"');
    },
  );

  it('escapes XML special chars in a MeshCore long_name callsign', () => {
    const cot = meshNodeToCot(makeNode({ long_name: 'A&B "base"' }), 'meshcore');
    expect(cot).toContain('callsign="A&amp;B &quot;base&quot;"');
  });
});

describe('meshNodeToCot relay fidelity', () => {
  const NOW = Date.parse('2026-10-09T12:00:00.000Z');

  it('sets start to when the node was last heard, given in seconds', () => {
    const heardSec = NOW / 1000 - 300;
    const cot = meshNodeToCot(makeNode({ last_heard: heardSec }), 'meshcore', { nowMs: NOW })!;
    expect(cot).toContain('time="2026-10-09T12:00:00.000Z"');
    expect(cot).toContain('start="2026-10-09T11:55:00.000Z"');
    expect(cot).toContain('stale="2026-10-09T12:10:00.000Z"');
  });

  it('accepts last_heard in milliseconds and never starts in the future', () => {
    const ms = meshNodeToCot(makeNode({ last_heard: NOW - 60_000 }), 'meshtastic', {
      nowMs: NOW,
    })!;
    expect(ms).toContain('start="2026-10-09T11:59:00.000Z"');
    const future = meshNodeToCot(makeNode({ last_heard: NOW + 60_000 }), 'meshtastic', {
      nowMs: NOW,
    })!;
    expect(future).toContain('start="2026-10-09T12:00:00.000Z"');
  });

  it('styles a MeshCore repeater from its advert type, without a team group', () => {
    const cot = meshNodeToCot(makeNode({ hw_model: 'Repeater' }), 'meshcore')!;
    expect(cot).toContain('type="a-f-G-I"');
    expect(cot).not.toContain('<__group');
  });

  it('keeps the cyan team member style for people', () => {
    const cot = meshNodeToCot(makeNode({ hw_model: 'Chat' }), 'meshcore')!;
    expect(cot).toContain('type="a-f-G-U-C"');
    expect(cot).toContain('<__group name="Cyan" role="Team Member"/>');
  });

  it('applies an explicit style and callsign', () => {
    const cot = meshNodeToCot(makeNode(), 'meshcore', {
      style: { cotType: 'a-f-G-E-V', group: 'Orange', role: 'Vehicle', color: '#FF0000' },
      callsign: 'Medic 1',
    })!;
    expect(cot).toContain('type="a-f-G-E-V"');
    expect(cot).toContain('<__group name="Orange" role="Vehicle"/>');
    expect(cot).toContain(`<color argb="${(0xffff0000 | 0).toString()}"/>`);
    expect(cot).toContain('callsign="Medic 1"');
  });

  it('describes how the node was heard in remarks', () => {
    const cot = meshNodeToCot(
      makeNode({ long_name: 'Ridge', hops_away: 2, last_heard: NOW / 1000 }),
      'meshcore',
      { nowMs: NOW },
    )!;
    expect(cot).toContain(
      '<remarks>Ridge | Heard via MeshCore RF | 2 hops | last heard 2026-10-09T12:00:00.000Z</remarks>',
    );
  });

  it('says MQTT for nodes heard only through MQTT and direct for zero hops', () => {
    const cot = meshNodeToCot(makeNode({ source: 'mqtt', hops_away: 0 }), 'meshtastic')!;
    expect(cot).toContain('Heard via Meshtastic MQTT | direct');
  });

  it('uses an explicit tracker uid and emits track and its stale window', () => {
    const cot = meshNodeToCot(
      { ...makeNode(), uid: 'meshtracker-a1b2c3d4', speed: 1.5, course: 90, stale_sec: 60 },
      'meshcore',
      { nowMs: NOW },
    )!;
    expect(cot).toContain('uid="meshtracker-a1b2c3d4"');
    expect(cot).toContain('<track course="90" speed="1.5"/>');
    expect(cot).toContain('stale="2026-10-09T12:01:00.000Z"');
  });

  it('omits track without motion fields', () => {
    expect(meshNodeToCot(makeNode())).not.toContain('<track');
  });
});

describe('cotDeleteEvent', () => {
  it('builds a forced delete addressed to the target uid', () => {
    const cot = cotDeleteEvent('MC-6', Date.parse('2026-10-09T12:00:00.000Z'));
    expect(cot).toContain('type="t-x-d-d"');
    expect(cot).toContain('time="2026-10-09T12:00:00.000Z"');
    expect(cot).toContain('<link uid="MC-6" relation="none" type="none"/><__forcedelete/>');
    expect(cot).not.toContain('uid="MC-6" type=');
  });

  it('escapes the target uid', () => {
    expect(cotDeleteEvent('a"b')).toContain('<link uid="a&quot;b"');
  });
});

describe('cotPongEvent', () => {
  it('builds a TAK Server style pong that goes stale shortly after', () => {
    const cot = cotPongEvent(Date.parse('2026-10-09T12:00:00.000Z'));
    expect(cot).toContain('uid="takPong"');
    expect(cot).toContain('type="t-x-c-t-r"');
    expect(cot).toContain('time="2026-10-09T12:00:00.000Z"');
    expect(cot).toContain('stale="2026-10-09T12:00:20.000Z"');
    expect(cot).toContain('<point lat="0" lon="0"');
    expect(cot.endsWith('</event>')).toBe(true);
  });
});

describe('stream framing', () => {
  it('writes every event bare so a second event on the stream still parses', () => {
    const node = makeNode({ latitude: 39.7, longitude: -105 });
    const stream = [meshNodeToCot(node), cotDeleteEvent('MC-6'), cotPongEvent()].join('\n');
    expect(stream).not.toContain('<?xml');
    expect(stream.split('\n').every((line) => line.startsWith('<event '))).toBe(true);
  });
});
