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

  it('shows Paper for paper Completes', async () => {
    await renderAndAssertAxe(
      <ReticulumMessageStatusBadge status="acked" via="tcp" deliveryMethod="paper" />,
    );
    expect(screen.getByLabelText('chatPanel.reticulumSendPaperTooltip')).toBeTruthy();
    expect(screen.getByText(/reticulumSendPaper/)).toBeTruthy();
  });
});
