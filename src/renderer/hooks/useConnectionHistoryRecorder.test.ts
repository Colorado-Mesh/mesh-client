// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadConnectionHistory } from '../lib/connectionHistoryStorage';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { useConnectionHistoryRecorder } from './useConnectionHistoryRecorder';

describe('useConnectionHistoryRecorder', () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('ignores invalid lastConnection httpAddress and still completes store sync', () => {
    localStorage.setItem(
      'mesh-client:lastConnection:meshtastic',
      JSON.stringify({ type: 'tcp', httpAddress: 4403 }),
    );
    useIdentityStore.setState({
      identities: {
        'id-mt': {
          id: 'id-mt',
          protocol: { type: 'meshtastic' },
          signature: 'meshtastic:recorder-test',
          transports: [],
          createdAt: 1,
          lastSeenAt: 1,
        },
      } as never,
      activeIdentityId: 'id-mt',
    });

    renderHook(() => {
      useConnectionHistoryRecorder();
    });

    expect(() => {
      act(() => {
        setConnection('id-mt', { status: 'configured', connectionType: 'tcp' });
      });
    }).not.toThrow();

    expect(loadConnectionHistory('meshtastic')).toEqual([]);
  });
});
