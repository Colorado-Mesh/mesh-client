import { describe, expect, it } from 'vitest';

import {
  isBotReplyText,
  isFirmwareBotReplyText,
  parseFirmwareBotReply,
  stripFirmwareBotRequestToken,
} from './firmwareBotReplyParse';

describe('stripFirmwareBotRequestToken', () => {
  it('splits a leading request token', () => {
    expect(stripFirmwareBotRequestToken('[1A2b] Pong!')).toEqual({ token: '1a2b', body: 'Pong!' });
  });

  it('leaves text without a token unchanged', () => {
    expect(stripFirmwareBotRequestToken('Pong!')).toEqual({ body: 'Pong!' });
    expect(stripFirmwareBotRequestToken('[cafe]no space')).toEqual({ body: '[cafe]no space' });
  });
});

describe('parseFirmwareBotReply', () => {
  it('parses status with and without battery', () => {
    expect(
      parseFirmwareBotReply(
        '[1a2b] CO Bot | up 1d 2h 3m | batt 4012mV 87% | storage 12/256KB | seen 10 sent 4 fail 0',
      ),
    ).toEqual({
      kind: 'status',
      name: 'CO Bot',
      uptime: '1d 2h 3m',
      batteryMv: 4012,
      batteryPercent: 87,
      storageUsedKb: 12,
      storageTotalKb: 256,
      seen: 10,
      sent: 4,
      fail: 0,
    });
    expect(
      parseFirmwareBotReply('bot | up 0d 0h 5m | storage 1/64KB | seen 0 sent 0 fail 0'),
    ).not.toHaveProperty('batteryMv');
  });

  it('parses air', () => {
    expect(
      parseFirmwareBotReply('Air: tx 12s rx 340s | rx flood 10 direct 2 | tx flood 3 direct 1'),
    ).toEqual({
      kind: 'air',
      txSeconds: 12,
      rxSeconds: 340,
      rxFlood: 10,
      rxDirect: 2,
      txFlood: 3,
      txDirect: 1,
    });
  });

  it('parses neighbors lists and the empty state', () => {
    expect(
      parseFirmwareBotReply(
        '[00ff] Neighbors @[bob]: Ridge Rptr -92dBm 5.25 3m, abcd1234 -101dBm -2.00 1h',
      ),
    ).toEqual({
      kind: 'neighbors',
      neighbors: [
        { name: 'Ridge Rptr', rssi: -92, snr: 5.25, ago: '3m' },
        { name: 'abcd1234', rssi: -101, snr: -2, ago: '1h' },
      ],
    });
    expect(parseFirmwareBotReply('Neighbors: none heard recently')).toEqual({
      kind: 'neighbors',
      neighbors: [],
    });
    expect(parseFirmwareBotReply('Neighbors: lots of folks')).toBeNull();
  });

  it('parses trace results and states', () => {
    expect(
      parseFirmwareBotReply('Trace @[bob] 1a2b3c4d 2h tail 5.25 | 2751@4.00 -> ea4d@-1.25'),
    ).toEqual({
      kind: 'trace',
      state: 'result',
      tag: '1a2b3c4d',
      tailSnr: 5.25,
      hops: [
        { hash: '2751', snr: 4 },
        { hash: 'ea4d', snr: -1.25 },
      ],
    });
    expect(parseFirmwareBotReply('Trace 1a2b3c4d 3h tail 5.25 | 2751@4.00')).toBeNull();
    expect(parseFirmwareBotReply('Trace 0000abcd direct zero-hop tail -3.50')).toEqual({
      kind: 'trace',
      state: 'directZeroHop',
      tag: '0000abcd',
      tailSnr: -3.5,
    });
    expect(
      parseFirmwareBotReply('Trace @[bob] direct link, SNR 6.00 (no repeaters to trace)'),
    ).toEqual({ kind: 'trace', state: 'directLink', snr: 6 });
    expect(
      parseFirmwareBotReply('Trace @[bob] 1a2b3c4d timed out, no reply on 3-hop route'),
    ).toEqual({ kind: 'trace', state: 'timeout', hops: 3 });
    expect(parseFirmwareBotReply('Trace sent on 2-hop route')).toEqual({
      kind: 'trace',
      state: 'sent',
      hops: 2,
    });
  });

  it('parses lora, version, channels, and help', () => {
    expect(parseFirmwareBotReply('LoRa 910.525MHz SF7 BW62.5kHz CR5 +22dBm')).toEqual({
      kind: 'lora',
      freqMhz: 910.525,
      sf: 7,
      bwKhz: 62.5,
      cr: 5,
      txPowerDbm: 22,
    });
    expect(parseFirmwareBotReply('Firmware v1.16.0-cmesh built 10 Jul 2026')).toEqual({
      kind: 'version',
      version: 'v1.16.0-cmesh',
      built: '10 Jul 2026',
    });
    expect(
      parseFirmwareBotReply(
        'Channels: bot #bot | testing #testing | emergency #emergency | public Public (4 total)',
      ),
    ).toEqual({
      kind: 'channels',
      bot: '#bot',
      testing: '#testing',
      emergency: '#emergency',
      publicChannel: 'Public',
    });
    expect(
      parseFirmwareBotReply('Commands: help cmd ping test | cmd diag | help <command>'),
    ).toEqual({ kind: 'help', diag: false, commands: ['help', 'cmd', 'ping', 'test'] });
    expect(parseFirmwareBotReply('Diag: status air')).toEqual({
      kind: 'help',
      diag: true,
      commands: ['status', 'air'],
    });
  });

  it('rejects generic chat, multiline, and oversized text', () => {
    expect(parseFirmwareBotReply('Pong!')).toBeNull();
    expect(parseFirmwareBotReply('Hello @[bob], from CO Bot')).toBeNull();
    expect(parseFirmwareBotReply('Air: tx 12s rx 340s\nmore')).toBeNull();
    expect(parseFirmwareBotReply(`Firmware ${'x'.repeat(900)} built now`)).toBeNull();
    expect(parseFirmwareBotReply('')).toBeNull();
  });
});

describe('bot reply detection', () => {
  it('recognizes firmware bot signal reports and structured replies', () => {
    expect(
      isFirmwareBotReplyText('[111b] @[bob] | 5 hops, 2-byte hashes, SNR 12.00 | recv 21:56:11'),
    ).toBe(true);
    expect(
      isFirmwareBotReplyText('Air: tx 1s rx 2s | rx flood 0 direct 0 | tx flood 0 direct 0'),
    ).toBe(true);
    expect(isFirmwareBotReplyText('🤖 Copy, 4 hops at 12:51')).toBe(false);
    expect(isFirmwareBotReplyText('hello there')).toBe(false);
  });

  it('isBotReplyText also accepts other known bot templates', () => {
    expect(isBotReplyText('🤖 Copy, 4 hops at 12:51')).toBe(true);
    expect(isBotReplyText('hello there')).toBe(false);
  });
});
