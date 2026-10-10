import { describe, expect, it } from 'vitest';

import {
  isMeshProtocol,
  MESH_PROTOCOL_SET,
  meshProtocolSqlInList,
  REGISTERED_MESH_PROTOCOLS,
} from './meshProtocol';

describe('meshProtocol', () => {
  it('registers Meshtastic and MeshCore only', () => {
    expect(REGISTERED_MESH_PROTOCOLS).toEqual(['meshtastic', 'meshcore']);
  });

  it('isMeshProtocol narrows known protocols and rejects retired or unknown ones', () => {
    expect(isMeshProtocol('meshtastic')).toBe(true);
    expect(isMeshProtocol('meshcore')).toBe(true);
    expect(isMeshProtocol('reticulum')).toBe(false);
    expect(isMeshProtocol('')).toBe(false);
  });

  it('meshProtocolSqlInList matches registered protocols', () => {
    expect(meshProtocolSqlInList()).toBe("'meshtastic','meshcore'");
  });

  it('MESH_PROTOCOL_SET matches registered list', () => {
    for (const p of REGISTERED_MESH_PROTOCOLS) {
      expect(MESH_PROTOCOL_SET.has(p)).toBe(true);
    }
    expect(MESH_PROTOCOL_SET.size).toBe(REGISTERED_MESH_PROTOCOLS.length);
  });
});
