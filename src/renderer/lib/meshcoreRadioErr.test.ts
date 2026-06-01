import { describe, expect, it } from 'vitest';

import { MESHCORE_RADIO_ERR_BAD_STATE, meshcoreRadioErrMessage } from './meshcoreRadioErr';

describe('meshcoreRadioErrMessage', () => {
  it('maps BadState to login hint', () => {
    expect(meshcoreRadioErrMessage(MESHCORE_RADIO_ERR_BAD_STATE)).toContain('not logged in');
  });
});
