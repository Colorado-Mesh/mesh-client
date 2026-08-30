// @vitest-environment jsdom
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

vi.mock('@/renderer/lib/i18n', () => ({
  default: { t: (key: string) => key },
}));

import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import {
  resendFailedReticulumForDestination,
  resetReticulumAutoResendState,
  RETICULUM_AUTO_RESEND_COOLDOWN_MS,
  RETICULUM_AUTO_RESEND_MAX_PER_ANNOUNCE,
} from '@/renderer/lib/reticulum/resendFailedReticulumForDestination';
import { useMessageStore } from '@/renderer/stores/messageStore';
import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

const DEST = '5526a65d0b4d23448206fd3485b76f5b';
const OTHER = '17c4e90b8236df4159a0b7c3ed218a64';
const identityId = 'reticulum-test';

function seedFailed(count: number, dest = DEST, startId = 0) {
  const toNodeId = reticulumHashToNodeId(dest);
  registerReticulumDestinationHash(toNodeId, dest);
  const existing = useMessageStore.getState().messages[identityId] ?? {};
  const bucket: Record<string, unknown> = { ...existing };
  for (let i = 0; i < count; i += 1) {
    const id = `m${String(startId + i)}`;
    bucket[id] = {
      id,
      from: 1,
      senderName: 'self',
      payload: `body-${id}`,
      channelIndex: 0,
      timestamp: 1000 + startId + i,
      status: 'failed',
      to: toNodeId,
    };
  }
  useMessageStore.setState({ messages: { [identityId]: bucket as never } });
}

type SendFn = (text: string, destination: number, retryOfStoreId: string) => void;

describe('resendFailedReticulumForDestination', () => {
  let send: Mock<SendFn>;

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    window.electronAPI = createElectronAPIMock();
    resetReticulumAutoResendState();
    send = vi.fn<SendFn>();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  const base = () => ({ identityId, destinationHash: DEST, enabled: true, send, now: 10_000 });

  it('resends failed messages when enabled', () => {
    seedFailed(2);

    const count = resendFailedReticulumForDestination(base());

    expect(count).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('forwards payload, destination and retryOfStoreId so the prior row is rekeyed', () => {
    seedFailed(1);
    const toNodeId = reticulumHashToNodeId(DEST);

    resendFailedReticulumForDestination(base());

    expect(send).toHaveBeenCalledWith('body-m0', toNodeId, 'm0');
  });

  it('does nothing when the setting is off', () => {
    seedFailed(2);

    expect(resendFailedReticulumForDestination({ ...base(), enabled: false })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing without an identity', () => {
    seedFailed(2);

    expect(resendFailedReticulumForDestination({ ...base(), identityId: null })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when there are no failed messages', () => {
    expect(resendFailedReticulumForDestination(base())).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing for a malformed destination hash', () => {
    seedFailed(1);

    expect(resendFailedReticulumForDestination({ ...base(), destinationHash: '' })).toBe(0);
    expect(resendFailedReticulumForDestination({ ...base(), destinationHash: 'zz' })).toBe(0);
    expect(
      resendFailedReticulumForDestination({ ...base(), destinationHash: DEST.slice(0, 16) }),
    ).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  describe('cooldown', () => {
    it('suppresses a second announce inside the window', () => {
      seedFailed(1);

      expect(resendFailedReticulumForDestination(base())).toBe(1);
      expect(
        resendFailedReticulumForDestination({
          ...base(),
          now: 10_000 + RETICULUM_AUTO_RESEND_COOLDOWN_MS - 1,
        }),
      ).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('allows a resend once the window elapses', () => {
      seedFailed(1);

      resendFailedReticulumForDestination(base());
      expect(
        resendFailedReticulumForDestination({
          ...base(),
          now: 10_000 + RETICULUM_AUTO_RESEND_COOLDOWN_MS,
        }),
      ).toBe(1);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('is tracked per destination', () => {
      seedFailed(1, DEST, 0);
      seedFailed(1, OTHER, 100);

      expect(resendFailedReticulumForDestination(base())).toBe(1);
      // A different peer announcing is not blocked by DEST's cooldown.
      expect(
        resendFailedReticulumForDestination({ ...base(), destinationHash: OTHER }),
      ).toBeGreaterThan(0);
    });

    it('does not start a cooldown when nothing was resent', () => {
      // No failed rows yet: the empty attempt must not consume the window.
      expect(resendFailedReticulumForDestination(base())).toBe(0);
      seedFailed(1);
      expect(resendFailedReticulumForDestination({ ...base(), now: 10_001 })).toBe(1);
    });
  });

  describe('in-flight suppression', () => {
    it('ignores a re-entrant call made from inside send', () => {
      seedFailed(1);
      let reentrantResult = -1;
      send.mockImplementation(() => {
        reentrantResult = resendFailedReticulumForDestination({ ...base(), now: 10_000 });
      });

      expect(resendFailedReticulumForDestination(base())).toBe(1);
      expect(reentrantResult).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('releases the lock after send throws so later announces still work', () => {
      seedFailed(1);
      send.mockImplementationOnce(() => {
        throw new Error('send blew up');
      });

      expect(() => resendFailedReticulumForDestination(base())).toThrow('send blew up');

      // Lock released; cooldown is what gates the next attempt.
      expect(
        resendFailedReticulumForDestination({
          ...base(),
          now: 10_000 + RETICULUM_AUTO_RESEND_COOLDOWN_MS,
        }),
      ).toBe(1);
    });
  });

  describe('batch cap', () => {
    it('sends at most the per-announce maximum', () => {
      seedFailed(RETICULUM_AUTO_RESEND_MAX_PER_ANNOUNCE + 5);

      const count = resendFailedReticulumForDestination(base());

      expect(count).toBe(RETICULUM_AUTO_RESEND_MAX_PER_ANNOUNCE);
      expect(send).toHaveBeenCalledTimes(RETICULUM_AUTO_RESEND_MAX_PER_ANNOUNCE);
    });

    it('sends the oldest messages first', () => {
      seedFailed(RETICULUM_AUTO_RESEND_MAX_PER_ANNOUNCE + 2);

      resendFailedReticulumForDestination(base());

      expect(send.mock.calls[0][2]).toBe('m0');
      expect(send.mock.calls[1][2]).toBe('m1');
    });
  });

  it('accepts a separated / uppercase destination hash', () => {
    seedFailed(1);

    expect(
      resendFailedReticulumForDestination({ ...base(), destinationHash: DEST.toUpperCase() }),
    ).toBe(1);
  });

  it('resetReticulumAutoResendState clears the cooldown', () => {
    seedFailed(1);
    resendFailedReticulumForDestination(base());

    resetReticulumAutoResendState();

    expect(resendFailedReticulumForDestination(base())).toBe(1);
  });
});
