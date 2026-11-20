import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ToastProvider, useToast } from './Toast';

function PushToast({
  message,
  type,
}: {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info' | 'emergency';
}) {
  const { addToast } = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        addToast(message, type, 60_000);
      }}
    >
      push
    </button>
  );
}

async function renderToast(
  message: string,
  type: 'success' | 'error' | 'warning' | 'info' | 'emergency',
) {
  const user = userEvent.setup();
  const view = render(
    <ToastProvider>
      <PushToast message={message} type={type} />
    </ToastProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'push' }));
  return view;
}

describe('Toast live regions', () => {
  it('announces success as status', async () => {
    await renderToast('Saved', 'success');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Saved');
    expect(status).toHaveAttribute('aria-atomic', 'true');
  });

  it('announces error as alert', async () => {
    await renderToast('Boom', 'error');
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });

  it('announces emergency as alert', async () => {
    await renderToast('Siren', 'emergency');
    expect(screen.getByRole('alert')).toHaveTextContent('Siren');
  });

  it('keeps dismiss labelled', async () => {
    await renderToast('Hello', 'info');
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = await renderToast('Accessible toast', 'warning');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
