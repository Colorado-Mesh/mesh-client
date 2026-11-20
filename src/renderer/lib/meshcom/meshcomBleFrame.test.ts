/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { parseMeshcomBleFrames, sanitizeMeshcomBleJsonText } from './meshcomBleFrame';

describe('sanitizeMeshcomBleJsonText', () => {
  it('strips trailing NUL padding from firmware blelen+2 notifies', () => {
    expect(sanitizeMeshcomBleJsonText('{"TYP":"I"}\0\0')).toBe('{"TYP":"I"}');
  });
});

describe('parseMeshcomBleFrames', () => {
  it('parses D{ JSON notifies that include trailing NUL padding', () => {
    const body = 'D{"TYP":"I","CALL":"NV0N-20"}';
    const chunk = new Uint8Array(body.length + 2);
    chunk.set(new TextEncoder().encode(body), 0);
    // Firmware pads with zeros (blelen + 2 send length).
    const frames = parseMeshcomBleFrames(chunk);
    expect(frames).toEqual([{ kind: 'json', json: '{"TYP":"I","CALL":"NV0N-20"}' }]);
    expect(() => JSON.parse((frames[0] as { json: string }).json)).not.toThrow();
  });

  it('parses unpadded D{ JSON', () => {
    const chunk = new TextEncoder().encode('D{"TYP":"CONFFIN"}');
    expect(parseMeshcomBleFrames(chunk)).toEqual([{ kind: 'json', json: '{"TYP":"CONFFIN"}' }]);
  });
});
