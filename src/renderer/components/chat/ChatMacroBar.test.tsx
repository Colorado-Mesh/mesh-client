import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { useChatMacroShortcuts } from '@/renderer/hooks/useChatMacroShortcuts';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { resetMacroComposerRegistryForTests } from '@/renderer/lib/chatMacroKeys';
import { resetMeshcoreSendRateForTests } from '@/renderer/lib/meshcoreSendRateNotice';
import {
  resetChatMacrosStoreForTests,
  useChatMacrosStore,
} from '@/renderer/stores/chatMacrosStore';
import {
  CHAT_MACRO_LABEL_MAX,
  CHAT_MACRO_SLOT_COUNT,
  type ChatMacroSize,
} from '@/renderer/stores/chatMacrosStore';

import { ChatComposer } from '../ChatComposer';
import { computeVisibleMacroCount, CONTROL_WIDTH_REM, MIN_BUTTON_WIDTH_REM } from './ChatMacroBar';

/** One realistic macro per key, including a max-length label. */
const FULL_MACROS = [
  { label: 'GM All', text: 'Good morning all!' },
  { label: 'AFK', text: 'Away from keyboard, back soon.' },
  { label: 'Dog Park', text: 'Heading to the dog park.' },
  { label: 'MC Web', text: 'MeshCore web: https://example.org/meshcore' },
  { label: 'Net check-in', text: 'Checking in for the net.' },
  { label: 'Weather', text: 'Clear skies, 72F, wind 5 mph.' },
  { label: 'QSL', text: 'QSL, thanks for the contact.' },
  { label: 'TennMesh', text: 'Join #tennmesh for local chat.' },
  { label: 'TennMesh Chat', text: 'TennMesh chat is on #tenn-chat.' },
  { label: 'Visit NETN', text: 'Visit the NETN site for maps.' },
  { label: 'Food', text: 'Grabbing food, back in 30.' },
  { label: 'Emergency traffic only!!', text: 'Emergency traffic only on this channel.' },
] as const;

const SIZES: ChatMacroSize[] = ['small', 'medium', 'large'];
const MACRO_NAME = /^F\d{1,2}: /;

function seedAllMacros() {
  const s = useChatMacrosStore.getState();
  FULL_MACROS.forEach((macro, i) => {
    s.setSlotLabel(i, macro.label);
    s.setSlotText(i, macro.text);
  });
}

function expectedMacroNames(indices: number[]): string[] {
  return indices.map((i) => `F${i + 1}: ${FULL_MACROS[i].label}`);
}

function toolbarMacroButtons(): HTMLElement[] {
  return within(screen.getByRole('toolbar', { name: 'Message macros' }))
    .getAllByRole('button')
    .filter((b) => MACRO_NAME.test(b.getAttribute('aria-label') ?? ''));
}

/** jsdom has no layout; report a fixed toolbar width so overflow logic runs. */
function stubToolbarWidth(px: number) {
  class FixedWidthResizeObserver implements ResizeObserver {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe() {
      this.cb([{ contentRect: { width: px } } as ResizeObserverEntry], this);
    }
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  globalThis.ResizeObserver = FixedWidthResizeObserver;
}

const originalResizeObserver = globalThis.ResizeObserver;

function ShortcutHost() {
  useChatMacroShortcuts();
  return null;
}

function renderComposer(onSendChunk = vi.fn().mockResolvedValue(undefined)) {
  const utils = render(
    <>
      <ShortcutHost />
      <ChatComposer
        protocol="meshtastic"
        viewKey="dm:abc"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
      />
    </>,
  );
  return { ...utils, onSendChunk };
}

function seedMacros() {
  const s = useChatMacrosStore.getState();
  s.setSlotLabel(0, 'Roger');
  s.setSlotText(0, 'Roger, copy that.');
  s.setSlotLabel(1, 'On my way');
  s.setSlotText(1, 'On my way, ETA 15 min');
}

describe('ChatMacroBar', () => {
  beforeEach(() => {
    localStorage.clear();
    resetChatMacrosStoreForTests();
    resetMacroComposerRegistryForTests();
    resetMeshcoreSendRateForTests();
    // jsdom has no layout, so treat the composer textarea as on screen.
    Element.prototype.checkVisibility = () => true;
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'checkVisibility');
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('is collapsed by default: only "Show macros" shows, and F-keys still insert', () => {
    seedMacros();
    renderComposer();
    expect(screen.getByRole('button', { name: 'Show macros' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Message macros' })).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', cancelable: true }));
    });
    expect(screen.getByRole('textbox')).toHaveValue('On my way, ETA 15 min');
  });

  it('expands, inserts on click without sending, highlights the last used, and collapses', () => {
    seedMacros();
    const { onSendChunk } = renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Show macros' }));
    expect(useChatMacrosStore.getState().collapsed).toBe(false);

    const roger = screen.getByRole('button', { name: 'F1: Roger' });
    fireEvent.click(roger);
    expect(screen.getByRole('textbox')).toHaveValue('Roger, copy that.');
    expect(onSendChunk).not.toHaveBeenCalled();
    expect(roger.className).toContain('bg-brand-green');

    fireEvent.click(screen.getByRole('button', { name: 'F2: On my way' }));
    expect(screen.getByRole('textbox')).toHaveValue('Roger, copy that. On my way, ETA 15 min');

    fireEvent.click(screen.getByRole('button', { name: 'Hide macros' }));
    expect(useChatMacrosStore.getState().collapsed).toBe(true);
    expect(screen.getByRole('button', { name: 'Show macros' })).toBeInTheDocument();
  });

  it('sends immediately in Send now mode when the box is empty', async () => {
    seedMacros();
    useChatMacrosStore.getState().setSendMode('sendNow');
    useChatMacrosStore.getState().setCollapsed(false);
    const { onSendChunk } = renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'F1: Roger' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(1);
    });
    expect(onSendChunk.mock.calls[0][0]).toBe('Roger, copy that.');
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('');
    });
  });

  it('keeps the macro in the box when Send now is refused by the MeshCore byte limit', async () => {
    useChatMacrosStore.getState().setSlotText(0, 'é'.repeat(120));
    useChatMacrosStore.getState().setSendMode('sendNow');
    useChatMacrosStore.getState().setCollapsed(false);
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^F1:/ }));
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('é'.repeat(120));
    });
    expect(onSendChunk).not.toHaveBeenCalled();
  });

  it('falls back to inserting in Send now mode when a draft is already typed', () => {
    seedMacros();
    useChatMacrosStore.getState().setSendMode('sendNow');
    useChatMacrosStore.getState().setCollapsed(false);
    const { onSendChunk } = renderComposer();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'F1: Roger' }));
    expect(screen.getByRole('textbox')).toHaveValue('Hi Roger, copy that.');
    expect(onSendChunk).not.toHaveBeenCalled();
  });

  it('opens the editor on the empty slot that was clicked', () => {
    useChatMacrosStore.getState().setCollapsed(false);
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'F3: add a macro' }));
    expect(screen.getByRole('dialog', { name: 'Edit macros' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'F3 button label' })).toHaveFocus();
  });

  it('puts overflow macros in a More menu on narrow widths', () => {
    expect(computeVisibleMacroCount(0, 'large', 16)).toBe(12);
    expect(computeVisibleMacroCount(2000, 'large', 16)).toBe(12);
    expect(computeVisibleMacroCount(500, 'large', 16)).toBe(6);
    expect(computeVisibleMacroCount(300, 'large', 16)).toBe(3);
    expect(computeVisibleMacroCount(100, 'large', 16)).toBe(0);
    const mid = computeVisibleMacroCount(1100, 'large', 16);
    expect(mid).toBeGreaterThan(6);
    expect(mid).toBeLessThan(12);
  });

  it('keeps all twelve Small macros visible while they fit at their narrowest', () => {
    expect(computeVisibleMacroCount(800, 'small', 16)).toBe(12);
    expect(computeVisibleMacroCount(600, 'small', 16)).toBe(12);
    expect(computeVisibleMacroCount(800, 'large', 16)).toBeLessThan(12);
    const tight = computeVisibleMacroCount(400, 'small', 16);
    expect(tight).toBeGreaterThan(0);
    expect(tight).toBeLessThan(12);
  });

  it('gives the inline Small toolbar the leftover width instead of splitting it with the hint', () => {
    renderComposer();
    const hintWrap = () => screen.getByText(/Enter to send/).parentElement;
    expect(hintWrap()?.className).toContain('flex-1');

    act(() => {
      useChatMacrosStore.getState().setSize('small');
      useChatMacrosStore.getState().setCollapsed(false);
    });
    expect(screen.getByRole('toolbar', { name: 'Message macros' }).className).toContain('flex-1');
    expect(hintWrap()?.className).not.toContain('flex-1');

    act(() => {
      useChatMacrosStore.getState().setSize('large');
    });
    expect(hintWrap()?.className).toContain('flex-1');
  });

  describe('with all twelve macros filled', () => {
    beforeEach(() => {
      seedAllMacros();
      useChatMacrosStore.getState().setCollapsed(false);
    });

    it('fixture covers every key and the label length limit', () => {
      expect(FULL_MACROS).toHaveLength(CHAT_MACRO_SLOT_COUNT);
      expect(Math.max(...FULL_MACROS.map((m) => m.label.length))).toBe(CHAT_MACRO_LABEL_MAX);
      const stored = useChatMacrosStore.getState().slots;
      expect(stored.map((s) => s.label)).toEqual(FULL_MACROS.map((m) => m.label));
    });

    it.each(SIZES)(
      '%s: shows F1–F12 in order with identical styling and readable labels',
      (size) => {
        useChatMacrosStore.getState().setSize(size);
        renderComposer();
        const buttons = toolbarMacroButtons();
        const all = Array.from({ length: CHAT_MACRO_SLOT_COUNT }, (_, i) => i);
        expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(expectedMacroNames(all));
        expect(screen.queryByRole('button', { name: 'More macros' })).toBeNull();

        // Every key looks the same: one shared class list, nothing highlighted yet.
        expect(new Set(buttons.map((b) => b.className)).size).toBe(1);
        expect(buttons[0].className).not.toContain('bg-brand-green');

        buttons.forEach((button, i) => {
          const [badge, label] = Array.from(button.children);
          expect(badge).toHaveTextContent(`F${i + 1}`);
          expect(badge).toHaveAttribute('aria-hidden');
          expect(badge.className).toContain('shrink-0');
          // The full label stays in the DOM and only truncates visually, never wraps.
          expect(label).toHaveTextContent(FULL_MACROS[i].label);
          expect(label.className).toContain('truncate');
          expect(label.className).toContain('min-w-0');
        });
      },
    );

    it('every F-key shortcut inserts its own macro', () => {
      renderComposer();
      const box = screen.getByRole('textbox');
      FULL_MACROS.forEach((macro, i) => {
        fireEvent.change(box, { target: { value: '' } });
        act(() => {
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: `F${i + 1}`, cancelable: true }),
          );
        });
        expect(box).toHaveValue(macro.text);
        expect(useChatMacrosStore.getState().lastUsedIndex).toBe(i);
      });
    });

    it('every button inserts its own macro and moves the highlight to it', () => {
      renderComposer();
      const box = screen.getByRole('textbox');
      FULL_MACROS.forEach((macro, i) => {
        fireEvent.change(box, { target: { value: '' } });
        fireEvent.click(toolbarMacroButtons()[i]);
        expect(box).toHaveValue(macro.text);
        const highlighted = toolbarMacroButtons().filter((b) =>
          b.className.includes('bg-brand-green'),
        );
        expect(highlighted.map((b) => b.getAttribute('aria-label'))).toEqual(
          expectedMacroNames([i]),
        );
      });
    });

    it.each(SIZES)(
      '%s: a narrow toolbar keeps every key reachable, in order, via More',
      async (size) => {
        stubToolbarWidth(420);
        useChatMacrosStore.getState().setSize(size);
        const { container } = renderComposer();
        const shown = toolbarMacroButtons();
        expect(shown.length).toBeGreaterThan(0);
        expect(shown.length).toBeLessThan(CHAT_MACRO_SLOT_COUNT);

        fireEvent.click(screen.getByRole('button', { name: 'More macros' }));
        const menuItems = within(screen.getByRole('menu', { name: 'More macros' })).getAllByRole(
          'menuitem',
        );
        const all = Array.from({ length: CHAT_MACRO_SLOT_COUNT }, (_, i) => i);
        expect([...shown, ...menuItems].map((el) => el.getAttribute('aria-label'))).toEqual(
          expectedMacroNames(all),
        );
        menuItems.forEach((item) => {
          const index = Number(/^F(\d+)/.exec(item.getAttribute('aria-label') ?? '')?.[1]) - 1;
          expect(item).toHaveTextContent(`F${index + 1}${FULL_MACROS[index].label}`);
        });

        hydrateAxeThemeColors(container);
        expect(await axe(container)).toHaveNoViolations();
      },
    );

    it.each(SIZES)('%s: has no axe violations with every key filled', async (size) => {
      useChatMacrosStore.getState().setSize(size);
      const { container } = renderComposer();
      fireEvent.click(toolbarMacroButtons()[CHAT_MACRO_SLOT_COUNT - 1]);
      hydrateAxeThemeColors(container);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('visible count never overflows and never shrinks as the toolbar widens', () => {
    it.each(SIZES.flatMap((size) => [16, 20].map((remPx) => [size, remPx] as const)))(
      '%s at %ipx rem',
      (size, remPx) => {
        let previous = 0;
        for (let width = 1; width <= 2400; width += 4) {
          const count = computeVisibleMacroCount(width, size, remPx);
          expect(count).toBeGreaterThanOrEqual(previous);
          previous = count;
          if (count === 0) continue;
          const controls = count === CHAT_MACRO_SLOT_COUNT ? 2 : 3;
          const narrowest =
            count * MIN_BUTTON_WIDTH_REM * remPx + controls * CONTROL_WIDTH_REM[size] * remPx;
          expect(narrowest).toBeLessThanOrEqual(width);
        }
        expect(previous).toBe(CHAT_MACRO_SLOT_COUNT);
      },
    );
  });

  it('has no axe violations collapsed and expanded with a highlighted macro', async () => {
    seedMacros();
    const { container } = renderComposer();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();

    act(() => {
      useChatMacrosStore.getState().setSize('large');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show macros' }));
    fireEvent.click(screen.getByRole('button', { name: 'F1: Roger' }));
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
