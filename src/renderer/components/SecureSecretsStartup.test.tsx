import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SecureSecretsStartup } from './SecureSecretsStartup';

const initialize = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/lib/secureSecretStorage', () => ({
  initializeSecureSecretsFailClosed: initialize,
}));
vi.mock('@/renderer/lib/connectionPanelStorageMigrations', () => ({
  runConnectionPanelStorageMigrations: vi.fn(),
}));

describe('SecureSecretsStartup', () => {
  beforeEach(() => {
    initialize.mockReset();
  });

  it('keeps runtimes unmounted during hydration, then starts normally', async () => {
    let complete: () => void = () => {};
    initialize.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    render(
      <SecureSecretsStartup>
        <p>Runtime mounted</p>
      </SecureSecretsStartup>,
    );
    expect(screen.queryByText('Runtime mounted')).toBeNull();
    complete();
    expect(await screen.findByText('Runtime mounted')).toBeInTheDocument();
  });

  it('shows safe recovery on failure and retries without mounting runtimes early', async () => {
    initialize
      .mockRejectedValueOnce(new Error('private-source-details'))
      .mockResolvedValueOnce(undefined);
    render(
      <SecureSecretsStartup>
        <p>Runtime mounted</p>
      </SecureSecretsStartup>,
    );
    const error = await screen.findByRole('alert');
    expect(error.textContent).not.toContain('private-source-details');
    expect(screen.queryByText('Runtime mounted')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Runtime mounted')).toBeInTheDocument();
    expect(initialize).toHaveBeenCalledTimes(2);
  });
});
