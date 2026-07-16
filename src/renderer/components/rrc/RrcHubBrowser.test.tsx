import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('RrcHubBrowser', () => {
  it('keeps hub rows clickable while a prior connect is in flight', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(
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
        manualHash=""
        onManualHashChange={() => {}}
        hubTab="recommended"
        onHubTabChange={() => {}}
        onRefresh={() => {}}
        onConnect={onConnect}
        onToggleFavorite={() => {}}
        onManualConnect={() => {}}
      />,
    );

    const hubBBtn = screen.getByRole('button', { name: 'Select hub Hub B' });
    expect(hubBBtn).not.toBeDisabled();
    await user.click(hubBBtn);
    expect(onConnect).toHaveBeenCalledWith(hubB.destination_hash);
  });

  it('shows unread badge on hubs with waiting messages', () => {
    render(
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
        unreadForHub={(hash) => (hash === hubA.destination_hash ? 4 : 0)}
        manualHash=""
        onManualHashChange={() => {}}
        hubTab="recommended"
        onHubTabChange={() => {}}
        onRefresh={() => {}}
        onConnect={() => {}}
        onToggleFavorite={() => {}}
        onManualConnect={() => {}}
      />,
    );

    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select hub Hub A 4 unread' })).toBeInTheDocument();
  });
});
