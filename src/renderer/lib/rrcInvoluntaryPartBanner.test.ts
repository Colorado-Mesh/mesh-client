// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolveRrcInvoluntaryPartBannerKey } from './rrcInvoluntaryPartBanner';

describe('resolveRrcInvoluntaryPartBannerKey', () => {
  it('returns null for voluntary part', () => {
    expect(resolveRrcInvoluntaryPartBannerKey({ voluntary: true })).toBeNull();
    expect(
      resolveRrcInvoluntaryPartBannerKey({ voluntary: true, sessionStatus: 'active' }),
    ).toBeNull();
  });

  it('returns null while reconnecting (softens link-drop parts)', () => {
    expect(
      resolveRrcInvoluntaryPartBannerKey({
        voluntary: false,
        sessionStatus: 'reconnecting',
      }),
    ).toBeNull();
  });

  it('uses neutral hubParted for involuntary part when not reconnecting', () => {
    expect(resolveRrcInvoluntaryPartBannerKey({ voluntary: false })).toBe(
      'rrc.moderation.hubParted',
    );
    expect(resolveRrcInvoluntaryPartBannerKey({ voluntary: false, sessionStatus: 'active' })).toBe(
      'rrc.moderation.hubParted',
    );
    expect(
      resolveRrcInvoluntaryPartBannerKey({ voluntary: false, sessionStatus: 'disconnected' }),
    ).toBe('rrc.moderation.hubParted');
  });
});
