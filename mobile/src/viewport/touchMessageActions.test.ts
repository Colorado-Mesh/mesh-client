import { afterEach, describe, expect, it } from 'vitest';

import {
  ACTIONS_OPEN_ATTR,
  applyMessageTap,
  installTouchMessageActions,
  messageRowFor,
} from './touchMessageActions';

/** A chat row as ChatPanel renders it: bubble (text, sender button) and its hover-only bar. */
function chatRow(id: string): string {
  return `<div id="${id}" class="group/msg flex max-w-[94%] flex-row-reverse">
    <div class="bubble"><button class="sender">bea7</button><span class="text">hello ${id}</span></div>
    <div class="message-actions-bar flex opacity-0 group-focus-within/msg:opacity-100">
      <button aria-label="Copy message">c</button>
    </div>
  </div>`;
}

/** An RRC line: a `group` row whose actions are each hover-only. */
const rrcLine = `<div id="rrc" class="group flex">
  <span class="body">rrc line</span>
  <span class="flex"><button class="opacity-0 group-hover:opacity-100" aria-label="Copy">c</button></span>
</div>`;

const $ = (sel: string) => document.querySelector(sel)!;
const isOpen = (id: string) => $(`#${id}`).hasAttribute(ACTIONS_OPEN_ATTR);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('touch message actions', () => {
  it('finds the message row from its text, its bubble and its actions', () => {
    document.body.innerHTML = chatRow('a') + rrcLine;
    expect(messageRowFor($('#a .text'))).toBe($('#a'));
    expect(messageRowFor($('#a [aria-label="Copy message"]'))).toBe($('#a'));
    expect(messageRowFor($('#rrc .body'))).toBe($('#rrc'));
  });

  it('a tap on a message opens its actions; a second tap closes them', () => {
    document.body.innerHTML = chatRow('a');
    applyMessageTap(document, $('#a .text'), '');
    expect(isOpen('a')).toBe(true);
    applyMessageTap(document, $('#a .text'), '');
    expect(isOpen('a')).toBe(false);
  });

  it('opening one message closes the other; a tap outside closes it', () => {
    document.body.innerHTML = `${chatRow('a')}${chatRow('b')}<p id="outside">x</p>`;
    applyMessageTap(document, $('#a .text'), '');
    applyMessageTap(document, $('#b .text'), '');
    expect([isOpen('a'), isOpen('b')]).toEqual([false, true]);
    applyMessageTap(document, $('#outside'), '');
    expect(isOpen('b')).toBe(false);
  });

  it('pressing a control keeps its own row as it is and does not open a row', () => {
    document.body.innerHTML = chatRow('a') + chatRow('b');
    applyMessageTap(document, $('#a .text'), '');
    applyMessageTap(document, $('#a [aria-label="Copy message"]'), '');
    expect(isOpen('a')).toBe(true);
    applyMessageTap(document, $('#b .sender'), '');
    expect([isOpen('a'), isOpen('b')]).toEqual([false, false]);
  });

  it('a tap while text is selected does not open the actions', () => {
    document.body.innerHTML = chatRow('a');
    applyMessageTap(document, $('#a .text'), 'hello');
    expect(isOpen('a')).toBe(false);
  });

  it('rows without hover-only actions ("Always show message actions") are never opened', () => {
    document.body.innerHTML = chatRow('a').replace('opacity-0 ', 'opacity-100 ');
    applyMessageTap(document, $('#a .text'), '');
    expect(isOpen('a')).toBe(false);
  });

  it('listens to taps only on a touch screen', () => {
    document.body.innerHTML = chatRow('a');
    let touch = false;
    const remove = installTouchMessageActions(document, () => touch);
    ($('#a .text') as HTMLElement).click();
    expect(isOpen('a')).toBe(false);
    touch = true;
    ($('#a .text') as HTMLElement).click();
    expect(isOpen('a')).toBe(true);
    remove();
    ($('#a .text') as HTMLElement).click();
    expect(isOpen('a')).toBe(true);
  });
});
