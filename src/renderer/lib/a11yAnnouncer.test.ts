// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  announce,
  APP_ANNOUNCER_ASSERTIVE_ID,
  APP_ANNOUNCER_POLITE_ID,
  createBatchedMessageAnnouncer,
  truncateForAnnouncement,
} from './a11yAnnouncer';

describe('announce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="${APP_ANNOUNCER_ASSERTIVE_ID}"></div><div id="${APP_ANNOUNCER_POLITE_ID}"></div>`;
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('clears then writes the polite region by default', () => {
    const polite = document.getElementById(APP_ANNOUNCER_POLITE_ID)!;
    polite.textContent = 'old';
    announce('hello');
    expect(polite.textContent).toBe('');
    vi.advanceTimersByTime(60);
    expect(polite.textContent).toBe('hello');
    expect(document.getElementById(APP_ANNOUNCER_ASSERTIVE_ID)!.textContent).toBe('');
  });

  it('writes the assertive region when asked', () => {
    announce('urgent', 'assertive');
    vi.advanceTimersByTime(60);
    expect(document.getElementById(APP_ANNOUNCER_ASSERTIVE_ID)!.textContent).toBe('urgent');
  });

  it('keeps only the latest text when called rapidly', () => {
    announce('first');
    announce('second');
    vi.advanceTimersByTime(60);
    expect(document.getElementById(APP_ANNOUNCER_POLITE_ID)!.textContent).toBe('second');
  });

  it('is a no-op when the region is not mounted', () => {
    document.body.innerHTML = '';
    expect(() => {
      announce('x');
    }).not.toThrow();
  });
});

describe('truncateForAnnouncement', () => {
  it('collapses whitespace and caps length', () => {
    expect(truncateForAnnouncement('  a \n b  ')).toBe('a b');
    const long = truncateForAnnouncement('x'.repeat(500));
    expect(long.length).toBe(200);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('createBatchedMessageAnnouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const said: string[] = [];
    const announcer = createBatchedMessageAnnouncer({
      windowMs: 1000,
      formatOne: (m) => `${m.sender}: ${m.text}`,
      formatMany: (n) => `${n} new`,
      announce: (t) => said.push(t),
    });
    return { said, announcer };
  }

  it('announces a single message immediately', () => {
    const { said, announcer } = setup();
    announcer.push([{ sender: 'A', text: 'hi' }]);
    expect(said).toEqual(['A: hi']);
  });

  it('summarizes a burst in one push', () => {
    const { said, announcer } = setup();
    announcer.push([
      { sender: 'A', text: '1' },
      { sender: 'B', text: '2' },
    ]);
    expect(said).toEqual(['2 new']);
  });

  it('batches messages that arrive within the window', () => {
    const { said, announcer } = setup();
    announcer.push([{ sender: 'A', text: '1' }]);
    announcer.push([{ sender: 'B', text: '2' }]);
    announcer.push([{ sender: 'C', text: '3' }]);
    expect(said).toEqual(['A: 1']);
    vi.advanceTimersByTime(1000);
    expect(said).toEqual(['A: 1', '2 new']);
  });

  it('announces a lone follow-up in full after the window', () => {
    const { said, announcer } = setup();
    announcer.push([{ sender: 'A', text: '1' }]);
    announcer.push([{ sender: 'B', text: '2' }]);
    vi.advanceTimersByTime(1000);
    expect(said).toEqual(['A: 1', 'B: 2']);
    vi.advanceTimersByTime(1000);
    announcer.push([{ sender: 'C', text: '3' }]);
    expect(said).toEqual(['A: 1', 'B: 2', 'C: 3']);
  });

  it('drops pending messages on dispose', () => {
    const { said, announcer } = setup();
    announcer.push([{ sender: 'A', text: '1' }]);
    announcer.push([{ sender: 'B', text: '2' }]);
    announcer.dispose();
    vi.advanceTimersByTime(5000);
    expect(said).toEqual(['A: 1']);
  });
});
