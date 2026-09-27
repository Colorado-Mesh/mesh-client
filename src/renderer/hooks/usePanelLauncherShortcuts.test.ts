import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePanelLauncherShortcuts } from './usePanelLauncherShortcuts';

function press(key: string, code: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: true }));
}

function openModal(attrs: Record<string, string> = {}) {
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  document.body.appendChild(el);
  return el;
}

describe('usePanelLauncherShortcuts', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function setup() {
    const onToggleLauncher = vi.fn();
    const onPinnedShortcut = vi.fn();
    renderHook(() => {
      usePanelLauncherShortcuts({ platform: 'linux', onToggleLauncher, onPinnedShortcut });
    });
    return { onToggleLauncher, onPinnedShortcut };
  }

  it('toggles the launcher and opens pins from the keyboard', () => {
    const { onToggleLauncher, onPinnedShortcut } = setup();
    press('k', 'KeyK');
    press('2', 'Digit2');
    expect(onToggleLauncher).toHaveBeenCalledTimes(1);
    expect(onPinnedShortcut).toHaveBeenCalledWith(1);
  });

  it('stays out of the way while another modal dialog is open', () => {
    const { onToggleLauncher, onPinnedShortcut } = setup();
    openModal();
    press('k', 'KeyK');
    press('1', 'Digit1');
    expect(onToggleLauncher).not.toHaveBeenCalled();
    expect(onPinnedShortcut).not.toHaveBeenCalled();
  });

  it('still closes the launcher from its own dialog', () => {
    const { onToggleLauncher } = setup();
    openModal({ 'data-panel-launcher': '' });
    press('k', 'KeyK');
    expect(onToggleLauncher).toHaveBeenCalledTimes(1);
  });
});
