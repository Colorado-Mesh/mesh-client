import { describe, expect, it } from 'vitest';

import {
  isMeshtasticAttachSupersededError,
  MESHTASTIC_ATTACH_SUPERSEDED_MESSAGE,
} from './meshtasticAttachSuperseded';

describe('isMeshtasticAttachSupersededError', () => {
  it('matches the attachRfSession supersession message', () => {
    expect(isMeshtasticAttachSupersededError(new Error(MESHTASTIC_ATTACH_SUPERSEDED_MESSAGE))).toBe(
      true,
    );
  });

  it('rejects unrelated connection failures', () => {
    expect(isMeshtasticAttachSupersededError(new Error('Connection failed'))).toBe(false);
    expect(
      isMeshtasticAttachSupersededError(new Error('Reconnect superseded during configure')),
    ).toBe(false);
  });
});
