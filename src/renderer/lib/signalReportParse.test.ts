import { describe, expect, it } from 'vitest';

import { parseSignalReport, signalQualityFromSnr } from './signalReportParse';

describe('parseSignalReport: MeshMonitor', () => {
  it('parses the default multi-hop and direct templates', () => {
    expect(parseSignalReport('🤖 Copy, 4 hops at 12:51')).toEqual({
      source: 'meshMonitor',
      hops: 4,
      direct: false,
    });
    expect(parseSignalReport('🤖 Copy, 6 hops at 1:56 PM')).toMatchObject({ hops: 6 });
    expect(
      parseSignalReport('🤖 Copy, direct connection! SNR: 7.25dB RSSI: -80dBm at 12:51'),
    ).toEqual({ source: 'meshMonitor', direct: true, hops: 0, snr: 7.25, rssi: -80 });
  });
});

describe('parseSignalReport: Colorado-Mesh meshcore-bot-firmware', () => {
  it('parses test acks with and without hash size, phrase, and request token', () => {
    expect(parseSignalReport('@[bob] | 2 hops, 2-byte hashes, SNR -1.25 | recv 21:25:45')).toEqual({
      source: 'firmwareBot',
      hops: 2,
      direct: false,
      snr: -1.25,
    });
    expect(parseSignalReport('@[alice] | 0 hops, SNR 0.00 | recv 21:25:45 | hello')).toEqual({
      source: 'firmwareBot',
      hops: 0,
      direct: true,
      snr: 0,
    });
    expect(
      parseSignalReport('[1a2b] @[bob] | 2 hops, 2-byte hashes, SNR -1.25 | recv 21:25:45'),
    ).toMatchObject({ hops: 2 });
  });

  it('parses path replies', () => {
    expect(
      parseSignalReport('Path @[alice] 3 hops, 2-byte hashes, SNR 5.75 | 1234 -> abcd -> 0001'),
    ).toEqual({ source: 'firmwareBot', hops: 3, snr: 5.75, path: '1234 -> abcd -> 0001' });
    expect(parseSignalReport('Path 2 hops, 4-byte hashes | 12345678 -> abcdef01')).toMatchObject({
      hops: 2,
      snr: undefined,
    });
    expect(parseSignalReport('Path @[alice] direct zero-hop, SNR 0.00')).toEqual({
      source: 'firmwareBot',
      hops: 0,
      direct: true,
      snr: 0,
    });
  });

  it('parses Sig replies', () => {
    expect(
      parseSignalReport('Sig @[alice]: heard you at SNR 5.75 | last RSSI -92 dBm, noise -105 dBm'),
    ).toEqual({ source: 'firmwareBot', snr: 5.75, rssi: -92, noise: -105 });
  });
});

describe('parseSignalReport: agessaman/meshcore-bot', () => {
  it('parses the default test template', () => {
    expect(
      parseSignalReport(
        'ack @[bob] | 01,5f (2 hops) | SNR: 15 dB | RSSI: -120 dBm | Received at: 21:25:45',
      ),
    ).toEqual({
      source: 'meshcoreBot',
      direct: false,
      hops: 2,
      path: '01,5f',
      snr: 15,
      rssi: -120,
    });
    expect(parseSignalReport('ack @[alice] | direct | Received at: 21:25:45')).toEqual({
      source: 'meshcoreBot',
      direct: true,
      hops: 0,
      path: undefined,
      snr: undefined,
      rssi: undefined,
    });
    expect(
      parseSignalReport(
        'ack @[bob]: hello world | Direct | SNR: Unknown dB | RSSI: -90 dBm | Received at: 9:05:01',
      ),
    ).toMatchObject({ direct: true, snr: undefined, rssi: -90 });
  });
});

describe('parseSignalReport: rejections', () => {
  it('ignores free-form hop chat and custom bot templates', () => {
    expect(parseSignalReport('3 hops to Firestone')).toBeNull();
    expect(
      parseSignalReport(', ack: SNR 12.0 dB, RSSI -42 dBm, 5 hops via 97, 13, 85, E2, D0'),
    ).toBeNull();
    expect(parseSignalReport('Copy, 4 hops at 12:51')).toBeNull();
    expect(parseSignalReport('Path @[bob] 3 hops, 2-byte hashes | not a path')).toBeNull();
    expect(parseSignalReport('🤖 Copy, 4 hops at 12:51\nand more')).toBeNull();
    expect(parseSignalReport('')).toBeNull();
  });
});

describe('signalQualityFromSnr', () => {
  it('buckets SNR', () => {
    expect(signalQualityFromSnr(12)).toBe('good');
    expect(signalQualityFromSnr(0)).toBe('fair');
    expect(signalQualityFromSnr(-12)).toBe('poor');
  });
});
