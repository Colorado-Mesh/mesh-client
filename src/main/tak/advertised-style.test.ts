import { describe, expect, it } from 'vitest';

import {
  advertisedTakStyle,
  TAK_PERSON_STYLE,
  TAK_RELAY_STYLE,
  TAK_SENSOR_STYLE,
  TAK_TRACKER_ROLE_STYLES,
} from './advertised-style';

describe('advertisedTakStyle', () => {
  it.each(['Repeater', 'Room'])('draws a MeshCore %s as a relay installation', (hw_model) => {
    expect(advertisedTakStyle({ hw_model }, 'meshcore')).toBe(TAK_RELAY_STYLE);
  });

  it('draws a MeshCore Sensor as sensor equipment', () => {
    expect(advertisedTakStyle({ hw_model: 'Sensor' }, 'meshcore')).toBe(TAK_SENSOR_STYLE);
  });

  it('draws a MeshCore Chat node as a person', () => {
    expect(advertisedTakStyle({ hw_model: 'Chat' }, 'meshcore')).toBe(TAK_PERSON_STYLE);
  });

  it.each([2, 3, 4, 11])('draws Meshtastic role %i as a relay installation', (role) => {
    expect(advertisedTakStyle({ role }, 'meshtastic')).toBe(TAK_RELAY_STYLE);
  });

  it('draws Meshtastic SENSOR role as sensor equipment', () => {
    expect(advertisedTakStyle({ role: 6 }, 'meshtastic')).toBe(TAK_SENSOR_STYLE);
  });

  it.each([0, 1, 5, 7, 10])('draws Meshtastic role %i as a person', (role) => {
    expect(advertisedTakStyle({ role }, 'meshtastic')).toBe(TAK_PERSON_STYLE);
  });

  it('ignores a MeshCore advert type name on a Meshtastic node', () => {
    expect(advertisedTakStyle({ hw_model: 'Repeater' }, 'meshtastic')).toBe(TAK_PERSON_STYLE);
  });

  it('prefers a known tracker role tag over everything else', () => {
    expect(advertisedTakStyle({ tracker_role: 'k9', hw_model: 'Repeater' }, 'meshcore')).toBe(
      TAK_TRACKER_ROLE_STYLES.k9,
    );
  });

  it('falls back from an unknown tracker role tag', () => {
    expect(advertisedTakStyle({ tracker_role: 'zz' }, 'meshcore')).toBe(TAK_PERSON_STYLE);
  });
});
