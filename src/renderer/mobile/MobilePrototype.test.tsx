import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { MeshProtocol } from '@/shared/meshProtocol';

import {
  type MobileDisplay,
  type MobilePlatform,
  MobilePrototype,
  type MobileScene,
} from './MobilePrototype';

const initialUrl = window.location.href;
const layout = vi.hoisted(() => ({ wide: false }));

vi.mock('./useWideMobileLayout', () => ({
  useWideMobileLayout: () => layout.wide,
}));

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    },
  });
});

afterAll(() => {
  if (originalShowModal) {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  }
  if (originalClose) {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  }
});

afterEach(() => {
  window.history.replaceState(null, '', initialUrl);
  layout.wide = false;
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
    expect(screen.getByRole('combobox', { name: 'Display preview' })).toHaveValue('phone');
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

  it('changes display previews while retaining the current conversation and draft', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MobilePrototype initialScene="chat" initialProtocol="meshcore" initialPlatform="android" />,
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Message draft, preview only' }),
      'For Morgan',
    );

    for (const display of ['tablet', 'foldable', 'phone']) {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Display preview' }), display);
      expect(container.firstElementChild).toHaveAttribute('data-display', display);
      expect(screen.getByRole('heading', { level: 1, name: 'Morgan' })).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
        'For Morgan',
      );
      expect(screen.getByRole('combobox', { name: 'Protocol' })).toHaveValue('meshcore');
      expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveValue('android');
      expect(
        screen.getByRole('button', { name: 'Send message, design placeholder' }),
      ).toBeDisabled();
    }
  });

  it.each([
    ['tablet', 'chat', 'meshtastic', 'Alex'],
    ['foldable', 'message-error', 'meshcore', 'Morgan'],
  ] satisfies [MobileDisplay, MobileScene, MeshProtocol, string][])(
    'keeps a conversation list alongside the %s %s preview',
    (display, scene, protocol, name) => {
      layout.wide = true;
      render(
        <MobilePrototype
          initialDisplay={display}
          initialScene={scene}
          initialProtocol={protocol}
        />,
      );

      const list = screen.getByRole('region', { name: 'Conversation list' });
      expect(
        within(list).getByRole('button', { name: `Preview conversation with ${name}` }),
      ).toBeVisible();
      expect(screen.getByRole('heading', { level: 1, name })).toBeVisible();
      expect(screen.getByLabelText('Sample message history')).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Back to chats' })).not.toBeInTheDocument();
      expect(
        screen.getByRole('banner', { name: 'Mobile UI preview' }).parentElement,
      ).toHaveAttribute('data-wide', 'true');
    },
  );

  it('lets a reviewer choose a conversation from the wide empty pane', async () => {
    const user = userEvent.setup();
    layout.wide = true;
    render(
      <MobilePrototype
        initialDisplay="tablet"
        initialScene="conversations"
        initialProtocol="reticulum"
      />,
    );

    const list = screen.getByRole('region', { name: 'Conversation list' });
    expect(screen.getByText('Choose a conversation to start reading.')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Preview conversation with Sam' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Sam' })).toHaveFocus();
    expect(screen.getByLabelText('Sample message history')).toHaveTextContent(
      'Field node is ready. See you at camp.',
    );
    expect(screen.queryByText('Choose a conversation to start reading.')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Conversation list' })).toBeVisible();
  });

  it('retains the conversation and draft while its available width changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MobilePrototype initialDisplay="foldable" initialScene="chat" />);
    await user.type(
      screen.getByRole('textbox', { name: 'Message draft, preview only' }),
      'A folding draft',
    );
    expect(screen.queryByRole('region', { name: 'Conversation list' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to chats' })).toBeVisible();

    layout.wide = true;
    rerender(<MobilePrototype initialDisplay="foldable" initialScene="chat" />);
    expect(screen.getByRole('region', { name: 'Conversation list' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Back to chats' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
      'A folding draft',
    );

    layout.wide = false;
    rerender(<MobilePrototype initialDisplay="foldable" initialScene="chat" />);
    expect(screen.queryByRole('region', { name: 'Conversation list' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to chats' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Alex' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
      'A folding draft',
    );
  });

  it('switches the sample conversation from the header chooser and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype initialScene="chat" />);
    await user.click(screen.getByRole('button', { name: 'Switch protocol, current Meshtastic' }));

    const dialog = screen.getByRole('dialog', { name: 'Choose a protocol' });
    expect(within(dialog).getByRole('radio', { name: 'Switch to Meshtastic' })).toHaveFocus();
    await user.click(within(dialog).getByRole('radio', { name: 'Switch to MeshCore' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch protocol, current MeshCore' })).toHaveFocus();
    expect(screen.getByRole('heading', { level: 1, name: 'Morgan' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Protocol' })).toHaveValue('meshcore');
    const history = within(screen.getByLabelText('Sample message history'));
    expect(history.getByText('Basecamp radio is on. How is the trail?')).toBeVisible();
    expect(history.getByText('All good here. Checking in from the ridge.')).toBeVisible();
    expect(history.queryByText('At the trailhead. Can you hear me?')).not.toBeInTheDocument();
  });

  it('restores each protocol draft without carrying text or message history into another protocol', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype initialScene="chat" />);
    const samples = [
      ['meshtastic', 'Alex', 'For Alex', 'At the trailhead. Can you hear me?'],
      ['meshcore', 'Morgan', 'For Morgan', 'Basecamp radio is on. How is the trail?'],
      ['reticulum', 'Sam', 'For Sam', 'Field node is ready. See you at camp.'],
    ] satisfies [MeshProtocol, string, string, string][];

    for (const [protocol, name, draftText, incoming] of samples) {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Protocol' }), protocol);
      expect(screen.getByRole('heading', { level: 1, name })).toBeVisible();
      const draft = screen.getByRole('textbox', { name: 'Message draft, preview only' });
      expect(draft).toHaveValue('');
      await user.type(draft, draftText);
      const history = within(screen.getByLabelText('Sample message history'));
      expect(history.getByText(incoming)).toBeVisible();
      for (const [otherProtocol, , , otherIncoming] of samples) {
        if (otherProtocol !== protocol)
          expect(history.queryByText(otherIncoming)).not.toBeInTheDocument();
      }
    }

    for (const [protocol, name, draftText] of samples) {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Protocol' }), protocol);
      expect(screen.getByRole('heading', { level: 1, name })).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
        draftText,
      );
      expect(
        screen.getByRole('button', { name: 'Send message, design placeholder' }),
      ).toBeDisabled();
    }
  });

  it('retains separate protocol scenes and restores a failed-message draft after another radio disconnects', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype initialScene="ready" />);
    await user.click(screen.getByRole('button', { name: 'Open chats' }));
    await user.click(screen.getByRole('button', { name: 'Preview conversation with Alex' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Message draft, preview only' }),
      'Keep this draft',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Screen' }), 'message-error');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Protocol' }), 'meshcore');
    expect(screen.getByRole('heading', { level: 1, name: 'Your radio is ready' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Connect your radio' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Switch protocol, current MeshCore' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Choose a protocol' }));
    expect(dialog.getByRole('radio', { name: 'Switch to Meshtastic' })).toHaveAccessibleDescription(
      'Trail radio Radio ready, sample 2 unread, sample',
    );
    expect(dialog.getByRole('radio', { name: 'Switch to MeshCore' })).toHaveAccessibleDescription(
      'Basecamp radio No radio connected 1 unread, sample',
    );
    await user.click(dialog.getByRole('radio', { name: 'Switch to Meshtastic' }));

    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('message-error');
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
      'Keep this draft',
    );
    expect(screen.getByText('Failed, sample state')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Retry message, design placeholder' }),
    ).toBeDisabled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Protocol' }), 'reticulum');
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('ready');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Protocol' }), 'meshcore');
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('connect');
    expect(
      screen.getByRole('button', { name: 'Preview radio connection screen' }),
    ).toHaveTextContent('No radio connected');
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

      expect(
        screen.getByRole('button', { name: `Switch protocol, current ${displayName}` }),
      ).toHaveTextContent(displayName);
      expect(within(screen.getByRole('main')).getByText(radioName)).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Preview radio connection screen' }),
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
    window.history.replaceState(
      null,
      '',
      '?scene=chat&platform=android&protocol=meshcore&display=tablet',
    );
    render(<MobilePrototype />);

    expect(screen.getByRole('heading', { level: 1, name: 'Morgan' })).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('chat');
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveValue('android');
    expect(screen.getByRole('combobox', { name: 'Protocol' })).toHaveValue('meshcore');
    expect(screen.getByRole('combobox', { name: 'Display preview' })).toHaveValue('tablet');
    expect(
      screen.getByRole('button', { name: 'Preview radio connection screen' }),
    ).toHaveTextContent('Basecamp radio, sample link');
  });

  it('falls back to a usable start screen for unknown URL values', () => {
    window.history.replaceState(
      null,
      '',
      '?scene=unknown&platform=unknown&protocol=unknown&display=unknown',
    );
    render(<MobilePrototype />);

    expect(screen.getByRole('heading', { level: 1, name: 'Connect your radio' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('connect');
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveValue('ios');
    expect(screen.getByRole('combobox', { name: 'Protocol' })).toHaveValue('meshtastic');
    expect(screen.getByRole('combobox', { name: 'Display preview' })).toHaveValue('phone');
  });

  it('uses explicit preview props before URL parameters', () => {
    window.history.replaceState(
      null,
      '',
      '?scene=chat&platform=android&protocol=meshcore&display=tablet',
    );
    render(
      <MobilePrototype
        initialScene="ready"
        initialPlatform="ios"
        initialProtocol="reticulum"
        initialDisplay="foldable"
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Your radio is ready' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('ready');
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveValue('ios');
    expect(screen.getByRole('combobox', { name: 'Protocol' })).toHaveValue('reticulum');
    expect(screen.getByRole('combobox', { name: 'Display preview' })).toHaveValue('foldable');
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

  it.each([
    ['tablet', 'conversations', 'ios', 'meshtastic'],
    ['tablet', 'chat', 'ios', 'reticulum'],
    ['foldable', 'message-error', 'android', 'meshcore'],
  ] satisfies [MobileDisplay, MobileScene, MobilePlatform, MeshProtocol][])(
    'has no axe violations in the wide %s %s preview for %s using %s',
    async (display, scene, platform, protocol) => {
      layout.wide = true;
      const { container } = render(
        <MobilePrototype
          initialDisplay={display}
          initialScene={scene}
          initialPlatform={platform}
          initialProtocol={protocol}
        />,
      );
      hydrateAxeThemeColors(container);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('has no axe violations in the integrated protocol chooser', async () => {
    const user = userEvent.setup();
    const { container } = render(<MobilePrototype initialScene="chat" />);
    await user.click(screen.getByRole('button', { name: 'Switch protocol, current Meshtastic' }));
    hydrateAxeThemeColors(container);
    expect(
      await axe(screen.getByRole('dialog', { name: 'Choose a protocol' })),
    ).toHaveNoViolations();
  });
});
