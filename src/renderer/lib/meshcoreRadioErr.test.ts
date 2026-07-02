import { describe, expect, it } from 'vitest';

import { MESHCORE_RADIO_ERR_BAD_STATE, meshcoreRadioErrMessage } from './meshcoreRadioErr';

describe('meshcoreRadioErrMessage', () => {
  it('maps BadState to login hint key', () => {
    expect(meshcoreRadioErrMessage(MESHCORE_RADIO_ERR_BAD_STATE)).toEqual({
      key: 'meshcore.errors.roomPost.badState',
    });
  });
});
