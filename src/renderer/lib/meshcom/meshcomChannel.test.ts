import { describe, expect, it } from 'vitest';

import {
  isMeshcomGroupDest,
  meshcomOutboundDest,
  resolveMeshcomDestination,
} from './meshcomChannel';

describe('meshcomChannel', () => {
  it('resolves ALL, group, and DM destinations', () => {
    expect(resolveMeshcomDestination('*')).toMatchObject({ channelIndex: 0, wireDest: '*' });
    expect(resolveMeshcomDestination('232')).toMatchObject({
      channelIndex: 232,
      wireDest: '232',
    });
    expect(resolveMeshcomDestination('oe1abc-1').channelIndex).toBe(-1);
    expect(resolveMeshcomDestination('oe1abc-1').wireDest).toBe('OE1ABC-1');
  });

  it('picks outbound dest from channelIndex over callsign', () => {
    expect(meshcomOutboundDest({ channelIndex: 20, destinationCallsign: 'OE1ABC-1' })).toBe('20');
    expect(meshcomOutboundDest({ destinationCallsign: '*' })).toBe('*');
    expect(isMeshcomGroupDest('100001')).toBe(false);
    expect(isMeshcomGroupDest('99999')).toBe(true);
  });
});
