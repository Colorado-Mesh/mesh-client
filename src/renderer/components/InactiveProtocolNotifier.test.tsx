import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, MeshProtocol } from '@/renderer/lib/types';

const addToast = vi.hoisted(() => vi.fn());

vi.mock('./Toast', () => ({
  useToast: () => ({ addToast }),
}));

import { InactiveProtocolNotifier } from './InactiveProtocolNotifier';

function msg(id: number): ChatMessage {
  return {
    sender_id: id,
    sender_name: `n${id}`,
    payload: 'hi',
    channel: 0,
    timestamp: id,
  };
}

function byProtocol(meshcoreCount: number): Record<MeshProtocol, ChatMessage[]> {
  return {
    meshtastic: [],
    meshcore: Array.from({ length: meshcoreCount }, (_, i) => msg(i + 1)),
    reticulum: [],
  };
}

describe('InactiveProtocolNotifier', () => {
  beforeEach(() => {
    addToast.mockReset();
  });

  it('toasts new messages on an enabled inactive protocol', () => {
    const { rerender } = render(
      <InactiveProtocolNotifier activeProtocol="meshtastic" messagesByProtocol={byProtocol(1)} />,
    );
    rerender(
      <InactiveProtocolNotifier activeProtocol="meshtastic" messagesByProtocol={byProtocol(2)} />,
    );
    expect(addToast).toHaveBeenCalledTimes(1);
  });

  it('never toasts for a protocol disabled in App → Protocols', () => {
    const enabled: MeshProtocol[] = ['meshtastic', 'reticulum'];
    const { rerender } = render(
      <InactiveProtocolNotifier
        activeProtocol="meshtastic"
        messagesByProtocol={byProtocol(1)}
        enabledProtocols={enabled}
      />,
    );
    rerender(
      <InactiveProtocolNotifier
        activeProtocol="meshtastic"
        messagesByProtocol={byProtocol(3)}
        enabledProtocols={enabled}
      />,
    );
    expect(addToast).not.toHaveBeenCalled();
  });
});
