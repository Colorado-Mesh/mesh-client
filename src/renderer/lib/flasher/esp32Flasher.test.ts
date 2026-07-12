import { describe, expect, it } from 'vitest';

describe('esp32Flasher stall timeout contract', () => {
  it('uses a 60s stall watchdog constant', async () => {
    const source = await import('./esp32Flasher?raw');
    expect(source.default).toContain('ESP32_FLASH_STALLED');
    expect(source.default).toContain('60_000');
    expect(source.default).toContain('hasSeenProgress');
  });
});
