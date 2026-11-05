// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installKeyboardOwnerGuard, KEYBOARD_OWNER_ATTRIBUTE } from './keyboardOwnerLayer';

function press(key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

function button(label: string, parent: HTMLElement): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = label;
  parent.appendChild(element);
  return element;
}

describe('installKeyboardOwnerGuard', () => {
  let uninstall: () => void;
  const modalTrap = vi.fn();
  const documentListener = vi.fn();
  let modalInput: HTMLButtonElement;

  beforeEach(() => {
    document.body.replaceChildren();
    uninstall = installKeyboardOwnerGuard(window);
    // Registered after the guard, like every modal trap mounted by React.
    window.addEventListener('keydown', modalTrap, true);
    document.addEventListener('keydown', documentListener);
    const modal = document.createElement('div');
    document.body.appendChild(modal);
    modalInput = button('Save', modal);
    modalInput.focus();
  });

  afterEach(() => {
    uninstall();
    window.removeEventListener('keydown', modalTrap, true);
    document.removeEventListener('keydown', documentListener);
    modalTrap.mockReset();
    documentListener.mockReset();
  });

  function addOwner(): { answer: HTMLButtonElement; reject: HTMLButtonElement } {
    const owner = document.createElement('div');
    owner.setAttribute(KEYBOARD_OWNER_ATTRIBUTE, '');
    document.body.appendChild(owner);
    return { answer: button('Answer', owner), reject: button('Reject', owner) };
  }

  it('leaves Tab and Escape to the page when no owner is open', () => {
    const tab = press('Tab');
    const escape = press('Escape');

    expect(tab.defaultPrevented).toBe(false);
    expect(escape.defaultPrevented).toBe(false);
    expect(modalTrap).toHaveBeenCalledTimes(2);
    expect(documentListener).toHaveBeenCalledTimes(2);
  });

  it('moves Tab from a modal under the owner into the owner and keeps the modal trap out', () => {
    const { answer, reject } = addOwner();

    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(answer);
    press('Tab');
    expect(document.activeElement).toBe(reject);
    press('Tab');
    expect(document.activeElement).toBe(answer);
    expect(modalTrap).not.toHaveBeenCalled();
    expect(documentListener).not.toHaveBeenCalled();
  });

  it('cycles backwards on Shift+Tab, entering at the last control', () => {
    const { answer, reject } = addOwner();

    press('Tab', true);
    expect(document.activeElement).toBe(reject);
    press('Tab', true);
    expect(document.activeElement).toBe(answer);
    press('Tab', true);
    expect(document.activeElement).toBe(reject);
  });

  it('swallows Escape so the modal under the owner stays open', () => {
    addOwner();

    const escape = press('Escape');

    expect(escape.defaultPrevented).toBe(true);
    expect(modalTrap).not.toHaveBeenCalled();
    expect(documentListener).not.toHaveBeenCalled();
  });

  it('lets Enter and other keys through to the focused control', () => {
    const { answer } = addOwner();
    answer.focus();

    const enter = press('Enter');

    expect(enter.defaultPrevented).toBe(false);
    expect(modalTrap).toHaveBeenCalledTimes(1);
  });

  it('skips disabled controls', () => {
    const { answer, reject } = addOwner();
    answer.disabled = true;

    press('Tab');
    expect(document.activeElement).toBe(reject);
    press('Tab');
    expect(document.activeElement).toBe(reject);
  });

  it('focuses the owner itself when it has no controls', () => {
    const owner = document.createElement('div');
    owner.setAttribute(KEYBOARD_OWNER_ATTRIBUTE, '');
    owner.tabIndex = -1;
    document.body.appendChild(owner);

    press('Tab');

    expect(document.activeElement).toBe(owner);
  });

  it('puts focus back in the owner when a modal under it refocuses itself', () => {
    const { answer } = addOwner();
    answer.focus();

    modalInput.focus();

    expect(document.activeElement).toBe(answer);
  });

  it('enters at the owner panel when nothing inside it had focus yet', () => {
    const owner = document.createElement('div');
    owner.setAttribute(KEYBOARD_OWNER_ATTRIBUTE, '');
    const panel = document.createElement('div');
    panel.tabIndex = -1;
    owner.appendChild(panel);
    button('Answer', panel);
    document.body.appendChild(owner);
    const elsewhere = button('Other', document.body);

    elsewhere.focus();

    expect(document.activeElement).toBe(panel);
  });

  it('leaves focus moves alone when no owner is open', () => {
    const elsewhere = button('Other', document.body);

    elsewhere.focus();

    expect(document.activeElement).toBe(elsewhere);
  });

  it('stops acting once uninstalled', () => {
    addOwner();
    uninstall();

    const tab = press('Tab');
    const elsewhere = button('Other', document.body);
    elsewhere.focus();

    expect(tab.defaultPrevented).toBe(false);
    expect(modalTrap).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(elsewhere);
  });
});
