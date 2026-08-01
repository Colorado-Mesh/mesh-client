// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  markMeshcoreHopCorrected,
  resetMeshcoreHopCorrectedMarksForTests,
} from '../lib/meshcoreLateRfHopEnrichment';
import { ChatRfHopLabel, chatRfHopLabelPresentation } from './ChatRfHopLabel';

describe('chatRfHopLabelPresentation', () => {
  it('uses amber accent only when corrected and motion is allowed', () => {
    expect(chatRfHopLabelPresentation(false, false).className).toContain('text-gray-500');
    expect(chatRfHopLabelPresentation(true, false).className).toContain('text-amber-400');
    expect(chatRfHopLabelPresentation(true, true).className).toContain('text-gray-500');
    expect(chatRfHopLabelPresentation(true, true).refined).toBe(true);
    expect(chatRfHopLabelPresentation(false, false).refined).toBe(false);
  });
});

describe('ChatRfHopLabel', () => {
  afterEach(() => {
    cleanup();
    resetMeshcoreHopCorrectedMarksForTests();
  });

  it('renders hop count with default title when not corrected', () => {
    render(
      <ChatRfHopLabel
        rxHops={3}
        msg={{ storeId: 'ch:0:1:x', sender_id: 2, timestamp: Date.now(), channel: 0 }}
      />,
    );
    expect(screen.getByText('3 hops')).toBeInTheDocument();
    expect(screen.getByText('3 hops')).toHaveAttribute(
      'title',
      expect.stringMatching(/hop|routing/i),
    );
  });

  it('uses refined title when a correction mark is active', () => {
    markMeshcoreHopCorrected('ch:0:2:x');
    render(
      <ChatRfHopLabel
        rxHops={4}
        msg={{ storeId: 'ch:0:2:x', sender_id: 2, timestamp: Date.now(), channel: 0 }}
      />,
    );
    expect(screen.getByText('4 hops')).toHaveAttribute('title', 'Updated from RF path');
    expect(screen.getByText('4 hops').className).toContain('text-amber-400');
  });
});
