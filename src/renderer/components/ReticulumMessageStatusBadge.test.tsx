import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { ReticulumMessageStatusBadge } from '@/renderer/components/ReticulumMessageStatusBadge';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

async function renderAndAssertAxe(ui: ReactElement): Promise<ReturnType<typeof render>> {
  const view = render(ui);
  hydrateAxeThemeColors(view.container);
  expect(await axe(view.container)).toHaveNoViolations();
  return view;
}

describe('ReticulumMessageStatusBadge', () => {
  it('shows Delivered for direct Completes', async () => {
    await renderAndAssertAxe(
      <ReticulumMessageStatusBadge status="acked" via="tcp" deliveryMethod="direct" />,
    );
    expect(
      screen.getByLabelText('chatPanel.sentViaTcp: chatPanel.reticulumSendDelivered'),
    ).toBeTruthy();
  });

  it('shows Stored at PN for propagated Completes', async () => {
    await renderAndAssertAxe(
      <ReticulumMessageStatusBadge status="acked" via="tcp" deliveryMethod="propagated" />,
    );
    expect(
      screen.getByLabelText('chatPanel.sentViaPropagation: chatPanel.reticulumSendStoredAtPn'),
    ).toBeTruthy();
    expect(screen.getByText(/reticulumPnAbbrev/)).toBeTruthy();
  });

  it('does not show the delivered check for a remote PN deposit', async () => {
    // The proof came from the propagation node, not the recipient.
    const view = await renderAndAssertAxe(
      <ReticulumMessageStatusBadge status="acked" via="tcp" deliveryMethod="propagated" />,
    );
    expect(screen.getByText(/reticulumPnAbbrev\s+\u{1F4E5}/u)).toBeTruthy();
    expect(screen.queryByText(/✓/)).toBeNull();
    expect(view.container.querySelector('.text-bright-green')).toBeNull();
    expect(view.container.querySelector('.text-amber-400')).not.toBeNull();
  });

  it('shows Paper for paper Completes', async () => {
    await renderAndAssertAxe(
      <ReticulumMessageStatusBadge status="acked" via="tcp" deliveryMethod="paper" />,
    );
    expect(screen.getByLabelText('chatPanel.reticulumSendPaperTooltip')).toBeTruthy();
    expect(screen.getByText(/reticulumSendPaper/)).toBeTruthy();
  });

  it('keeps failure status in tooltip for failed paper messages', async () => {
    await renderAndAssertAxe(
      <ReticulumMessageStatusBadge
        status="failed"
        via="paper"
        deliveryMethod="paper"
        error="decrypt boom"
      />,
    );
    expect(screen.getByLabelText('chatPanel.reticulumSendPaperTooltip: decrypt boom')).toBeTruthy();
  });

  it('shows PN abbrev while propagated send is still in flight', async () => {
    await renderAndAssertAxe(
      <ReticulumMessageStatusBadge status="sending" via="tcp" deliveryMethod="propagated" />,
    );
    expect(screen.getByText(/reticulumPnAbbrev/)).toBeTruthy();
    expect(
      screen.getByLabelText('chatPanel.sentViaPropagation: chatPanel.reticulumSendPropagated'),
    ).toBeTruthy();
  });

  it('shows PN with house icon for local-prop stored_locally (not green check)', async () => {
    await renderAndAssertAxe(
      <ReticulumMessageStatusBadge status="acked" via="tcp" deliveryMethod="stored_locally" />,
    );
    expect(
      screen.getByLabelText(
        'chatPanel.sentViaLocalPropagation: chatPanel.reticulumSendStoredLocally',
      ),
    ).toBeTruthy();
    // Label PN + house emoji — not a delivery checkmark.
    expect(screen.getByText(/reticulumPnAbbrev\s+\u{1F3E0}/u)).toBeTruthy();
    expect(screen.queryByText(/✓/)).toBeNull();
  });

  it('shows storing-locally tooltip while sending with stored_locally', async () => {
    await renderAndAssertAxe(
      <ReticulumMessageStatusBadge status="sending" via="tcp" deliveryMethod="stored_locally" />,
    );
    expect(
      screen.getByLabelText(
        'chatPanel.sentViaLocalPropagation: chatPanel.reticulumSendStoringLocally',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/reticulumPnAbbrev\s+\u{1F3E0}/u)).toBeTruthy();
  });

  it('shows Direct-only notice for message_too_large_for_propagation', async () => {
    await renderAndAssertAxe(
      <ReticulumMessageStatusBadge
        status="failed"
        via="tcp"
        deliveryMethod="propagated"
        error="message_too_large_for_propagation"
      />,
    );
    // Notice tooltip (not "Propagation: failed") and info icon (not ✗).
    expect(screen.getByLabelText('chatPanel.voiceMemo.tooLargeForPropagation')).toBeTruthy();
    expect(screen.getByText(/reticulumPnAbbrev\s+\u2139/u)).toBeTruthy();
    expect(screen.queryByText(/\u2717/u)).toBeNull();
  });
});
