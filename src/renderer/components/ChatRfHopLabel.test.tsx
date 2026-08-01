// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import {
  markMeshcoreHopCorrected,
  resetMeshcoreHopCorrectedMarksForTests,
} from '../lib/meshcoreLateRfHopEnrichment';
import { ChatRfHopLabel, chatRfHopLabelPresentation } from './ChatRfHopLabel';

/** Production Tailwind gray-400 / amber-400 on chat slate-800 for axe contrast. */
const HOP_LABEL_BG_SLATE_800 = '#1e293b';
const HOP_LABEL_GRAY_400 = '#9ca3af';
const HOP_LABEL_AMBER_400 = '#fbbf24';

/** jsdom has no Tailwind CSS — set chat-like slate + label colors for axe contrast. */
function prepareHopLabelForAxe(container: HTMLElement, label: HTMLElement, color: string): void {
  container.style.backgroundColor = HOP_LABEL_BG_SLATE_800;
  label.style.color = color;
  hydrateAxeThemeColors(container);
}

describe('chatRfHopLabelPresentation', () => {
  it('uses amber accent only when corrected and motion is allowed', () => {
    expect(chatRfHopLabelPresentation(false, false).className).toContain('text-gray-400');
    expect(chatRfHopLabelPresentation(true, false).className).toContain('text-amber-400');
    expect(chatRfHopLabelPresentation(true, true).className).toContain('text-gray-400');
    expect(chatRfHopLabelPresentation(true, true).refined).toBe(true);
    expect(chatRfHopLabelPresentation(false, false).refined).toBe(false);
  });
});

describe('ChatRfHopLabel', () => {
  afterEach(() => {
    cleanup();
    resetMeshcoreHopCorrectedMarksForTests();
  });

  it('renders hop count with default title when not corrected', async () => {
    const { container } = render(
      <ChatRfHopLabel
        rxHops={3}
        msg={{ storeId: 'ch:0:1:x', sender_id: 2, timestamp: Date.now(), channel: 0 }}
      />,
    );
    const label = screen.getByText('3 hops');
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute('title', expect.stringMatching(/hop|routing/i));
    expect(label.className).toContain('text-gray-400');
    prepareHopLabelForAxe(container, label, HOP_LABEL_GRAY_400);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('uses refined title when a correction mark is active', async () => {
    markMeshcoreHopCorrected('ch:0:2:x');
    const { container } = render(
      <ChatRfHopLabel
        rxHops={4}
        msg={{ storeId: 'ch:0:2:x', sender_id: 2, timestamp: Date.now(), channel: 0 }}
      />,
    );
    const label = screen.getByText('4 hops');
    expect(label).toHaveAttribute('title', 'Updated from RF path');
    expect(label.className).toContain('text-amber-400');
    prepareHopLabelForAxe(container, label, HOP_LABEL_AMBER_400);
    expect(await axe(container)).toHaveNoViolations();
  });
});
