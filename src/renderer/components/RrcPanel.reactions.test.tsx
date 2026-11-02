import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as pathReady from '@/renderer/lib/reticulum/reticulumRrcPathReady';
import * as transportReady from '@/renderer/lib/reticulum/reticulumRrcTransportReady';
import { clearRrcActiveRoom } from '@/renderer/lib/rrcActiveRoom';
import { resetRrcNickCacheHydrationForTests } from '@/renderer/lib/rrcNickCacheHydrate';
import { clearRrcOpenDms } from '@/renderer/lib/rrcOpenDms';
import { resetRrcRoomHistoryForTests } from '@/renderer/lib/rrcRoomHistory';
import { disposeAiSummaries, useAiSummaryStore } from '@/renderer/stores/aiSummaryStore';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import {
  resetRrcRememberedRoomForTests,
  useRrcSessionStore,
} from '@/renderer/stores/rrcSessionStore';
import type { RrcChatMessage } from '@/shared/rrc-types';

import RrcPanel from './RrcPanel';

// jsdom has no layout, so the real virtualizer renders no rows; draw every row instead.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    measure: vi.fn(),
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({ index, key: index, start: index * 22 })),
    getTotalSize: () => opts.count * 22,
    measureElement: vi.fn(),
    containerRef: { current: null },
    isAtEnd: () => true,
    scrollToEnd: vi.fn(),
    scrollToIndex: vi.fn(),
    scrollDirection: 'forward' as const,
    shouldAdjustScrollPositionOnItemSizeChange: undefined,
  }),
}));

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: vi.fn(() => Promise.resolve(false)),
  isReticulumRnsLiveReady: vi.fn(() => Promise.resolve(true)),
}));

const hubA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const peerHash = 'dddddddddddddddddddddddddddddddd';
const targetId = '1111111111111111';

function seedLine(room: string, overrides: Partial<RrcChatMessage> = {}) {
  useRrcSessionStore.getState().addMessage(
    {
      id: targetId,
      room,
      kind: 'msg',
      body: 'ship it?',
      nickname: 'Alice',
      sender_hash: peerHash,
      timestamp: 1,
      ...overrides,
    },
    { hubDestHash: hubA },
  );
}

function roomMessages(room: string): RrcChatMessage[] {
  const state = useRrcSessionStore.getState();
  return state.messages.get(state.roomMessageKey(room) ?? '') ?? [];
}

async function pickReaction(emoji: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add reaction' }));
  const capture = screen.getByRole('textbox', { name: 'Add reaction' });
  expect(capture).toHaveFocus();
  fireEvent.input(capture, { target: { value: emoji } });
  expect(capture).toHaveAttribute('aria-hidden', 'true');
}

describe('RrcPanel reactions', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.setState({ nicksByHub: new Map() });
    clearRrcActiveRoom(hubA);
    clearRrcOpenDms(hubA);
    resetRrcRememberedRoomForTests();
    resetRrcRoomHistoryForTests();
    resetRrcNickCacheHydrationForTests();
    useRrcHubStore.setState({ hubs: new Map() });
    vi.mocked(window.electronAPI.db.listRrcNicks).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValue([]);
    vi.spyOn(transportReady, 'probeReticulumRrcTransportReady').mockResolvedValue({ ready: true });
    vi.spyOn(pathReady, 'probeReticulumRrcPathReady').mockResolvedValue({
      ready: true,
      hops: 2,
      iface: 'Ratspeak',
      source: 'passive',
    });
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockReset();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    vi.mocked(window.electronAPI.showEmojiPanel).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    vi.restoreAllMocks();
  });

  it('leaves reactions out of the Catch up transcript', async () => {
    useAiSummaryStore.getState().setStatus({
      ...(await window.electronAPI.ai.getStatus()),
      enabled: true,
      engine: 'local',
      model: 'test',
      baseUrl: 'http://127.0.0.1:1234',
    });
    vi.mocked(window.electronAPI.ai.summarize).mockClear();
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('#general', [{ identity_hash: peerHash, nickname: 'Alice' }]);
    store.setActiveRoom('#general');
    seedLine('#general');
    seedLine('#general', {
      id: '2222222222222222',
      body: '👍',
      nickname: 'Bob',
      sender_hash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      timestamp: 2,
      react_to: targetId,
    });
    try {
      render(<RrcPanel isActive />);
      fireEvent.change(screen.getByRole('combobox', { name: 'Summary range' }), {
        target: { value: 'loaded' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Catch up' }));
      await waitFor(() => {
        expect(window.electronAPI.ai.summarize).toHaveBeenCalledOnce();
      });
      expect(vi.mocked(window.electronAPI.ai.summarize).mock.calls[0][0].messages).toEqual([
        { at: 1, sender: 'Alice', body: 'ship it?' },
      ]);
    } finally {
      disposeAiSummaries();
      useAiSummaryStore.setState({ status: null });
    }
  });

  it('sends a room reaction as msg with react_to and leaves the line to the hub echo', async () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('#general', [{ identity_hash: peerHash, nickname: 'Alice' }]);
    store.setActiveRoom('#general');
    seedLine('#general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockResolvedValue({
      ok: true,
      id: '2222222222222222',
    });

    render(<RrcPanel isActive />);
    await pickReaction('👍');

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.send).toHaveBeenCalledWith({
        hub_dest_hash: hubA,
        room: '#general',
        body: '👍',
        type: 'msg',
        react_to: targetId,
      });
    });
    expect(roomMessages('#general')).toHaveLength(1);
  });

  it('sends a DM reaction as a direct NOTICE and shows it under the sent id', async () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.setCapabilities({ direct_notice: true });
    store.openDm({ identity_hash: peerHash, nickname: 'Alice' }, hubA);
    store.setActiveRoom(`@${peerHash}`);
    seedLine(`@${peerHash}`, { kind: 'notice', body: 'psst', dst_hash: 'ee'.repeat(16) });
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockResolvedValue({
      ok: true,
      id: '3333333333333333',
    });

    render(<RrcPanel isActive />);
    await pickReaction('🎉');

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.send).toHaveBeenCalledWith({
        hub_dest_hash: hubA,
        body: '🎉',
        type: 'notice',
        dst_hash: peerHash,
        react_to: targetId,
      });
    });
    expect(roomMessages(`@${peerHash}`)).toContainEqual(
      expect.objectContaining({ id: '3333333333333333', body: '🎉', react_to: targetId }),
    );
    expect(await screen.findByRole('img', { name: /Your reaction/ })).toHaveTextContent('🎉');
  });

  it('reports a sidecar refusal without adding a line', async () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('#general', [{ identity_hash: peerHash, nickname: 'Alice' }]);
    store.setActiveRoom('#general');
    seedLine('#general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockResolvedValue({
      ok: false,
      error: 'reaction body must be one emoji',
    });

    render(<RrcPanel isActive />);
    await pickReaction('👍');

    await waitFor(() => {
      expect(useRrcSessionStore.getState().lastError).toBe('reaction body must be one emoji');
    });
    expect(roomMessages('#general')).toHaveLength(1);
  });
});
