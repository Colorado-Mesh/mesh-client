// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { formatChatExportLine } from './chatExportFormat';

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
