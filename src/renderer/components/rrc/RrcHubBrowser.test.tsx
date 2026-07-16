import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RrcHubInfo } from '@/shared/rrc-types';

import { RrcHubBrowser } from './RrcHubBrowser';

const hubA: RrcHubInfo = {
  destination_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  display_name: 'Hub A',
  recommended: false,
  favorited: true,
  source: 'discovered',
};

const hubB: RrcHubInfo = {
  destination_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  display_name: 'Hub B',
  recommended: false,
  favorited: true,
  source: 'manual',
};

const hubC: RrcHubInfo = {
  destination_hash: 'cccccccccccccccccccccccccccccccc',
  display_name: 'Hub C',
  recommended: false,
  favorited: false,
  source: 'discovered',
  hops: 1,
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
      favourites={[hubA, hubB]}
      discovered={[hubC]}
      hubDestHash={hubA.destination_hash}
      unreadForHub={() => 0}
      statusForHub={() => null}
      isHubAutoJoin={() => false}
      manualHash=""
      onManualHashChange={() => {}}
      hubTab="favourites"
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
  it('shows favourites on the Favourites tab and not discovered hubs', () => {
    renderBrowser();
    expect(screen.getByRole('button', { name: /Select hub Hub A/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select hub Hub B/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Select hub Hub C/i })).not.toBeInTheDocument();
  });

  it('shows discovered hubs only on the Discovered tab', () => {
    renderBrowser({ hubTab: 'discovered' });
    expect(screen.getByRole('button', { name: /Select hub Hub C/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Select hub Hub A/i })).not.toBeInTheDocument();
  });

  it('requests Discovered tab via onHubTabChange', async () => {
    const user = userEvent.setup();
    const onHubTabChange = vi.fn();
    renderBrowser({ onHubTabChange });
    await user.click(screen.getByRole('button', { name: 'Discovered' }));
    expect(onHubTabChange).toHaveBeenCalledWith('discovered');
  });

  it('shows empty Favourites copy when there are no starred hubs', () => {
    renderBrowser({ favourites: [] });
    expect(screen.getByText(/No favourite RRC hubs yet/i)).toBeInTheDocument();
  });

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

    await user.click(screen.getAllByRole('button', { name: 'Turn on hub auto-join' })[0]);
    expect(onToggleAutoJoin).toHaveBeenCalledWith(hubA.destination_hash);
  });

  it('shows pressed state when hub auto-join is enabled', () => {
    renderBrowser({
      isHubAutoJoin: (hash) => hash === hubA.destination_hash,
    });
    const onBtn = screen.getByRole('button', { name: 'Turn off hub auto-join' });
    expect(onBtn).toHaveAttribute('aria-pressed', 'true');
    expect(onBtn).toHaveAttribute('title', expect.stringMatching(/click to turn off/i));
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
