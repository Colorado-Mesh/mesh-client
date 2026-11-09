// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { ChatMessageRouteView } from '../lib/chatMessageRouteView';
import {
  markMeshcoreHopCorrected,
  resetMeshcoreHopCorrectedMarksForTests,
} from '../lib/meshcoreLateRfHopEnrichment';
import type { ChatMessage } from '../lib/types';
import { mockConsoleWarn } from '../lib/vitestConsoleMock';
import {
  ChatRfHopLabel,
  chatRfHopLabelPresentation,
  type ChatRfHopLabelProps,
} from './ChatRfHopLabel';

/** Production Tailwind gray-400 / amber-400 on chat ink-800 for axe contrast. */
const HOP_LABEL_BG_SLATE_800 = '#212d40';
const HOP_LABEL_GRAY_400 = '#9ca3af';
const HOP_LABEL_AMBER_400 = '#fbbf24';

/** jsdom has no Tailwind CSS — set chat-like slate + label colors for axe contrast. */
function prepareHopLabelForAxe(container: HTMLElement, label: HTMLElement, color: string): void {
  container.style.backgroundColor = HOP_LABEL_BG_SLATE_800;
  label.style.color = color;
  hydrateAxeThemeColors(container);
}

function message(storeId: string): ChatMessage {
  return {
    storeId,
    sender_id: 2,
    sender_name: 'AlexT1000',
    payload: 'hello',
    timestamp: Date.now(),
    channel: 0,
  };
}

const route: ChatMessageRouteView = {
  kind: 'floodPath',
  hops: [
    { hash: 'F8F9', name: 'Pikes Peak', matchCount: 1 },
    { hash: 'D4D4', name: null, matchCount: 0 },
  ],
};

function renderLabel(overrides: Partial<ChatRfHopLabelProps> = {}) {
  const describeRoute = vi.fn<(msg: ChatMessage) => ChatMessageRouteView | undefined>(() => route);
  const utils = render(
    <ChatRfHopLabel
      rxHops={2}
      msg={message('ch:0:1:x')}
      senderName="AlexT1000"
      routeDetail="floodPath"
      describeRoute={describeRoute}
      {...overrides}
    />,
  );
  const hops = overrides.rxHops ?? 2;
  const pill = screen.getByRole('button', { name: `${hops} hops, route details` });
  return { ...utils, pill, describeRoute };
}

const ROUTE_TEXT = [
  'Reached you in 2 hops',
  'From AlexT1000',
  '1. Pikes Peak (F8F9)',
  '2. D4D4, unknown repeater',
  'To you',
].join('\n');

describe('chatRfHopLabelPresentation', () => {
  it('uses amber accent only when corrected and motion is allowed', () => {
    expect(chatRfHopLabelPresentation(false, false).className).toContain('text-ink-400');
    expect(chatRfHopLabelPresentation(true, false).className).toContain('text-orange-400');
    expect(chatRfHopLabelPresentation(true, true).className).toContain('text-ink-400');
    expect(chatRfHopLabelPresentation(true, true).refined).toBe(true);
    expect(chatRfHopLabelPresentation(false, false).refined).toBe(false);
  });
});

describe('ChatRfHopLabel', () => {
  afterEach(() => {
    cleanup();
    resetMeshcoreHopCorrectedMarksForTests();
  });

  it('renders the hop count as a labelled control and looks up nothing until opened', async () => {
    const { container, pill, describeRoute } = renderLabel();
    expect(pill).toHaveTextContent('2 hops');
    expect(pill).not.toHaveAttribute('title');
    expect(pill).toHaveAttribute('data-instant-tooltip-managed');
    expect(pill.className).toContain('text-ink-400');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(describeRoute).not.toHaveBeenCalled();
    prepareHopLabelForAxe(container, pill, HOP_LABEL_GRAY_400);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the route on hover and hides it when the pointer leaves', () => {
    const { pill, describeRoute } = renderLabel();
    fireEvent.mouseEnter(pill);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe(ROUTE_TEXT);
    expect(describeRoute).toHaveBeenCalledTimes(1);
    expect(describeRoute.mock.calls[0][0].storeId).toBe('ch:0:1:x');
    expect(pill).toHaveAttribute('aria-describedby', tooltip.id);
    fireEvent.mouseLeave(pill);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(pill).not.toHaveAttribute('aria-describedby');
  });

  it('shows the route on keyboard focus, hides on Escape and on blur', async () => {
    const user = userEvent.setup();
    const { pill } = renderLabel();
    await user.tab();
    expect(pill).toHaveFocus();
    expect(screen.getByRole('tooltip').textContent).toBe(ROUTE_TEXT);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(pill).toHaveFocus();
    fireEvent.click(pill);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps one bubble open when the pointer and keyboard focus are on different pills', () => {
    const { container } = render(
      <>
        <ChatRfHopLabel
          rxHops={2}
          msg={message('ch:0:a:x')}
          senderName="Alpha"
          routeDetail="none"
        />
        <ChatRfHopLabel
          rxHops={3}
          msg={message('ch:0:b:x')}
          senderName="Bravo"
          routeDetail="none"
        />
      </>,
    );
    const [first, second] = Array.from(container.querySelectorAll('button'));
    fireEvent.mouseEnter(first);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    fireEvent.focus(second);
    const open = screen.getAllByRole('tooltip');
    expect(open).toHaveLength(1);
    expect(open[0].textContent).toContain('Reached you in 3 hops');
    expect(first).not.toHaveAttribute('aria-describedby');
    // Leaving the first pill afterwards must not close the second pill's bubble.
    fireEvent.mouseLeave(first);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
  });

  it('hides the bubble when the chat scrolls under it', () => {
    const { pill } = renderLabel();
    fireEvent.mouseEnter(pill);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('still explains the hop count when the route lookup throws', () => {
    const { spy, restore } = mockConsoleWarn();
    try {
      const { pill } = renderLabel({
        describeRoute: () => {
          throw new Error('capture buffer gone');
        },
      });
      fireEvent.mouseEnter(pill);
      expect(screen.getByRole('tooltip').textContent).toBe(
        'Reached you in 2 hops\nRoute not available: routes are kept only for recent messages from this session.',
      );
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('capture buffer gone'));
    } finally {
      restore();
    }
  });

  it('describes a direct reception when nothing was captured', () => {
    const describeRoute = vi.fn(() => undefined);
    const { pill } = renderLabel({ rxHops: 0, describeRoute });
    fireEvent.mouseEnter(pill);
    expect(screen.getByRole('tooltip').textContent).toBe(
      'Received directly from AlexT1000, no relays',
    );
    expect(describeRoute).toHaveBeenCalledTimes(1);
  });

  it('trusts the captured path over a stored count of 0', () => {
    // A time-window RF correction can give a row its neighbour's count; the capture matched
    // this message by content.
    const { pill } = renderLabel({ rxHops: 0 });
    fireEvent.mouseEnter(pill);
    expect(screen.getByRole('tooltip').textContent).toBe(ROUTE_TEXT);
  });

  it('adds the refined note and accent when a correction mark is active', async () => {
    markMeshcoreHopCorrected('ch:0:2:x');
    const { container, pill } = renderLabel({
      rxHops: 4,
      msg: message('ch:0:2:x'),
      routeDetail: 'none',
      describeRoute: undefined,
    });
    expect(pill.className).toContain('text-orange-400');
    fireEvent.mouseEnter(pill);
    expect(screen.getByRole('tooltip').textContent).toBe(
      [
        'Reached you in 4 hops',
        'Packets on this network record how many relays they passed, not which ones.',
        'Updated from RF path',
      ].join('\n'),
    );
    prepareHopLabelForAxe(container, pill, HOP_LABEL_AMBER_400);
    expect(await axe(container)).toHaveNoViolations();
  });
});
