import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RrcHubInfo } from '@/shared/rrc-types';

import { RrcHubBrowser } from './RrcHubBrowser';

const hubA: RrcHubInfo = {
  destination_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  display_name: 'Hub A',
  recommended: true,
  favorited: false,
  source: 'manual',
};

const hubB: RrcHubInfo = {
  destination_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  display_name: 'Hub B',
  recommended: true,
  favorited: false,
  source: 'manual',
};

function renderBrowser(
  overrides: Partial<ComponentProps<typeof RrcHubBrowser>> = {},
): ReturnType<typeof render> {
  return render(
    <RrcHubBrowser
      collapsed={false}
      onToggleCollapsed={() => {}}
      sidecarRunning
      hubSearch=""
      onHubSearchChange={() => {}}
      nickname="tester"
      onNicknameChange={() => {}}
      recommended={[hubA, hubB]}
      favourites={[]}
      discovered={[]}
      manual={[]}
      hubDestHash={hubA.destination_hash}
      unreadForHub={() => 0}
      statusForHub={() => null}
      isHubAutoJoin={() => false}
      manualHash=""
      onManualHashChange={() => {}}
      hubTab="recommended"
      onHubTabChange={() => {}}
      onRefresh={() => {}}
      onConnect={() => {}}
      onToggleFavorite={() => {}}
      onToggleAutoJoin={() => {}}
      onManualConnect={() => {}}
      {...overrides}
    />,
  );
}

describe('RrcHubBrowser', () => {
  it('keeps hub rows clickable while a prior connect is in flight', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    renderBrowser({
      statusForHub: (hash) => (hash === hubA.destination_hash ? 'connecting' : null),
      onConnect,
    });

    const hubBBtn = screen.getByRole('button', { name: /Select hub Hub B/i });
    expect(hubBBtn).not.toBeDisabled();
    await user.click(hubBBtn);
    expect(onConnect).toHaveBeenCalledWith(hubB.destination_hash);
  });

  it('shows unread badge on hubs with waiting messages', () => {
    renderBrowser({
      unreadForHub: (hash) => (hash === hubA.destination_hash ? 4 : 0),
    });

    expect(screen.getByText('4')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Select hub Hub A .* 4 unread/i }),
    ).toBeInTheDocument();
  });

  it('shows connected and auto-join markers', () => {
    renderBrowser({
      statusForHub: (hash) => (hash === hubA.destination_hash ? 'active' : null),
      isHubAutoJoin: (hash) => hash === hubB.destination_hash,
    });

    expect(screen.getByTitle('Connected')).toHaveTextContent('●');
    expect(screen.getByTitle('Auto-join enabled')).toHaveTextContent('◐');
  });

  it('toggles hub auto-join with the A control', async () => {
    const user = userEvent.setup();
    const onToggleAutoJoin = vi.fn();
    renderBrowser({ onToggleAutoJoin });

    await user.click(screen.getAllByRole('button', { name: 'Enable hub auto-join' })[0]);
    expect(onToggleAutoJoin).toHaveBeenCalledWith(hubA.destination_hash);
  });

  it('clicking a connected hub still invokes onConnect (panel focuses without IPC)', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    renderBrowser({
      statusForHub: (hash) => (hash === hubB.destination_hash ? 'active' : null),
      onConnect,
    });

    await user.click(screen.getByRole('button', { name: /Select hub Hub B/i }));
    expect(onConnect).toHaveBeenCalledWith(hubB.destination_hash);
  });
});
