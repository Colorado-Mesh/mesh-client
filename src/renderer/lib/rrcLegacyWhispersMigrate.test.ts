// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRrcOpenDms, loadRrcOpenDms } from '@/renderer/lib/rrcOpenDms';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import {
  migrateLegacyWhispersForHub,
  resetRrcLegacyWhispersMigrateForTests,
} from './rrcLegacyWhispersMigrate';

const hubA = '28c7c1a68c735693aa8e6b8193ed44b2';
const peerA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const peerB = 'cccccccccccccccccccccccccccccccc';
const selfHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('migrateLegacyWhispersForHub', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.getState().setLocalIdentityHash(selfHash);
    resetRrcLegacyWhispersMigrateForTests();
    clearRrcOpenDms(hubA);
    vi.mocked(window.electronAPI.db.listRrcMessages).mockReset();
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockReset();
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockResolvedValue({ changes: 1 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('no-ops for empty hub hash', async () => {
    await migrateLegacyWhispersForHub('   ');
    expect(window.electronAPI.db.listRrcMessages).not.toHaveBeenCalled();
  });

  it('leaves migration unmarked when list fails so a later run can retry', async () => {
    vi.mocked(window.electronAPI.db.listRrcMessages).mockRejectedValue(new Error('db down'));
    await migrateLegacyWhispersForHub(hubA);
    expect(console.warn).toHaveBeenCalled();
    expect(loadRrcOpenDms(hubA)).toEqual([]);

    // Must remain retryable — do not mark migrated on read failure.
    vi.mocked(window.electronAPI.db.listRrcMessages).mockClear();
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValue([]);
    await migrateLegacyWhispersForHub(hubA);
    expect(window.electronAPI.db.listRrcMessages).toHaveBeenCalled();
  });

  it('marks migrated when there are no legacy rows', async () => {
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValue([]);
    await migrateLegacyWhispersForHub(hubA);
    expect(loadRrcOpenDms(hubA)).toEqual([]);

    vi.mocked(window.electronAPI.db.listRrcMessages).mockClear();
    await migrateLegacyWhispersForHub(hubA);
    expect(window.electronAPI.db.listRrcMessages).not.toHaveBeenCalled();
  });

  it('skips invalid rows and still migrates valid inbound whispers', async () => {
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValue([
      {
        message_id: 1 as unknown as string,
        hub_hash: hubA,
        room: '[whispers]',
        sender_hash: peerA,
        nickname: 'Bad',
        kind: 'notice',
        body: 'skip',
        timestamp: 1,
      },
      {
        message_id: 'ok-1',
        hub_hash: hubA,
        room: '[whispers]',
        sender_hash: peerA,
        nickname: 'Zeva',
        kind: 'not-a-kind',
        body: 'skip-kind',
        timestamp: 2,
      },
      {
        message_id: 'ok-2',
        hub_hash: hubA,
        room: '[whispers]',
        sender_hash: peerA,
        nickname: 'Zeva',
        kind: 'notice',
        body: 'hello',
        timestamp: 3,
      },
    ] as Awaited<ReturnType<typeof window.electronAPI.db.listRrcMessages>>);

    await migrateLegacyWhispersForHub(hubA);

    expect(useRrcSessionStore.getState().rooms.has(`@${peerA}`)).toBe(true);
    expect(loadRrcOpenDms(hubA)).toEqual([{ identity_hash: peerA, nickname: 'Zeva' }]);
    expect(window.electronAPI.db.insertRrcMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 'ok-2',
        hub_hash: hubA,
        room: `@${peerA}`,
        body: 'hello',
      }),
    );
  });

  it('opens distinct DMs for multiple inbound legacy peers (SQLite has no dst_hash)', async () => {
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValue([
      {
        message_id: 'in-bob',
        hub_hash: hubA,
        room: '[whispers]',
        sender_hash: peerB,
        nickname: 'Bob',
        kind: 'notice',
        body: 'from bob',
        timestamp: 1,
      },
      {
        message_id: 'in-alice',
        hub_hash: hubA,
        room: '[whispers]',
        sender_hash: peerA,
        nickname: 'Alice',
        kind: 'notice',
        body: 'from alice',
        timestamp: 2,
      },
      {
        // Self-echo without recoverable peer — skipped (no dst_hash column in SQLite).
        message_id: 'self-echo',
        hub_hash: hubA,
        room: '[whispers]',
        sender_hash: selfHash,
        nickname: 'Me',
        kind: 'msg',
        body: 'orphan outbound',
        timestamp: 3,
      },
    ]);

    await migrateLegacyWhispersForHub(hubA);

    expect([...useRrcSessionStore.getState().rooms.keys()].sort()).toEqual(
      [`@${peerA}`, `@${peerB}`].sort(),
    );
    expect(loadRrcOpenDms(hubA)).toEqual(
      expect.arrayContaining([
        { identity_hash: peerA, nickname: 'Alice' },
        { identity_hash: peerB, nickname: 'Bob' },
      ]),
    );
  });

  it('continues when re-persist insert fails for one message', async () => {
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValue([
      {
        message_id: 'm1',
        hub_hash: hubA,
        room: '[whispers]',
        sender_hash: peerA,
        nickname: 'Zeva',
        kind: 'notice',
        body: 'one',
        timestamp: 1,
      },
      {
        message_id: 'm2',
        hub_hash: hubA,
        room: '[whispers]',
        sender_hash: peerA,
        nickname: 'Zeva',
        kind: 'notice',
        body: 'two',
        timestamp: 2,
      },
    ]);
    vi.mocked(window.electronAPI.db.insertRrcMessage)
      .mockRejectedValueOnce(new Error('insert boom'))
      .mockResolvedValueOnce({ changes: 1 });

    await migrateLegacyWhispersForHub(hubA);

    expect(console.warn).toHaveBeenCalled();
    expect(useRrcSessionStore.getState().rooms.has(`@${peerA}`)).toBe(true);
    const key = useRrcSessionStore.getState().roomMessageKey(`@${peerA}`, hubA);
    expect(
      useRrcSessionStore
        .getState()
        .messages.get(key ?? '')
        ?.map((m) => m.body),
    ).toEqual(['one', 'two']);

    // Insert failure must leave migration unmarked for retry.
    vi.mocked(window.electronAPI.db.listRrcMessages).mockClear();
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockResolvedValue({ changes: 1 });
    await migrateLegacyWhispersForHub(hubA);
    expect(window.electronAPI.db.listRrcMessages).toHaveBeenCalled();
  });
});
