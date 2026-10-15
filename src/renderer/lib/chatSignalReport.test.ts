import { describe, expect, it } from 'vitest';

import { encodeMeshcoreGroupText } from '@/shared/meshcoreGroupText';

import {
  formatChatSignalReport,
  hasRfMessageReception,
  meshcoreMessageReceptionStats,
  messageReceptionStats,
  radioMessageReceptionTransport,
} from './chatSignalReport';
import { isBotReplyText } from './firmwareBotReplyParse';
import { parseHopReport } from './hopReportParse';
import type { RxPacketEntry } from './meshcore/meshcoreHookTypes';
import { chatMessageToMessageRecord, messageRecordToChatMessage } from './storeRecordAdapters';
import type { ChatMessage } from './types';

const secret = new Uint8Array(16).fill(42);
const message: ChatMessage = {
  sender_id: 1,
  sender_name: 'SCRAM-A1 (FOEHAMMER)',
  payload: 'Test with new firmware through ATAK.',
  channel: 0,
  timestamp: 1_800_000_000_000,
  receivedVia: 'rf',
};

function packet(overrides: Partial<RxPacketEntry> = {}): RxPacketEntry {
  const path = [0x06, 0, 0xc5, 0xec, 0x18, 0xbc, 0x4b, 0xe0, 0xcc, 0x22, 0xd6, 0x12];
  const inner = encodeMeshcoreGroupText(
    secret,
    message.timestamp / 1000,
    `${message.sender_name}: ${message.payload}`,
  );
  return {
    source: 'rf',
    ts: message.timestamp + 100,
    snr: 12,
    rssi: -4,
    raw: new Uint8Array([0x15, 0x46, ...path, ...inner]),
    routeTypeString: 'FLOOD',
    payloadTypeString: 'GRP_TXT',
    hopCount: 6,
    pathBytes: path,
    pathHashSizeBytes: 2,
    fromNodeId: null,
    messageFingerprintHex: null,
    transportScopeCode: null,
    transportReturnCode: null,
    advertName: null,
    advertLat: null,
    advertLon: null,
    advertTimestampSec: null,
    parseOk: true,
    ...overrides,
  };
}

describe('signal report quick replies', () => {
  it.each(['rf', 'both', 'ble', 'rf+tcp', 'network+ble'] as const)(
    'recognizes message-level wireless reception over %s without needing numeric stats',
    (receivedVia) => {
      expect(hasRfMessageReception({ receivedVia })).toBe(true);
      expect(formatChatSignalReport({}, 100, receivedVia)).toBe(
        `ack: received via ${receivedVia === 'both' ? 'RF' : receivedVia.toUpperCase()}`,
      );
      expect(formatChatSignalReport({}, 5, receivedVia)).toBeNull();
    },
  );

  it.each([undefined, 'tcp', 'network', 'mqtt', 'paper'] as const)(
    'does not infer RF reception from %s',
    (receivedVia) => {
      expect(hasRfMessageReception({ receivedVia })).toBe(false);
      expect(formatChatSignalReport({}, 100, receivedVia)).toBeNull();
    },
  );

  it('requires verified ingress for Reticulum and preserves it through record adapters', () => {
    const reticulum = { ...message, reticulum_message_hash: 'ab'.repeat(32) };
    expect(hasRfMessageReception(reticulum)).toBe(false);
    expect(radioMessageReceptionTransport(reticulum)).toBeUndefined();
    const verified = {
      ...reticulum,
      receivedVia: 'tcp' as const,
      rxRadioTransport: 'ble' as const,
    };
    const roundTrip = messageRecordToChatMessage(chatMessageToMessageRecord(verified));
    expect(hasRfMessageReception(roundTrip)).toBe(true);
    expect(radioMessageReceptionTransport(roundTrip)).toBe('ble');
    expect(formatChatSignalReport({}, 100, radioMessageReceptionTransport(roundTrip))).toBe(
      'ack: received via BLE',
    );
  });

  it('reproduces the screenshot from an exact RF packet match', () => {
    const stats = meshcoreMessageReceptionStats(
      message,
      [packet()],
      [{ index: 0, name: 'Public', secret }],
    );
    expect(stats).toEqual({
      snr: 12,
      rssi: -4,
      hops: 6,
      path: ['0600', 'C5EC', '18BC', '4BE0', 'CC22', 'D612'],
    });
    const text = formatChatSignalReport(stats!, 133);
    expect(text).toBe(
      'ack: SNR 12.0 dB, RSSI -4 dBm, 6 hops via 0600, C5EC, 18BC, 4BE0, CC22, D612',
    );
    expect(parseHopReport(text!)).toMatchObject({
      source: 'clientAck',
      hops: 6,
      snr: 12,
      rssi: -4,
    });
    expect(isBotReplyText(text!)).toBe(false);
  });

  it.each([
    { source: 'mqtt' as const },
    { source: undefined },
    { parseOk: false },
    { raw: new Uint8Array([0x15]) },
  ])('ignores untrusted capture %j', (overrides) => {
    expect(
      meshcoreMessageReceptionStats(message, [packet(overrides)], [{ index: 0, name: '', secret }]),
    ).toBeUndefined();
  });

  it.each([
    { sender_name: 'Someone else' },
    { payload: 'A different message' },
    { timestamp: message.timestamp + 1000 },
    { channel: 1 },
    { to: 99 },
  ])('does not borrow stats for %j', (overrides) => {
    expect(
      meshcoreMessageReceptionStats(
        { ...message, ...overrides },
        [packet()],
        [{ index: 0, name: '', secret }],
      ),
    ).toBeUndefined();
  });

  it('requires the correct channel key and skips corrupt ciphertext', () => {
    expect(
      meshcoreMessageReceptionStats(
        message,
        [packet()],
        [{ index: 0, name: '', secret: new Uint8Array(16) }],
      ),
    ).toBeUndefined();
    const corrupt = packet();
    corrupt.raw[corrupt.raw.length - 1] ^= 1;
    expect(
      meshcoreMessageReceptionStats(message, [corrupt], [{ index: 0, name: '', secret }]),
    ).toBeUndefined();
  });

  it('keeps zero measurements and drops unavailable values', () => {
    expect(formatChatSignalReport({ snr: 0, rssi: 0, hops: 0 }, 100)).toBe(
      'ack: SNR 0.0 dB, RSSI 0 dBm, 0 hops',
    );
    expect(formatChatSignalReport({ snr: NaN, rssi: Infinity, hops: 3 }, 100)).toBe('ack: 3 hops');
    expect(formatChatSignalReport({}, 100)).toBeNull();
  });

  it.each([undefined, NaN, Infinity, -Infinity])(
    'falls back per field when a captured measurement is %s',
    (invalid) => {
      const received = { ...message, rxSnr: 12, rxRssi: -98, rxHops: 6 };
      expect(messageReceptionStats(received, { snr: invalid, rssi: 0, hops: 0, path: [] })).toEqual(
        { snr: 12, rssi: 0, hops: 0, path: [] },
      );
      expect(
        messageReceptionStats(received, { snr: 0, rssi: invalid, hops: 2, path: ['AB'] }),
      ).toEqual({ snr: 0, rssi: -98, hops: 2, path: ['AB'] });
    },
  );

  it('omits a long route without changing the real hop count and never exceeds the budget', () => {
    const stats = { snr: -1.25, rssi: -108, hops: 30, path: Array<string>(30).fill('ABCDEF') };
    const text = formatChatSignalReport(stats, 60);
    expect(text).toBe('ack: SNR -1.3 dB, RSSI -108 dBm, 30 hops');
    expect(formatChatSignalReport(stats, 10)).toBeNull();
  });

  it.each(['ack: 0 hops', 'ack: SNR 0.0 dB', 'ack: RSSI -80 dBm, 1 hop', 'ack: 1 hop via ABCDEF'])(
    'renders partial and 3-byte reports as human signal reports: %s',
    (text) => {
      expect(parseHopReport(text)?.source).toBe('clientAck');
      expect(isBotReplyText(text)).toBe(false);
    },
  );

  it('preserves message measurements through the display/store adapter round trip', () => {
    const received = { ...message, rxSnr: 0, rxRssi: -95, rxHops: 3 };
    const roundTrip = messageRecordToChatMessage(chatMessageToMessageRecord(received));
    expect(roundTrip).toMatchObject({ rxSnr: 0, rxRssi: -95, rxHops: 3 });
  });
});
