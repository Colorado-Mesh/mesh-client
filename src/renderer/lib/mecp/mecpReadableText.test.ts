import { describe, expect, it } from 'vitest';

import { decode, encode, getByteLength, MAX_MESSAGE_BYTES } from './engine';
import german from './languages/de.json';
import english from './languages/en.json';
import russian from './languages/ru.json';
import {
  encodeReadableMecp,
  MECP_EXPLANATION_LANGUAGES,
  MECP_HELP_URL,
  stripMecpReadableSummary,
} from './mecpReadableText';

describe('encodeReadableMecp', () => {
  it.each([0, 1, 2, 3] as const)('keeps severity %i compact by default', (severity) => {
    const codes = ['M01', 'P05'];
    const details = '2pax 39.7392,-104.9903 #ABCD ~K0TEST';
    expect(encodeReadableMecp(severity, codes, details)).toEqual(encode(severity, codes, details));
  });

  it('ships native-name choices for exactly the installed language packs', () => {
    const installed = Object.keys(import.meta.glob('./languages/*.json'))
      .map((path) => path.replace('./languages/', '').replace('.json', ''))
      .sort();
    expect(MECP_EXPLANATION_LANGUAGES.map((language) => language.id).sort()).toEqual(installed);
    expect(MECP_EXPLANATION_LANGUAGES).toHaveLength(15);
    expect(MECP_EXPLANATION_LANGUAGES).toContainEqual({ id: 'de', name: 'Deutsch' });
    expect(MECP_EXPLANATION_LANGUAGES).toContainEqual({ id: 'ru', name: 'Русский' });
  });

  it.each([
    ['en', 'Injury'],
    ['de', 'Verletzung'],
    ['ru', 'Травма'],
  ])('adds an explanation only in explicitly selected %s', (language, meaning) => {
    expect(
      encodeReadableMecp(0, ['M01'], undefined, 200, { explanationLanguage: language }).message,
    ).toBe(`MECP/0/M01 [${language}: ${meaning}]`);
  });

  it.each(['zz', 'en-US', '', 'DE'])('rejects unsupported explicit language %s', (language) => {
    expect(() =>
      encodeReadableMecp(0, ['M01'], undefined, 200, { explanationLanguage: language }),
    ).toThrow(new RangeError(`Unsupported MECP explanation language: ${language}`));
  });

  it('retains code order, notes, and all decoder metadata before the optional tails', () => {
    const codes = ['R03', 'M01', 'P05'];
    const details = '15 2pax 39.7392,-104.9903 #ABCD ~K0TEST @1234 @en near the ridge';
    const result = encodeReadableMecp(1, codes, details, 200, {
      explanationLanguage: 'de',
      includeHelpLink: true,
    });
    expect(result.message).toBe(
      `MECP/1/R03 M01 P05 ${details} [de: ${german.codes.R03}; Verletzung; ${german.codes.P05}] ${MECP_HELP_URL}`,
    );
    const parsed = decode(result.message);
    expect(parsed.codes).toEqual(codes);
    expect(parsed.extracted).toEqual(decode(encode(1, codes, details).message).extracted);
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
    ['D01', german.codes.D01],
    ['D02', german.codes.D02],
  ])('puts the translated %s warning before other meanings', (code, meaning) => {
    const result = encodeReadableMecp(0, ['M01', code], '1pax practice', 200, {
      explanationLanguage: 'de',
    });
    expect(result.message).toBe(`MECP/0/M01 ${code} 1pax practice [de: ${meaning}; Verletzung]`);
    expect(decode(result.message)).toMatchObject({ codes: ['M01', code], isDrill: true });
  });

  it('puts test before drill labels when both are selected without changing wire code order', () => {
    expect(
      encodeReadableMecp(1, ['D01', 'M01', 'D02'], undefined, 200, {
        explanationLanguage: 'en',
      }).message,
    ).toBe('MECP/1/D01 M01 D02 [en: This is a test; This is a drill; Injury]');
  });

  it('does not classify the end-of-drill code as an active drill', () => {
    const result = encodeReadableMecp(3, ['D03'], undefined, 200, { explanationLanguage: 'en' });
    expect(result.message).toBe('MECP/3/D03 [en: End of drill]');
    expect(decode(result.message).isDrill).toBe(false);
  });

  it.each(['R02', 'R07'])(
    'does not claim actions echoed from the original %s report',
    (echoedCode) => {
      const codes = ['R01', echoedCode, 'R03', 'M01'];
      const details = '15 2pax 39.7392,-104.9903 #ABCD ~K0TEST';
      const result = encodeReadableMecp(0, codes, details, 200, { explanationLanguage: 'en' });
      expect(result.message).toBe(`MECP/0/${codes.join(' ')} ${details} [en: Acknowledged]`);
      expect(result.message).not.toContain(english.codes.R02);
      expect(result.message).not.toContain(english.codes.R07);
      const parsed = decode(result.message);
      expect(parsed.codes).toEqual(codes);
      expect(parsed.extracted).toEqual(decode(encode(0, codes, details).message).extracted);
      expect(stripMecpReadableSummary(parsed.freetext!, 0, parsed.codes)).toBe(details);
    },
  );

  it('explains translated ACK receipt and test context without echoing response actions', () => {
    expect(
      encodeReadableMecp(0, ['R01', 'R02', 'D02'], undefined, 200, {
        explanationLanguage: 'ru',
      }).message,
    ).toBe(`MECP/0/R01 R02 D02 [ru: ${russian.codes.D02}; ${russian.codes.R01}]`);
  });

  it('uses the selected pack for beacon acknowledgements', () => {
    expect(
      encodeReadableMecp(2, ['B02'], undefined, 200, { explanationLanguage: 'de' }).message,
    ).toBe(`MECP/2/B02 [de: ${german.codes.B02}]`);
  });

  it('keeps unknown codes without inventing a translated meaning', () => {
    const result = encodeReadableMecp(2, ['Z99', 'M01'], undefined, 200, {
      explanationLanguage: 'de',
    });
    expect(result.message).toBe('MECP/2/Z99 M01 [de: Z99; Verletzung]');
    expect(decode(result.message).codes).toEqual(['Z99', 'M01']);
  });

  it('adds only the exact help URL when requested independently of an explanation', () => {
    const compact = encodeReadableMecp(3, ['D02'], 'practice');
    const linked = encodeReadableMecp(3, ['D02'], 'practice', 200, { includeHelpLink: true });
    expect(compact.message).toBe('MECP/3/D02 practice');
    expect(linked.message).toBe(`MECP/3/D02 practice ${MECP_HELP_URL}`);
    expect(linked.byteLength - compact.byteLength).toBe(19);
  });

  it('counts translated UTF-8 bytes and accepts exactly the transport budget', () => {
    const options = { explanationLanguage: 'ru', includeHelpLink: true };
    const result = encodeReadableMecp(3, ['D02'], 'café 🐻', 200, options);
    const byteLength = getByteLength(result.message);
    expect(byteLength).toBeGreaterThan(result.message.length);
    expect(encodeReadableMecp(3, ['D02'], 'café 🐻', byteLength, options)).toMatchObject({
      message: result.message,
      byteLength,
      overLimit: false,
      warnings: [],
    });
    const tooLong = encodeReadableMecp(3, ['D02'], 'café 🐻', byteLength - 1, options);
    expect(tooLong).toMatchObject({ message: result.message, byteLength, overLimit: true });
    expect(tooLong.warnings).toEqual([
      `Message is ${byteLength} bytes, exceeds ${byteLength - 1} byte limit`,
    ]);
  });

  it('never drops notes, codes, explanation, or URL to fit a smaller transport', () => {
    const details = `2pax ${'é'.repeat(85)} 39.7,-105.0`;
    const result = encodeReadableMecp(0, ['M01', 'M07', 'P05'], details, 130, {
      explanationLanguage: 'en',
      includeHelpLink: true,
    });
    expect(result.message).toBe(
      `MECP/0/M01 M07 P05 ${details} [en: Injury; Fracture / immobile; At GPS coordinates] ${MECP_HELP_URL}`,
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
    expect(encodeReadableMecp(3, ['invalid'])).toEqual(encode(3, ['invalid']));
  });
});

describe('stripMecpReadableSummary', () => {
  it.each(MECP_EXPLANATION_LANGUAGES)(
    'recognizes installed $id without loading the UI pack',
    ({ id }) => {
      const details = '2pax east ridge';
      const codes = ['M01', 'D02'];
      const expanded = encodeReadableMecp(0, codes, details, 200, {
        explanationLanguage: id,
        includeHelpLink: true,
      });
      expect(stripMecpReadableSummary(decode(expanded.message).freetext!, 0, codes)).toBe(details);
    },
  );

  it('removes generated explanations from a code-only report', () => {
    expect(stripMecpReadableSummary('[de: Verletzung]', 0, ['M01'])).toBe('');
  });

  it('recognizes equivalent casing and whitespace while preserving operator notes', () => {
    expect(stripMecpReadableSummary('2pax east ridge \n [DE:\tVERLETZUNG] \n', 0, ['M01'])).toBe(
      '2pax east ridge',
    );
  });

  it('removes the exact standalone URL or localized summary plus URL together', () => {
    expect(stripMecpReadableSummary(`2pax east ridge ${MECP_HELP_URL}`, 0, ['M01'])).toBe(
      '2pax east ridge',
    );
    expect(
      stripMecpReadableSummary(`2pax east ridge [de: Verletzung] ${MECP_HELP_URL}`, 0, ['M01']),
    ).toBe('2pax east ridge');
  });

  it('matches translated labels containing brackets', () => {
    const notes = `15 [en: ${english.codes.R03}; Injury]`;
    expect(stripMecpReadableSummary(notes, 1, ['R03', 'M01'])).toBe('15');
  });

  it.each([
    '2pax [de: Blutung]',
    '2pax [de: Verletzung] operator comment',
    '2pax [de: Verletzung; Überschwemmung]',
    '2pax [de: Verletzung - near road]',
    '2pax de: Verletzung',
    '2pax [zz: Injury]',
    '2pax https://mecp.radio/help',
    '2pax https://mecp.radio.example',
    '2pax https://mecp.radio operator comment',
  ])('preserves independent prose: %s', (details) => {
    expect(stripMecpReadableSummary(details, 0, ['M01'])).toBe(details);
  });

  it('requires all translated meanings in the expected order', () => {
    const details = '2pax [en: Flooding; Injury]';
    expect(stripMecpReadableSummary(details, 0, ['M01', 'T04'])).toBe(details);
    expect(stripMecpReadableSummary(details, 0, ['T04', 'M01'])).toBe('2pax');
  });

  it.each([
    [0, ['M01'], '[MAYDAY: Injury]'],
    [1, ['R01', 'R02'], '[URGENT ACK: Received]'],
    [0, ['D01', 'M01'], '[DRILL ONLY: This is a drill; Injury]'],
    [0, ['R01', 'D02'], '[TEST ONLY: Received; This is a test]'],
  ] as const)(
    'recognizes previous English tails from persisted reports',
    (severity, codes, tail) => {
      expect(stripMecpReadableSummary(`2pax ridge ${tail}`, severity, codes)).toBe('2pax ridge');
    },
  );
});
