import { describe, expect, it } from 'vitest';

import { shouldFetchLocalLoraConfigAfterConfigure } from './meshtasticLocalLoraConfig';

describe('shouldFetchLocalLoraConfigAfterConfigure', () => {
  const base = {
    skipLocalLoraConfig: false,
    configureTargetNodeNum: null as number | null,
    remoteAdminStatus: 'idle' as const,
    loraConfig: null as { region: number } | null,
  };

  it('returns true when no lora config is cached yet', () => {
    expect(shouldFetchLocalLoraConfigAfterConfigure(base)).toBe(true);
  });

  it('returns false when configure stream already hydrated lora config', () => {
    expect(shouldFetchLocalLoraConfigAfterConfigure({ ...base, loraConfig: { region: 1 } })).toBe(
      false,
    );
  });

  it('returns false during remote admin target or loading', () => {
    expect(
      shouldFetchLocalLoraConfigAfterConfigure({ ...base, configureTargetNodeNum: 0x123 }),
    ).toBe(false);
    expect(
      shouldFetchLocalLoraConfigAfterConfigure({ ...base, remoteAdminStatus: 'loading' }),
    ).toBe(false);
    expect(shouldFetchLocalLoraConfigAfterConfigure({ ...base, skipLocalLoraConfig: true })).toBe(
      false,
    );
  });
});
