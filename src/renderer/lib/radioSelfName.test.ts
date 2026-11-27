import { describe, expect, it } from 'vitest';

import { usableRadioLongName } from './radioSelfName';

describe('usableRadioLongName', () => {
  it('returns a trimmed radio long name', () => {
    expect(usableRadioLongName('  Ridge Fox  ', 0x1234, 'meshtastic')).toBe('Ridge Fox');
    expect(usableRadioLongName('N0CALL', 0x1234, 'meshcom')).toBe('N0CALL');
    expect(usableRadioLongName('Colorado Repeater', 0x1a2b, 'meshcore')).toBe('Colorado Repeater');
  });

  it('rejects missing names', () => {
    expect(usableRadioLongName(undefined, 1, 'meshtastic')).toBeUndefined();
    expect(usableRadioLongName(null, 1, 'meshtastic')).toBeUndefined();
    expect(usableRadioLongName('   ', 1, 'meshtastic')).toBeUndefined();
  });

  it('rejects Meshtastic hex placeholder long names', () => {
    expect(usableRadioLongName('!1a2b3c4d', 0x1a2b3c4d, 'meshtastic')).toBeUndefined();
    expect(usableRadioLongName('!1a2b3c4d', 0, 'meshtastic')).toBe('!1a2b3c4d');
  });

  it('rejects MeshCore generated node-id names', () => {
    expect(usableRadioLongName('Node-1A2B', 0x1a2b, 'meshcore')).toBeUndefined();
    expect(usableRadioLongName('Node-Alpha', 0x1a2b, 'meshcore')).toBe('Node-Alpha');
  });

  it('keeps placeholder-shaped names on protocols that do not generate them', () => {
    expect(usableRadioLongName('!1a2b3c4d', 0x1a2b3c4d, 'meshcom')).toBe('!1a2b3c4d');
    expect(usableRadioLongName('Node-1A2B', 0x1a2b, 'meshtastic')).toBe('Node-1A2B');
  });
});
