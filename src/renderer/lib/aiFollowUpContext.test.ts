import { describe, expect, it } from 'vitest';

import {
  extractQuotedSummaryFocus,
  isFollowUpPasteMatch,
  retainFollowUpMessages,
  selectFollowUpContext,
  selectRelevantMessages,
} from './aiFollowUpContext';

const messages = [
  { at: 1, sender: 'Alice', body: 'Weather looks fine today.' },
  { at: 2, sender: 'Bob', body: 'Agreed, no storms.' },
  { at: 3, sender: 'Trashcan13', body: 'We could add a second repeater on the north ridge.' },
  { at: 4, sender: 'Carol', body: 'Lunch plans?' },
  { at: 5, sender: 'Dave', body: 'Checking in.' },
  { at: 6, sender: 'Eve', body: 'Still here.' },
  { at: 7, sender: 'Frank', body: 'Ack.' },
  { at: 8, sender: 'Grace', body: 'Ping.' },
  { at: 9, sender: 'Heidi', body: 'Pong.' },
  { at: 10, sender: 'Ivan', body: 'Copy.' },
];

describe('retainFollowUpMessages', () => {
  it('returns all messages under the body-char cap', () => {
    const retained = retainFollowUpMessages(messages, 10_000);
    expect(retained.clipped).toBe(false);
    expect(retained.messages).toEqual(messages);
  });

  it('keeps the newest window when over the body-char cap', () => {
    const long = Array.from({ length: 20 }, (_, index) => ({
      at: index + 1,
      sender: `N${index}`,
      body: 'x'.repeat(100),
    }));
    const retained = retainFollowUpMessages(long, 350);
    expect(retained.clipped).toBe(true);
    expect(retained.messages.length).toBeGreaterThan(0);
    expect(retained.messages.at(-1)?.at).toBe(20);
    expect(
      retained.messages.reduce((sum, message) => sum + message.body.length, 0),
    ).toBeLessThanOrEqual(350 + 100);
    expect(retained.messages[0]?.at).toBeGreaterThan(1);
  });
});

describe('selectFollowUpContext', () => {
  it('prefers retained messages over digests', () => {
    const selected = selectFollowUpContext(
      'how?',
      'summary',
      { messages, digests: ['Dense digest one', 'Dense digest two'], limited: false },
      'remote',
    );
    expect(selected.contextKind).toBe('transcript');
    expect(selected.messages).toEqual(messages);
  });

  it('falls back to digests when no messages were retained', () => {
    const selected = selectFollowUpContext(
      'how?',
      'summary',
      { digests: ['Dense digest one', 'Dense digest two'], limited: true },
      'remote',
    );
    expect(selected.contextKind).toBe('digests');
    expect(selected.messages).toHaveLength(2);
    expect(selected.messages[0]?.body).toBe('Dense digest one');
  });

  it('returns the full transcript for endpoint engines', () => {
    const selected = selectFollowUpContext(
      'how?',
      'Trashcan13 suggested expanding the mesh.',
      { messages, limited: false },
      'remote',
    );
    expect(selected.contextKind).toBe('transcript');
    expect(selected.messages).toEqual(messages);
  });

  it('returns limited none when no context was retained', () => {
    expect(selectFollowUpContext('how?', 'summary', undefined, 'os')).toEqual({
      messages: [],
      contextKind: 'none',
      limited: true,
    });
  });
});

const multiTopicSummary = `**Conversations**

* Half Live Elecrow asked what M3SHGHØST 03 said, after mentioning that there are no laws with "claws" in the mesh.
* M3SHGHØST 03 replied with a statement about handling brown liquor due to brandy dependence.

**One-offs**

* A user mentioned nodes flooding the mesh with location traffic to "map".
* Another user expressed difficulty in handling brown liquor due to brandy dependence.
* Users discussed byte hash modes and rye whiskey, old-fashioned cocktails.`;

const mapBullet = 'A user mentioned nodes flooding the mesh with location traffic to "map".';

describe('extractQuotedSummaryFocus', () => {
  it('returns the One-offs bullet quoted in the question', () => {
    const focus = extractQuotedSummaryFocus(`expand on "* ${mapBullet}"`, multiTopicSummary);
    expect(focus).toBe(mapBullet);
  });

  it('returns null when the question does not point at a summary slice', () => {
    expect(extractQuotedSummaryFocus('how?', multiTopicSummary)).toBeNull();
  });
});

describe('selectRelevantMessages', () => {
  it('uses summary tokens so how? can still find the subject', () => {
    const selected = selectRelevantMessages(
      'how?',
      'Trashcan13 suggested expanding the mesh to accommodate more users.',
      messages,
      4,
    );
    expect(selected.some((message) => message.sender === 'Trashcan13')).toBe(true);
    expect(selected.at(-1)?.at).toBe(10);
  });

  it('dedupes and sorts chronologically while keeping newest messages', () => {
    const selected = selectRelevantMessages('repeater ridge', 'north ridge repeater', messages, 3);
    const ats = selected.map((message) => message.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(new Set(ats).size).toBe(ats.length);
    expect(selected.some((message) => message.at === 10)).toBe(true);
  });

  it('force-includes an exact pasted channel body among distractors', () => {
    const body = 'We could add a second repeater on the north ridge.';
    const selected = selectRelevantMessages(body, 'unrelated summary about weather', messages, 3);
    expect(selected.some((message) => message.body === body)).toBe(true);
    expect(isFollowUpPasteMatch(body, body)).toBe(true);
  });

  it('force-includes the quoted map one-off without mid-list brandy distractors', () => {
    const topicMessages = [
      {
        at: 1,
        sender: 'MapWatcher',
        body: 'Nodes keep flooding the mesh with location traffic just to map.',
      },
      {
        at: 2,
        sender: 'Half Live Elecrow',
        body: 'There are no laws with claws in the mesh.',
      },
      {
        at: 3,
        sender: 'M3SHGHØST 03',
        body: 'I have difficulty handling brown liquor due to brandy dependence.',
      },
      {
        at: 4,
        sender: 'BarTalk',
        body: 'Byte hash modes and rye whiskey make a fine old-fashioned.',
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        at: 10 + index,
        sender: `N${index}`,
        body: `Recent ack filler ${index}.`,
      })),
    ];
    const selected = selectRelevantMessages(
      `expand on "* ${mapBullet}"`,
      multiTopicSummary,
      topicMessages,
      1,
    );
    expect(selected.some((message) => message.sender === 'MapWatcher')).toBe(true);
    expect(selected.some((message) => /brandy/i.test(message.body))).toBe(false);
    expect(selected.some((message) => message.sender === 'Half Live Elecrow')).toBe(false);
  });
});
