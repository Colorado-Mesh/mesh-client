import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { ChatComposer } from '../ChatComposer';
import { computeVisibleMacroCount } from './ChatMacroBar';

function ShortcutHost() {
  useChatMacroShortcuts();
  return null;
}

function renderComposer(onSendChunk = vi.fn().mockResolvedValue(undefined)) {
  const utils = render(
    <>
      <ShortcutHost />
      <ChatComposer
        protocol="reticulum"
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
    expect(computeVisibleMacroCount(400, 'large', 16)).toBe(6);
    const mid = computeVisibleMacroCount(1100, 'large', 16);
    expect(mid).toBeGreaterThan(6);
    expect(mid).toBeLessThan(12);
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
