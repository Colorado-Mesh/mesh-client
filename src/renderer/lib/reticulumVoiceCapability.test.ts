// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumIdentityActivityStore } from '../stores/reticulumIdentityActivityStore';
import {
  activityShowsLxstTelephony,
  peerLxstTelephonyCapability,
} from './reticulumVoiceCapability';

describe('reticulumVoiceCapability', () => {
  beforeEach(() => {
    useReticulumIdentityActivityStore.setState({ byDestination: new Map() });
  });

  it('detects lxst.telephony rows for identity', () => {
    const id = 'a'.repeat(32);
    expect(
      activityShowsLxstTelephony(
        [
          {
            destination_hash: 'b'.repeat(32),
            aspect: 'lxst.telephony',
            identity_hash: id,
            last_seen: 1,
          },
        ],
        id,
      ),
    ).toBe(true);
    expect(
      activityShowsLxstTelephony(
        [
          {
            destination_hash: 'b'.repeat(32),
            aspect: 'lxmf.delivery',
            identity_hash: id,
            last_seen: 1,
          },
        ],
        id,
      ),
    ).toBe(false);
  });

  it('reports heard vs unknown from activity store', () => {
    const dest = 'c'.repeat(32);
    const id = 'd'.repeat(32);
    expect(peerLxstTelephonyCapability({ lxmfPeerHash: dest, identityHash: id })).toBe('unknown');
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          dest,
          [
            {
              destination_hash: dest,
              aspect: 'lxst.telephony',
              identity_hash: id,
              last_seen: Date.now(),
            },
          ],
        ],
      ]),
    });
    expect(peerLxstTelephonyCapability({ lxmfPeerHash: dest, identityHash: id })).toBe('heard');
  });
});
