import { describe, expect, it } from 'vitest';

import { getSerialPortNodeName, SERIAL_PORT_NODE_NAMES_KEY } from './serialPortNodeNames';

describe('serialPortNodeNames', () => {
  it('returns null for missing port', () => {
    expect(getSerialPortNodeName('mesh-client:nonexistent')).toBeNull();
  });

  it('returns cached node name', () => {
    localStorage.setItem(
      SERIAL_PORT_NODE_NAMES_KEY,
      JSON.stringify({ 'mesh-client:port1': 'Node 1' }),
    );
    expect(getSerialPortNodeName('mesh-client:port1')).toBe('Node 1');
  });

  it('returns null for invalid JSON', () => {
    localStorage.setItem(SERIAL_PORT_NODE_NAMES_KEY, 'not json');
    expect(getSerialPortNodeName('mesh-client:port1')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    localStorage.setItem(SERIAL_PORT_NODE_NAMES_KEY, JSON.stringify(['not', 'an', 'object']));
    expect(getSerialPortNodeName('mesh-client:port1')).toBeNull();
  });
});
