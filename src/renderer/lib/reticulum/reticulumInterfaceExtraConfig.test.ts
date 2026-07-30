import { describe, expect, it } from 'vitest';

import {
  formatInterfaceExtraConfig,
  isKnownIfaceUiKey,
  parseInterfaceExtraConfig,
} from './reticulumInterfaceExtraConfig';

describe('reticulumInterfaceExtraConfig', () => {
  it('recognizes known typed keys case-insensitively', () => {
    expect(isKnownIfaceUiKey('network_name')).toBe(true);
    expect(isKnownIfaceUiKey('Passphrase')).toBe(true);
    expect(isKnownIfaceUiKey('forward_interval')).toBe(false);
  });

  it('formats and parses extra_config round-trip', () => {
    const text = formatInterfaceExtraConfig({
      forward_interval: '300',
      max_distance: '50',
    });
    expect(text).toContain('forward_interval = 300');
    expect(text).toContain('max_distance = 50');
    const parsed = parseInterfaceExtraConfig(text);
    expect(parsed.extraConfig).toEqual({
      forward_interval: '300',
      max_distance: '50',
    });
    expect(parsed.reservedKeys).toEqual([]);
  });

  it('drops reserved keys and skips blanks/comments', () => {
    const parsed = parseInterfaceExtraConfig(`
# comment
forward_interval = 120
network_name = should_ignore
passphrase = also_ignore

max_distance = 10
`);
    expect(parsed.extraConfig).toEqual({
      forward_interval: '120',
      max_distance: '10',
    });
    expect(parsed.reservedKeys).toEqual(['network_name', 'passphrase']);
  });
});
