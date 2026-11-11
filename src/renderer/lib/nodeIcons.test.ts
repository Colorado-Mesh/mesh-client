import { describe, expect, it } from 'vitest';

import { getNodeTypeIcon, NODE_BADGE_PATHS } from './nodeIcons';

describe('getNodeTypeIcon', () => {
  it('returns repeater badge path', () => {
    expect(getNodeTypeIcon('Repeater')).toBe(NODE_BADGE_PATHS.repeater);
  });

  it('returns room badge path', () => {
    expect(getNodeTypeIcon('Room')).toBe(NODE_BADGE_PATHS.room);
  });

  it('returns sensor badge path', () => {
    expect(getNodeTypeIcon('Sensor')).toBe(NODE_BADGE_PATHS.sensor);
  });

  it('returns null for unknown hwModel', () => {
    expect(getNodeTypeIcon('Unknown')).toBeNull();
    expect(getNodeTypeIcon('')).toBeNull();
    expect(getNodeTypeIcon('MeshCore')).toBeNull();
  });
});
