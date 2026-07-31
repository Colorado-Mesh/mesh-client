// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  assertChatExportMessageSizes,
  CHAT_EXPORT_MAX_PAYLOAD_CHARS,
  CHAT_EXPORT_MAX_SENDER_NAME_CHARS,
  formatChatExportLine,
  formatChatExportLinesWithTotalCap,
} from './chatExportFormat';

describe('formatChatExportLine', () => {
  it('labels broadcast to as channel traffic, not DM', () => {
    const line = formatChatExportLine({
      timestamp: 1_700_000_000_000,
      sender_name: 'Alice',
      channel: 2,
      to: 0xffffffff,
      payload: 'hello mesh',
    });
    expect(line).toContain('(ch2)');
    expect(line).not.toContain('(DM)');
  });

  it('labels true DM destinations', () => {
    const line = formatChatExportLine({
      timestamp: 1_700_000_000_000,
      sender_name: 'Bob',
      channel: 0,
      to: 0x12345678,
      payload: 'private',
    });
    expect(line).toContain('(DM)');
  });
});

describe('assertChatExportMessageSizes', () => {
  it('allows normal-sized fields', () => {
    expect(() => {
      assertChatExportMessageSizes([
        { sender_name: 'Alice', payload: 'hello' },
        { sender_name: 'Bob', payload: 'world' },
      ]);
    }).not.toThrow();
  });

  it('rejects oversized payload', () => {
    expect(() => {
      assertChatExportMessageSizes([
        { sender_name: 'Alice', payload: 'x'.repeat(CHAT_EXPORT_MAX_PAYLOAD_CHARS + 1) },
      ]);
    }).toThrow(/message\[0\] payload exceeds max length/);
  });

  it('rejects oversized sender_name', () => {
    expect(() => {
      assertChatExportMessageSizes([
        {
          sender_name: 'n'.repeat(CHAT_EXPORT_MAX_SENDER_NAME_CHARS + 1),
          payload: 'ok',
        },
      ]);
    }).toThrow(/message\[0\] sender_name exceeds max length/);
  });
});

describe('formatChatExportLinesWithTotalCap', () => {
  it('returns joined lines for a small export', () => {
    const text = formatChatExportLinesWithTotalCap([
      {
        timestamp: 1_700_000_000_000,
        sender_name: 'Alice',
        channel: 0,
        payload: 'hi',
      },
    ]);
    expect(text).toContain('Alice');
    expect(text).toContain('hi');
    expect(text.endsWith('\n')).toBe(true);
  });
});
