import { describe, expect, it } from 'vitest';

import { getNodeTypeIcon } from './nodeIcons';

describe('getNodeTypeIcon', () => {
  it('returns repeater badge path', () => {
    expect(getNodeTypeIcon('Repeater')).not.toBeNull();
  });

  it('returns room badge path', () => {
    expect(getNodeTypeIcon('Room')).not.toBeNull();
  });

  it('returns sensor badge path', () => {
    expect(getNodeTypeIcon('Sensor')).not.toBeNull();
  });

  it('returns null for unknown hwModel', () => {
    expect(getNodeTypeIcon('Unknown')).toBeNull();
    expect(getNodeTypeIcon('')).toBeNull();
    expect(getNodeTypeIcon('MeshCore')).toBeNull();
  });
});
