import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RrcChatMessage } from '@/shared/rrc-types';

import { RrcChatView } from './RrcChatView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function makeMsg(
  partial: Partial<RrcChatMessage> & Pick<RrcChatMessage, 'id' | 'body'>,
): RrcChatMessage {
  return {
    room: '#general',
    kind: 'msg',
    timestamp: Date.now(),
    nickname: 'alice',
    sender_hash: 'bb'.repeat(16),
    ...partial,
  };
}

describe('RrcChatView alwaysShowMessageActions', () => {
  it('keeps copy control visible when alwaysShowMessageActions is set', () => {
    render(
      <RrcChatView
        connected
        activeRoom="#general"
        messages={[makeMsg({ id: '1', body: 'hello' })]}
        showTimestamps={false}
        draft=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        canSend
        isMuted={false}
        alwaysShowMessageActions
      />,
    );
    const btn = screen.getByLabelText('rrc.copyMessage');
    expect(btn.className).toContain('opacity-100');
    expect(btn.className).not.toMatch(/(?:^|\s)opacity-0(?:\s|$)/);
  });

  it('uses hover/focus-within visibility for copy by default', () => {
    render(
      <RrcChatView
        connected
        activeRoom="#general"
        messages={[makeMsg({ id: '1', body: 'hello' })]}
        showTimestamps={false}
        draft=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        canSend
        isMuted={false}
      />,
    );
    const btn = screen.getByLabelText('rrc.copyMessage');
    expect(btn.className).toMatch(/(?:^|\s)opacity-0(?:\s|$)/);
    expect(btn.className).toContain('group-focus-within:opacity-100');
    expect(btn.className).toContain('group-hover:opacity-100');
  });
});
