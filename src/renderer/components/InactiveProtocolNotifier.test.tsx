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
    localStorage.clear();
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

  it.each(['global', 'conversation', 'mentions'])(
    'honors %s filtering without replaying earlier messages',
    (mode) => {
      const { rerender } = render(
        <InactiveProtocolNotifier activeProtocol="meshtastic" messagesByProtocol={byProtocol(1)} />,
      );
      if (mode === 'global') localStorage.setItem('mesh-client:notifMuted', '1');
      if (mode === 'conversation')
        localStorage.setItem('mesh-client:mutedViews:meshcore', '["ch:0"]');
      if (mode === 'mentions') localStorage.setItem('mesh-client:chatNotificationMode', 'mentions');
      rerender(
        <InactiveProtocolNotifier activeProtocol="meshtastic" messagesByProtocol={byProtocol(2)} />,
      );
      expect(addToast).not.toHaveBeenCalled();
      localStorage.clear();
      rerender(
        <InactiveProtocolNotifier activeProtocol="meshtastic" messagesByProtocol={byProtocol(2)} />,
      );
      expect(addToast).not.toHaveBeenCalled();
      rerender(
        <InactiveProtocolNotifier activeProtocol="meshtastic" messagesByProtocol={byProtocol(3)} />,
      );
      expect(addToast).toHaveBeenCalledTimes(1);
    },
  );

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

  it('preserves the existing passive MECP toast independently of chat filtering', () => {
    localStorage.setItem('mesh-client:chatNotificationMode', 'mentions');
    localStorage.setItem('mesh-client:notifMuted', '1');
    const { rerender } = render(
      <InactiveProtocolNotifier activeProtocol="meshtastic" messagesByProtocol={byProtocol(1)} />,
    );
    rerender(
      <InactiveProtocolNotifier
        activeProtocol="meshtastic"
        messagesByProtocol={{
          ...byProtocol(1),
          meshcore: [msg(1), { ...msg(2), payload: 'MECP/0/M01' }],
        }}
      />,
    );
    expect(addToast).toHaveBeenCalledTimes(1);
  });
});
