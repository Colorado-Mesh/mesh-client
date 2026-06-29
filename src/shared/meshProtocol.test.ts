import { describe, expect, it } from 'vitest';

import {
  isMeshProtocol,
  MESH_PROTOCOL_SET,
  meshProtocolSqlInList,
  REGISTERED_MESH_PROTOCOLS,
} from './meshProtocol';

describe('meshProtocol', () => {
  it('REGISTERED_MESH_PROTOCOLS includes meshtastic and meshcore', () => {
    expect(REGISTERED_MESH_PROTOCOLS).toEqual(['meshtastic', 'meshcore']);
  });

  it('isMeshProtocol narrows known protocols', () => {
    expect(isMeshProtocol('meshtastic')).toBe(true);
    expect(isMeshProtocol('reticulum')).toBe(false);
  });

  it('MESH_PROTOCOL_SET matches registered list', () => {
    for (const p of REGISTERED_MESH_PROTOCOLS) {
      expect(MESH_PROTOCOL_SET.has(p)).toBe(true);
    }
  });

  it('meshProtocolSqlInList matches registered protocols', () => {
    expect(meshProtocolSqlInList()).toBe("'meshtastic','meshcore'");
  });
});
