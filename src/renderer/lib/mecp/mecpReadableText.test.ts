import { describe, expect, it } from 'vitest';

import { decode, encode, getByteLength, MAX_MESSAGE_BYTES } from './engine';
import { encodeReadableMecp, stripMecpReadableSummary } from './mecpReadableText';

describe('encodeReadableMecp', () => {
  it.each([
    [0, 'MAYDAY'],
    [1, 'URGENT'],
    [2, 'SAFETY'],
    [3, 'ROUTINE'],
  ] as const)('explains severity %i for clients showing plain text', (severity, label) => {
    const result = encodeReadableMecp(severity, ['M01']);
    expect(result.message).toBe(`MECP/${severity}/M01 [${label}: Injury]`);
    expect(result.overLimit).toBe(false);
    expect(decode(result.message)).toMatchObject({ valid: true, severity, codes: ['M01'] });
  });

  it('retains code order, user text, and all decoder metadata before its summary', () => {
    const codes = ['R03', 'M01', 'P05'];
    const details = '15 2pax 39.7392,-104.9903 #ABCD ~K0TEST @1234 @en near the ridge';
    const result = encodeReadableMecp(1, codes, details);
    const compact = decode(encode(1, codes, details).message);
    const parsed = decode(result.message);
    expect(result.message).toBe(
      `MECP/1/R03 M01 P05 ${details} [URGENT: ETA [minutes]; Injury; At GPS coordinates]`,
    );
    expect(parsed.codes).toEqual(codes);
    expect(parsed.extracted).toEqual(compact.extracted);
    expect(parsed.extracted).toEqual({
      eta: 15,
      count: 2,
      gps: { lat: 39.7392, lon: -104.9903 },
      reference: 'ABCD',
      callsign: 'K0TEST',
      timestamp: '1234',
      language: 'en',
    });
    expect(stripMecpReadableSummary(parsed.freetext!, 1, parsed.codes)).toBe(details);
  });

  it.each([
    ['D01', 'DRILL ONLY', 'This is a drill'],
    ['D02', 'TEST ONLY', 'This is a test'],
  ])('makes %s unmistakable even at MAYDAY severity', (code, label, meaning) => {
    const result = encodeReadableMecp(0, [code, 'M01'], '1pax practice');
    expect(result.message).toBe(`MECP/0/${code} M01 1pax practice [${label}: ${meaning}; Injury]`);
    expect(result.message).not.toContain('MAYDAY');
    expect(decode(result.message).isDrill).toBe(true);
  });

  it('prioritizes the test label when both drill and test codes are present', () => {
    expect(encodeReadableMecp(1, ['D01', 'D02']).message).toBe(
      'MECP/1/D01 D02 [TEST ONLY: This is a drill; This is a test]',
    );
  });

  it('does not classify end-of-drill or sent-in-error codes as active drills', () => {
    const result = encodeReadableMecp(3, ['D03']);
    expect(result.message).toBe('MECP/3/D03 [ROUTINE: End of drill]');
    expect(decode(result.message).isDrill).toBe(false);
  });

  it('explains an acknowledgement as receipt without promising assistance', () => {
    const result = encodeReadableMecp(3, ['R01', 'D02']);
    expect(result.message).toBe('MECP/3/R01 D02 [TEST ONLY: Received; This is a test]');
    expect(result.message).not.toContain('Help coming');
  });

  it.each([
    [0, 'MAYDAY'],
    [1, 'URGENT'],
    [2, 'SAFETY'],
    [3, 'ROUTINE'],
  ] as const)('identifies an acknowledgement of severity %i as an ACK', (severity, label) => {
    expect(encodeReadableMecp(severity, ['R01', 'M01']).message).toBe(
      `MECP/${severity}/R01 M01 [${label} ACK: Received]`,
    );
  });

  it.each(['R02', 'R07'])('does not promise actions from the original %s report', (echoedCode) => {
    const codes = ['R01', echoedCode, 'R03', 'M01'];
    const details = '15 2pax 39.7392,-104.9903 #ABCD ~K0TEST';
    const result = encodeReadableMecp(0, codes, details);
    expect(result.message).toBe(`MECP/0/${codes.join(' ')} ${details} [MAYDAY ACK: Received]`);
    expect(result.message).not.toContain('Help coming');
    expect(result.message).not.toContain('all clear');
    const parsed = decode(result.message);
    expect(parsed.codes).toEqual(codes);
    expect(parsed.extracted).toEqual(decode(encode(0, codes, details).message).extracted);
    expect(stripMecpReadableSummary(parsed.freetext!, 0, parsed.codes)).toBe(details);
  });

  it.each([
    ['D01', 'DRILL ONLY', 'This is a drill'],
    ['D02', 'TEST ONLY', 'This is a test'],
  ])('keeps %s acknowledgements visibly simulated', (code, label, meaning) => {
    expect(encodeReadableMecp(0, ['R01', 'R02', code]).message).toBe(
      `MECP/0/R01 R02 ${code} [${label}: Received; ${meaning}]`,
    );
  });

  it('explains a beacon acknowledgement as receipt without promising assistance', () => {
    expect(encodeReadableMecp(2, ['B02']).message).toBe('MECP/2/B02 [SAFETY: Beacon received]');
  });

  it('keeps unknown codes without inventing their meaning', () => {
    const result = encodeReadableMecp(2, ['Z99', 'M01']);
    expect(result.message).toBe('MECP/2/Z99 M01 [SAFETY: Z99; Injury]');
    expect(decode(result.message).codes).toEqual(['Z99', 'M01']);
  });

  it('keeps severity visible when there are no selected codes', () => {
    expect(encodeReadableMecp(3, []).message).toBe('MECP/3/ [ROUTINE]');
  });

  it('counts UTF-8 bytes and accepts exactly the transport budget', () => {
    const result = encodeReadableMecp(3, ['D02'], 'café 🐻');
    const byteLength = getByteLength(result.message);
    expect(byteLength).toBeGreaterThan(result.message.length);
    expect(encodeReadableMecp(3, ['D02'], 'café 🐻', byteLength)).toMatchObject({
      message: result.message,
      byteLength,
      overLimit: false,
      warnings: [],
    });
    const tooLong = encodeReadableMecp(3, ['D02'], 'café 🐻', byteLength - 1);
    expect(tooLong).toMatchObject({ message: result.message, byteLength, overLimit: true });
    expect(tooLong.warnings).toEqual([
      `Message is ${byteLength} bytes, exceeds ${byteLength - 1} byte limit`,
    ]);
  });

  it('never truncates user content or drops codes to fit a smaller transport', () => {
    const details = `2pax ${'é'.repeat(85)} 39.7,-105.0`;
    const result = encodeReadableMecp(0, ['M01', 'M07', 'P05'], details, 130);
    expect(result.message).toBe(
      `MECP/0/M01 M07 P05 ${details} [MAYDAY: Injury; Fracture / immobile; At GPS coordinates]`,
    );
    expect(result.overLimit).toBe(true);
    expect(result.warnings).toContain(
      `Message is ${result.byteLength} bytes, exceeds 130 byte limit`,
    );
    expect(decode(result.message).codes).toEqual(['M01', 'M07', 'P05']);
  });

  it('retains the protocol limit when a transport allows more than 200 bytes', () => {
    const result = encodeReadableMecp(3, ['L01'], 'x'.repeat(MAX_MESSAGE_BYTES), 1000);
    expect(result.overLimit).toBe(true);
    expect(result.warnings).toEqual([
      `Message is ${result.byteLength} bytes, exceeds ${MAX_MESSAGE_BYTES} byte limit`,
    ]);
  });

  it('retains validation warnings from the vendored encoder', () => {
    expect(encodeReadableMecp(3, ['invalid']).warnings).toContain('Invalid code format: "invalid"');
  });
});

describe('stripMecpReadableSummary', () => {
  it('removes the generated summary from a code-only message', () => {
    expect(stripMecpReadableSummary('[MAYDAY: Injury]', 0, ['M01'])).toBe('');
  });

  it('recognizes equivalent casing and whitespace while preserving operator text', () => {
    expect(stripMecpReadableSummary('2pax east ridge \n [mayday:\tINJURY] \n', 0, ['M01'])).toBe(
      '2pax east ridge',
    );
  });

  it('matches labels containing brackets without stripping their preceding details', () => {
    expect(stripMecpReadableSummary('15 [URGENT: ETA [minutes]; Injury]', 1, ['R03', 'M01'])).toBe(
      '15',
    );
  });

  it.each([
    '2pax [MAYDAY: Severe bleeding]',
    '2pax [URGENT: Injury]',
    '2pax [MAYDAY: Injury] operator comment',
    '2pax [MAYDAY: Injury; Flooding]',
    '2pax [MAYDAY: Injury - near road]',
    '2pax MAYDAY: Injury',
  ])('preserves independent prose: %s', (details) => {
    expect(stripMecpReadableSummary(details, 0, ['M01'])).toBe(details);
  });

  it('requires the selected code order and all meanings to match', () => {
    const details = '2pax [MAYDAY: Flooding; Injury]';
    expect(stripMecpReadableSummary(details, 0, ['M01', 'T04'])).toBe(details);
    expect(stripMecpReadableSummary(details, 0, ['T04', 'M01'])).toBe('2pax');
  });
});
