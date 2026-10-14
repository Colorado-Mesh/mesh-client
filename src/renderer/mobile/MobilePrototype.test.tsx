import { fireEvent, render, screen, within } from '@testing-library/react';
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
      this.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
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
    ).toHaveTextContent('Trail radio, connected');
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

      const list = screen.getByRole('complementary', { name: 'Conversation list' });
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

    const list = screen.getByRole('complementary', { name: 'Conversation list' });
    expect(screen.getByText('Choose a conversation to start reading.')).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: 'Message draft, preview only' }),
    ).not.toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Preview conversation with Sam' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Sam' })).toHaveFocus();
    expect(screen.getByLabelText('Sample message history')).toHaveTextContent(
      'Field node is ready. See you at camp.',
    );
    expect(screen.queryByText('Choose a conversation to start reading.')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Conversation list' })).toBeVisible();
  });

  it('retains the conversation and draft while its available width changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MobilePrototype initialDisplay="foldable" initialScene="chat" />);
    await user.type(
      screen.getByRole('textbox', { name: 'Message draft, preview only' }),
      'A folding draft',
    );
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveFocus();
    expect(
      screen.queryByRole('complementary', { name: 'Conversation list' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to chats' })).toBeVisible();

    layout.wide = true;
    rerender(<MobilePrototype initialDisplay="foldable" initialScene="chat" />);
    expect(screen.getByRole('complementary', { name: 'Conversation list' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Back to chats' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
      'A folding draft',
    );
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveFocus();

    layout.wide = false;
    rerender(<MobilePrototype initialDisplay="foldable" initialScene="chat" />);
    expect(
      screen.queryByRole('complementary', { name: 'Conversation list' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to chats' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Alex' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
      'A folding draft',
    );
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveFocus();
  });

  it('switches the sample conversation from the header chooser and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype initialScene="chat" />);
    await user.click(screen.getByRole('button', { name: 'Switch protocol, current Meshtastic' }));

    const dialog = screen.getByRole('dialog', { name: 'Choose a protocol' });
    expect(
      within(dialog).getByRole('radio', { name: /^Switch to Meshtastic(?:,|$)/ }),
    ).toHaveFocus();
    await user.click(within(dialog).getByRole('radio', { name: /^Switch to MeshCore(?:,|$)/ }));

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
    const trailContext = within(dialog.getByText('Trail radio').parentElement!.parentElement!);
    expect(trailContext.getByText('Radio ready, sample')).toBeVisible();
    expect(trailContext.getByText('2 unread, sample')).toBeVisible();
    const basecampContext = within(
      dialog.getByText('Basecamp radio').parentElement!.parentElement!,
    );
    expect(basecampContext.getByText('No radio connected')).toBeVisible();
    expect(basecampContext.getByText('1 unread, sample')).toBeVisible();
    await user.click(dialog.getByRole('radio', { name: /^Switch to Meshtastic(?:,|$)/ }));

    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('message-error');
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
      'Keep this draft',
    );
    expect(screen.getByText('Failed')).toBeVisible();
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
    ['meshtastic', 'Meshtastic', 'Trail radio', true],
    ['meshcore', 'MeshCore', 'Basecamp radio', true],
    ['reticulum', 'Reticulum', 'Field RNode', false],
  ] satisfies [MeshProtocol, string, string, boolean][])(
    'previews %s branding and its named sample radio',
    async (protocol, displayName, radioName, hasBatteryTelemetry) => {
      const user = userEvent.setup();
      render(<MobilePrototype initialScene="ready" />);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Protocol' }), protocol);

      expect(
        screen.getByRole('button', { name: `Switch protocol, current ${displayName}` }),
      ).toHaveTextContent(displayName);
      expect(within(screen.getByRole('main')).getByText(radioName)).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Preview radio connection screen' }),
      ).toHaveTextContent(`${radioName}, connected`);
      if (hasBatteryTelemetry) {
        expect(within(screen.getByRole('main')).getByText('84%')).toBeVisible();
      } else {
        expect(within(screen.getByRole('main')).queryByText('84%')).not.toBeInTheDocument();
      }
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
    expect(
      screen.getByText('If your phone asks you to pair, follow the system prompt.'),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Nearby radios' })).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Preview radio connection screen' }),
    ).toHaveTextContent('No radio connected');
  });

  it('keeps the compact chat list accessible while opening a conversation and returning with a draft', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype initialScene="ready" />);
    const nav = within(screen.getByRole('navigation', { name: 'Mobile navigation preview' }));
    const chat = nav.getByRole('button', { name: 'Chat' });
    expect(chat).not.toHaveAttribute('aria-current');
    await user.click(chat);
    expect(
      within(screen.getByRole('complementary', { name: 'Conversation list' })).getByRole(
        'heading',
        {
          level: 1,
          name: 'Chat',
        },
      ),
    ).toHaveFocus();
    expect(chat).toHaveAttribute('aria-current', 'page');
    expect(
      screen.queryByRole('textbox', { name: 'Message draft, preview only' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Preview conversation with Alex' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Alex' })).toHaveFocus();
    expect(chat).toHaveAttribute('aria-current', 'page');
    expect(
      screen.queryByRole('complementary', { name: 'Conversation list' }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: 'Message draft, preview only' }),
      'Back soon',
    );
    await user.click(screen.getByRole('button', { name: 'Back to chats' }));
    expect(
      within(screen.getByRole('complementary', { name: 'Conversation list' })).getByRole(
        'heading',
        {
          level: 1,
          name: 'Chat',
        },
      ),
    ).toHaveFocus();
    expect(
      screen.queryByRole('textbox', { name: 'Message draft, preview only' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview conversation with Alex' }));
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
      'Back soon',
    );
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
      expect(
        within(screen.getByRole('complementary', { name: 'Conversation list' })).getByRole(
          'heading',
          {
            level: 1,
            name: 'Chat',
          },
        ),
      ).toBeVisible();
    }
  });

  it('opens More without leaving the current conversation, then previews connection setup', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype initialScene="chat" />);
    await user.type(
      screen.getByRole('textbox', { name: 'Message draft, preview only' }),
      'Keep my place',
    );
    const more = screen.getByRole('button', { name: 'More' });
    await user.click(more);

    const dialog = screen.getByRole('dialog', { name: 'All panels' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('chat');
    for (const name of ['Network', 'Map', 'Incident']) {
      const button = within(dialog).getByRole('button', { name });
      expect(button).toBeDisabled();
      await user.click(button);
      expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('chat');
    }

    await user.click(within(dialog).getByRole('button', { name: /^Connection/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Connect your radio' })).toHaveFocus();
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Screen' }), 'chat');
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
      'Keep my place',
    );
  });

  it.each(['close button', 'backdrop', 'cancel'] as const)(
    'dismisses More with %s and restores its trigger without changing the draft',
    async (method) => {
      const user = userEvent.setup();
      render(<MobilePrototype initialScene="chat" />);
      const draft = screen.getByRole('textbox', { name: 'Message draft, preview only' });
      await user.type(draft, 'A launcher draft');
      const more = screen.getByRole('button', { name: 'More' });
      await user.click(more);
      const dialog = screen.getByRole('dialog', { name: 'All panels' });

      if (method === 'close button') {
        await user.click(within(dialog).getByRole('button', { name: 'Close' }));
      } else if (method === 'backdrop') {
        fireEvent.pointerDown(dialog);
      } else {
        fireEvent(dialog, new Event('cancel', { cancelable: true }));
      }

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(more).toHaveFocus();
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('chat');
      expect(draft).toHaveValue('A launcher draft');
    },
  );

  it('opens the compact chat list from More and focuses the visible list heading', async () => {
    const user = userEvent.setup();
    render(<MobilePrototype initialScene="ready" />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'All panels' })).getByRole('button', {
        name: 'Chat',
      }),
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('complementary', { name: 'Conversation list' })).getByRole(
        'heading',
        {
          level: 1,
          name: 'Chat',
        },
      ),
    ).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('conversations');
  });

  it('restores active navigation when an open More launcher unfolds onto the wide rail', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MobilePrototype initialDisplay="foldable" initialScene="chat" />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog', { name: 'All panels' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    layout.wide = true;
    rerender(<MobilePrototype initialDisplay="foldable" initialScene="chat" />);
    expect(screen.getByRole('button', { name: 'App' })).toBeDisabled();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Mobile navigation preview' })).getByRole(
        'button',
        {
          name: 'Chat',
        },
      ),
    ).toHaveFocus();
    expect(screen.getByRole('heading', { level: 1, name: 'Alex' })).toBeVisible();
  });

  it('uses the wide protocol rail while keeping drafts and conversations separate', async () => {
    const user = userEvent.setup();
    layout.wide = true;
    render(<MobilePrototype initialDisplay="tablet" initialScene="chat" />);
    await user.type(
      screen.getByRole('textbox', { name: 'Message draft, preview only' }),
      'For Alex',
    );
    const rail = within(screen.getByRole('navigation', { name: 'Mobile navigation preview' }));
    await user.click(rail.getByRole('radio', { name: /^Switch to MeshCore(?:,|$)/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Morgan' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue('');
    expect(rail.getByRole('radio', { name: /^Switch to MeshCore(?:,|$)/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Message draft, preview only' }),
      'For Morgan',
    );
    await user.click(rail.getByRole('radio', { name: /^Switch to Meshtastic(?:,|$)/ }));

    expect(screen.getByRole('heading', { level: 1, name: 'Alex' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Message draft, preview only' })).toHaveValue(
      'For Alex',
    );
    expect(screen.getByLabelText('Sample message history')).not.toHaveTextContent(
      'Basecamp radio is on.',
    );
  });

  it('keeps unfinished wide panels disabled while Device opens connection setup', async () => {
    const user = userEvent.setup();
    layout.wide = true;
    render(<MobilePrototype initialDisplay="tablet" initialScene="chat" />);
    const nav = within(screen.getByRole('navigation', { name: 'Mobile navigation preview' }));
    for (const name of ['App', 'Monitor']) {
      const button = nav.getByRole('button', { name });
      expect(button).toBeDisabled();
      await user.click(button);
      expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('chat');
    }
    expect(nav.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();

    await user.click(nav.getByRole('button', { name: 'Device' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Connect your radio' })).toHaveFocus();
    expect(nav.getByRole('button', { name: 'Device' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('button', { name: 'Chat' })).not.toHaveAttribute('aria-current');
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
      expect(screen.getByText('UI preview')).toBeVisible();

      if (scene === 'message-error') {
        const retry = screen.getByRole('button', { name: 'Retry message, design placeholder' });
        expect(retry).toBeDisabled();
        await user.click(retry);
        expect(history.getByText('Failed')).toBeVisible();
        expect(draft).toHaveValue('Reviewing the composer\n');
      } else {
        expect(history.getAllByText('Delivered')).toHaveLength(2);
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
    ).toHaveTextContent('Basecamp radio, connected');
  });

  it.each(['unknown', '__proto__', 'constructor', 'toString'])(
    'falls back to a usable start screen for unsupported protocol %s',
    (protocolValue) => {
      window.history.replaceState(
        null,
        '',
        `?scene=unknown&platform=unknown&protocol=${protocolValue}&display=unknown`,
      );
      render(<MobilePrototype />);

      expect(screen.getByRole('heading', { level: 1, name: 'Connect your radio' })).toBeVisible();
      expect(screen.getByRole('combobox', { name: 'Screen' })).toHaveValue('connect');
      expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveValue('ios');
      expect(screen.getByRole('combobox', { name: 'Protocol' })).toHaveValue('meshtastic');
      expect(screen.getByRole('combobox', { name: 'Display preview' })).toHaveValue('phone');
    },
  );

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

  it('has no axe violations in the compact More launcher', async () => {
    const user = userEvent.setup();
    const { container } = render(<MobilePrototype initialScene="chat" />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    hydrateAxeThemeColors(container);

    expect(await axe(screen.getByRole('dialog', { name: 'All panels' }))).toHaveNoViolations();
  });
});
