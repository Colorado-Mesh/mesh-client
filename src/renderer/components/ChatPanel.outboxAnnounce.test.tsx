import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutboxEntry } from '@/shared/electron-api.types';

import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import { useIdentityStore } from '../stores/identityStore';
import ChatPanel from './ChatPanel';
import { ToastProvider } from './Toast';

const announce = vi.fn();

vi.mock('@/renderer/lib/a11yAnnouncer', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    announce: (...args: unknown[]) => announce(...args),
  };
});

vi.mock('../hooks/useOutboxRowAwaitingAck', () => ({
  useOutboxRowAwaitingAck: () => false,
}));

const publicChannel = { index: 0, name: 'Public', secret: new Uint8Array(16).fill(1) };
const signature = 'meshcore:pk:' + 'a'.repeat(64);

let outboxRows: OutboxEntry[] = [];

vi.mock('../hooks/useChatOutbox', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useChatOutbox: () => ({
      rows: outboxRows,
      queue: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
    }),
  };
});

function baseRow(status: OutboxEntry['status']): OutboxEntry {
  return {
    id: 1,
    protocol: 'meshcore',
    viewKey: 'ch:0',
    channel: 0,
    toNode: null,
    payload: 'hello',
    replyId: null,
    status,
    error: null,
    attemptCount: 0,
    nextRetryAt: null,
    createdAt: 1,
    updatedAt: 1,
    groupId: null,
    groupIndex: null,
    groupTotal: null,
    priority: 'normal',
    identityId: 'radio',
  };
}

function renderPanel() {
  return render(
    <ToastProvider>
      <ChatPanel
        messages={[]}
        channels={[publicChannel]}
        meshcoreChannelSources={[publicChannel]}
        myNodeNum={1}
        identityId="radio"
        protocol="meshcore"
        onSend={vi.fn().mockResolvedValue('id')}
        onReact={vi.fn()}
        onResend={vi.fn()}
        onNodeClick={vi.fn()}
        isConnected
        nodes={new Map()}
        isActive
      />
    </ToastProvider>,
  );
}

describe('ChatPanel outbox failure announcements', () => {
  beforeEach(() => {
    announce.mockClear();
    outboxRows = [];
    useIdentityStore.setState({
      activeIdentityId: 'radio',
      identities: {
        radio: {
          id: 'radio',
          protocol: meshcoreProtocol,
          signature,
          transports: [],
          createdAt: 1,
          lastSeenAt: 1,
        },
      },
    });
  });

  it('announces failed once', async () => {
    outboxRows = [baseRow('failed')];
    renderPanel();
    await waitFor(() => {
      expect(announce).toHaveBeenCalledWith(expect.stringMatching(/failed/i), 'polite');
    });
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('announces blocked once', async () => {
    outboxRows = [baseRow('blocked')];
    renderPanel();
    await waitFor(() => {
      expect(announce).toHaveBeenCalledWith(expect.stringMatching(/blocked/i), 'polite');
    });
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('does not announce queued', async () => {
    outboxRows = [baseRow('queued')];
    renderPanel();
    await waitFor(() => {
      expect(document.body).toBeTruthy();
    });
    expect(announce).not.toHaveBeenCalled();
  });
});
