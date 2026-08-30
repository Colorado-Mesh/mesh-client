import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { LongSessionRestartBanner } from './LongSessionRestartBanner';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('LongSessionRestartBanner', () => {
  it('renders restart and dismiss actions', async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn();
    const onDismiss = vi.fn();
    const view = render(<LongSessionRestartBanner onRestart={onRestart} onDismiss={onDismiss} />);
    expect(screen.getByText('longSession.title')).toBeInTheDocument();
    expect(screen.getByText('longSession.body')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'longSession.restart' }));
    expect(onRestart).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'longSession.dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
    hydrateAxeThemeColors(view.container);
    expect(await axe(view.container)).toHaveNoViolations();
  });
});
