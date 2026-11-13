import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { MessageStatusBadge } from '@/renderer/components/MessageStatusBadge';
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

describe('MessageStatusBadge', () => {
  it.each(['tcp', 'http'] as const)(
    'uses WiFi mesh-ACK tooltip for failed device sends over %s',
    async (connectionType) => {
      await renderAndAssertAxe(
        <MessageStatusBadge status="failed" transport="device" connectionType={connectionType} />,
      );
      expect(
        screen.getByLabelText(
          'messageStatusBadge.tooltipPrefixDevice: messageStatusBadge.noAckTooltipWifi',
        ),
      ).toBeTruthy();
      // Prefer the visible badge — HelpTooltip sr-only description also contains "noAck*".
      expect(
        screen.getByText(/messageStatusBadge\.transportWifi\s+messageStatusBadge\.noAck/),
      ).toBeTruthy();
    },
  );

  it('keeps the generic no-ACK tooltip for failed serial device sends', async () => {
    await renderAndAssertAxe(
      <MessageStatusBadge status="failed" transport="device" connectionType="serial" />,
    );
    expect(
      screen.getByLabelText(
        'messageStatusBadge.tooltipPrefixDevice: messageStatusBadge.noAckTooltip',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/noAckTooltipWifi/)).toBeNull();
  });
});

it('shows proven delivery for ACK_PROOF_VALID', async () => {
  await renderAndAssertAxe(
    <MessageStatusBadge status="acked" transport="device" ackProofStatus="valid" />,
  );
  expect(screen.getByLabelText('messageStatusBadge.ackProof.provenTooltip')).toBeTruthy();
});

it('shows proof failed for ACK_PROOF_INVALID', async () => {
  await renderAndAssertAxe(
    <MessageStatusBadge status="acked" transport="device" ackProofStatus="invalid" />,
  );
  expect(screen.getByLabelText('messageStatusBadge.ackProof.failedTooltip')).toBeTruthy();
});

it('shows relayed/unproven when acked without proof', async () => {
  await renderAndAssertAxe(
    <MessageStatusBadge status="acked" transport="device" ackProofStatus="absent" />,
  );
  expect(screen.getByLabelText('messageStatusBadge.ackProof.relayedUnprovenTooltip')).toBeTruthy();
});

it('shows SF++ confirmed phase', async () => {
  await renderAndAssertAxe(
    <MessageStatusBadge status="sending" transport="device" sfppPhase="confirmed" />,
  );
  expect(screen.getByLabelText('messageStatusBadge.sfpp.confirmedTooltip')).toBeTruthy();
});
