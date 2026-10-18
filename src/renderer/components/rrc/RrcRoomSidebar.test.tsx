import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import i18n from '@/renderer/lib/i18n';

import { RrcRoomSidebar } from './RrcRoomSidebar';

it.each(['linux', 'darwin', 'win32'] as const)(
  'exposes selected-room unread on %s',
  async (platform) => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
    await i18n.changeLanguage('en');
    const { container } = render(
      <RrcRoomSidebar
        roomSearch=""
        onRoomSearchChange={vi.fn()}
        joinRoomName=""
        onJoinRoomNameChange={vi.fn()}
        joinRoomKey=""
        onJoinRoomKeyChange={vi.fn()}
        busy={false}
        onJoin={vi.fn()}
        joined={[{ name: '#general' }]}
        listed={[]}
        favourites={[]}
        recent={[]}
        activeRoom="#general"
        unreadByRoom={new Map([['general', 3]])}
        onSelectRoom={vi.fn()}
        onToggleFavourite={vi.fn()}
        onToggleAutoJoin={vi.fn()}
        autoJoin={[]}
      />,
    );
    const selected = screen.getByRole('button', { name: 'Open room #general, 3 unread' });
    expect(selected).toHaveAttribute('aria-current', 'true');
    expect(selected).toHaveTextContent('3');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  },
);
