import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { MeshProtocol } from '@/shared/meshProtocol';

import { type MobilePlatform, MobilePrototype, type MobileScene } from './MobilePrototype';

const initialUrl = window.location.href;

afterEach(() => {
  window.history.replaceState(null, '', initialUrl);
});

describe('MobilePrototype', () => {
  it('identifies the shell as a preview and focuses the initial screen heading', () => {
    render(<MobilePrototype />);

    expect(
      screen.getByText('UI prototype. Sample data. No Bluetooth or message delivery.'),
    ).toBeVisible();
    expect(
      screen.getByRole('banner', { name: 'Mobile UI preview' }).parentElement!,
    ).toHaveAttribute('data-platform', 'ios');
    expect(screen.getByRole('heading', { level: 1, name: 'Connect your radio' })).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Preview radio connection screen' }),
    ).toHaveTextContent('No radio connected');
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('connect');
  });

  it('lets reviewers jump to a screen and moves focus to its heading', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Screen' }), 'ready');

    expect(screen.getByRole('heading', { level: 1, name: 'Your radio is ready' })).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Preview radio connection screen' }),
    ).toHaveTextContent('Trail radio, sample link');
    expect(
      screen.getByText('A radio connection does not guarantee that a recipient is reachable.'),
    ).toBeVisible();
  });

  it('changes the permission explanation with the selected phone platform', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype initialScene="permission" />);

    expect(screen.getByText(/iOS will ask you to allow access\./)).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Platform' }), 'android');

    expect(
      screen.getByRole('banner', { name: 'Mobile UI preview' }).parentElement!,
    ).toHaveAttribute('data-platform', 'android');
    expect(screen.getByText(/needs Nearby devices access/)).toBeVisible();
    expect(screen.queryByText(/iOS will ask you to allow access\./)).not.toBeInTheDocument();
    expect(
      screen.getByText('This preview does not request permission or open a system dialog.'),
    ).toBeVisible();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Platform' }), 'ios');
    expect(screen.getByText(/iOS will ask you to allow access\./)).toBeVisible();
  });

  it.each([
    ['meshtastic', 'Meshtastic', 'Trail radio'],
    ['meshcore', 'MeshCore', 'Basecamp radio'],
    ['reticulum', 'Reticulum', 'Field RNode'],
  ] satisfies [MeshProtocol, string, string][])(
    'previews %s branding and its named sample radio',
    async (protocol, displayName, radioName) => {
      const user = userEvent.setup();
      render(<MobilePrototype initialScene="ready" />);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Protocol' }), protocol);

      const phone = within(
        screen.getByRole('banner', { name: 'Mobile UI preview' }).parentElement!,
      );
      expect(phone.getByText(displayName)).toBeVisible();
      expect(phone.getByText(radioName)).toBeVisible();
      expect(
        phone.getByRole('button', { name: 'Preview radio connection screen' }),
      ).toHaveTextContent(`${radioName}, sample link`);
    },
  );

  it('navigates the connection mock screens and allows cancelling back to radio selection', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype />);

    await user.click(screen.getByRole('button', { name: 'Find radios' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Allow Bluetooth access' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Nearby radios' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Preview connection to Trail radio' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Connecting to your radio' }),
    ).toHaveFocus();
    expect(screen.getByText(/No pairing takes place in this preview\./)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Nearby radios' })).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Preview radio connection screen' }),
    ).toHaveTextContent('No radio connected');
  });

  it('keeps navigation current while opening a sample chat, going back, and returning to setup', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype initialScene="ready" />);
    const nav = within(screen.getByRole('navigation', { name: 'Mobile navigation preview' }));
    const chat = nav.getByRole('button', { name: 'Chat' });
    const more = nav.getByRole('button', { name: 'More' });

    expect(more).toHaveAttribute('aria-current', 'page');
    expect(chat).not.toHaveAttribute('aria-current');
    await user.click(chat);
    expect(screen.getByRole('heading', { level: 1, name: 'Chats' })).toHaveFocus();
    expect(chat).toHaveAttribute('aria-current', 'page');
    expect(more).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('button', { name: 'Preview conversation with Alex' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Alex' })).toHaveFocus();
    expect(chat).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Back to chats' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Chats' })).toHaveFocus();
    await user.click(more);
    expect(screen.getByRole('heading', { level: 1, name: 'Connect your radio' })).toHaveFocus();
    expect(more).toHaveAttribute('aria-current', 'page');
    expect(chat).not.toHaveAttribute('aria-current');
  });

  it('leaves unfinished navigation destinations disabled and on the current mock screen', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype initialScene="conversations" />);
    const nav = within(screen.getByRole('navigation', { name: 'Mobile navigation preview' }));

    for (const name of [
      'Network, design pending',
      'Map, design pending',
      'Incident, design pending',
    ]) {
      const button = nav.getByRole('button', { name });
      expect(button).toBeDisabled();
      await user.click(button);
      expect(screen.getByRole('heading', { level: 1, name: 'Chats' })).toBeVisible();
    }
  });

  it.each(['chat', 'message-error'] as const)(
    'allows local draft editing in %s without sending or altering sample messages',
    async (scene) => {
      const user = userEvent.setup();
      render(<MobilePrototype initialScene={scene} />);
      const draft = screen.getByRole('textbox', { name: 'Message draft, preview only' });
      const history = within(screen.getByLabelText('Sample message history'));
      const send = screen.getByRole('button', { name: 'Send message, design placeholder' });

      expect(draft).toBeEnabled();
      expect(send).toBeDisabled();
      await user.type(draft, 'Reviewing the composer');
      await user.keyboard('{Enter}');
      await user.click(send);

      expect(draft).toHaveValue('Reviewing the composer\n');
      expect(history.getByText('At the trailhead. Can you hear me?')).toBeVisible();
      expect(history.getByText('Loud and clear. Heading your way now.')).toBeVisible();
      expect(history.queryByText('Reviewing the composer')).not.toBeInTheDocument();
      expect(screen.getByText('Draft field only. Sending is not implemented.')).toBeVisible();

      if (scene === 'message-error') {
        const retry = screen.getByRole('button', { name: 'Retry message, design placeholder' });
        expect(retry).toBeDisabled();
        await user.click(retry);
        expect(history.getByText('Failed, sample state')).toBeVisible();
        expect(draft).toHaveValue('Reviewing the composer\n');
      } else {
        expect(history.getByText('Delivered, sample state')).toBeVisible();
      }
    },
  );

  it('opens a screenshot scene from URL parameters', () => {
    window.history.replaceState(null, '', '?scene=chat&platform=android&protocol=meshcore');
    render(<MobilePrototype />);

    expect(screen.getByRole('heading', { level: 1, name: 'Alex' })).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('chat');
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveValue('android');
    expect(screen.getByRole('combobox', { name: 'Protocol' })).toHaveValue('meshcore');
    expect(
      screen.getByRole('button', { name: 'Preview radio connection screen' }),
    ).toHaveTextContent('Basecamp radio, sample link');
  });

  it('falls back to a usable start screen for unknown URL values', () => {
    window.history.replaceState(null, '', '?scene=unknown&platform=unknown&protocol=unknown');
    render(<MobilePrototype />);

    expect(screen.getByRole('heading', { level: 1, name: 'Connect your radio' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('connect');
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveValue('ios');
    expect(screen.getByRole('combobox', { name: 'Protocol' })).toHaveValue('meshtastic');
  });

  it('uses explicit preview props before URL parameters', () => {
    window.history.replaceState(null, '', '?scene=chat&platform=android&protocol=meshcore');
    render(
      <MobilePrototype initialScene="ready" initialPlatform="ios" initialProtocol="reticulum" />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Your radio is ready' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('ready');
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveValue('ios');
    expect(screen.getByRole('combobox', { name: 'Protocol' })).toHaveValue('reticulum');
  });

  it.each([
    ['connect', 'ios', 'meshtastic'],
    ['ready', 'android', 'meshcore'],
    ['chat', 'ios', 'reticulum'],
    ['message-error', 'android', 'meshcore'],
  ] satisfies [MobileScene, MobilePlatform, MeshProtocol][])(
    'has no axe violations on the %s screen for %s using %s',
    async (scene, platform, protocol) => {
      const { container } = render(
        <MobilePrototype
          initialScene={scene}
          initialPlatform={platform}
          initialProtocol={protocol}
        />,
      );
      hydrateAxeThemeColors(container);
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
