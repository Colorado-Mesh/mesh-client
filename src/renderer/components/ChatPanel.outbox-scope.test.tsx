import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UseChatOutboxOptions } from '@/renderer/hooks/useChatOutbox';
import {
  FLOOD_SCOPE_OVERRIDE_UNSCOPED,
  saveFloodScopeOverride,
} from '@/renderer/lib/chatPanelProtocolStorage';
import { meshcoreChannelScopeKey } from '@/renderer/lib/meshcoreChannelScope';

import ChatPanel from './ChatPanel';
import { ToastProvider } from './Toast';

const signature = 'meshcore:pk:' + 'a'.repeat(64);
const publicChannel = { index: 0, name: 'Public', secret: new Uint8Array(16).fill(1) };
const localChannel = { index: 1, name: 'tricities', secret: new Uint8Array(16).fill(2) };
let outboxArgs: UseChatOutboxOptions;

vi.mock('@/renderer/hooks/useChatOutbox', () => ({
  useChatOutbox: (args: UseChatOutboxOptions) => {
    outboxArgs = args;
    return { rows: [], queue: vi.fn(), retry: vi.fn(), cancel: vi.fn() };
  },
}));
vi.mock('@/renderer/stores/identityStore', () => ({
  useIdentityStore: (
    selector: (state: { identities: Record<string, { signature: string }> }) => unknown,
  ) => selector({ identities: { radio: { signature } } }),
}));

function panel() {
  const onSend = vi.fn().mockResolvedValue('message-id');
  const applyScope = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <ChatPanel
        messages={[]}
        channels={[publicChannel, localChannel]}
        meshcoreChannelSources={[publicChannel, localChannel]}
        myNodeNum={1}
        identityId="radio"
        protocol="meshcore"
        onSend={onSend}
        onReact={vi.fn()}
        onResend={vi.fn()}
        onNodeClick={vi.fn()}
        isConnected
        nodes={new Map()}
        isActive
        meshcoreFloodScopeHashtag="#us-southeast"
        applyMeshcoreFloodScopeHashtag={applyScope}
      />
    </ToastProvider>,
  );
  return { onSend, applyScope };
}

describe('ChatPanel outbox channel scopes', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each([
    [localChannel, '#us-tn-tri', '#us-tn-tri'],
    [publicChannel, FLOOD_SCOPE_OVERRIDE_UNSCOPED, ''],
  ])(
    'applies the queued destination scope and restores the radio default',
    async (channel, preference, effective) => {
      saveFloodScopeOverride('meshcore', meshcoreChannelScopeKey(signature, channel)!, preference);
      const { onSend, applyScope } = panel();
      expect(await outboxArgs.sendFn('MECP/3/R02', channel.index)).toBe('message-id');
      expect(onSend).toHaveBeenCalledWith('MECP/3/R02', channel.index, undefined, undefined);
      expect(applyScope.mock.calls).toEqual([[effective], ['#us-southeast']]);
      expect(applyScope.mock.invocationCallOrder[0]).toBeLessThan(
        onSend.mock.invocationCallOrder[0],
      );
      expect(applyScope.mock.invocationCallOrder[1]).toBeGreaterThan(
        onSend.mock.invocationCallOrder[0],
      );
    },
  );

  it('does not reuse a scope from a different radio or channel key', async () => {
    const otherSignature = 'meshcore:pk:' + 'b'.repeat(64);
    saveFloodScopeOverride(
      'meshcore',
      meshcoreChannelScopeKey(otherSignature, localChannel)!,
      '#us-tn-tri',
    );
    saveFloodScopeOverride(
      'meshcore',
      meshcoreChannelScopeKey(signature, { ...localChannel, secret: new Uint8Array(16).fill(3) })!,
      '#us-tn',
    );
    const { applyScope } = panel();
    await outboxArgs.sendFn('queued hello', localChannel.index);
    expect(applyScope).not.toHaveBeenCalled();
  });

  it('restores the radio default and leaves a failed send rejected for retry', async () => {
    saveFloodScopeOverride(
      'meshcore',
      meshcoreChannelScopeKey(signature, localChannel)!,
      '#us-tn-tri',
    );
    const { onSend, applyScope } = panel();
    onSend.mockRejectedValueOnce(new Error('radio disconnected'));
    await expect(outboxArgs.sendFn('MECP/3/R02', localChannel.index)).rejects.toThrow(
      'radio disconnected',
    );
    expect(applyScope.mock.calls).toEqual([['#us-tn-tri'], ['#us-southeast']]);
  });
});
