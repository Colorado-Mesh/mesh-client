import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { SecureSecretsStartup } from './SecureSecretsStartup';

const { initialize, unavailable, forget } = vi.hoisted(() => ({
  initialize: vi.fn(),
  unavailable: vi.fn(),
  forget: vi.fn(),
}));
vi.mock('@/renderer/lib/secureSecretStorage', () => ({
  initializeSecureSecretsFailClosed: initialize,
  getUnavailableStartupCredentialKeys: unavailable,
  forgetUnavailableStartupCredentials: forget,
  MESHTASTIC_MQTT_SECRET_KEY: 'mqtt:meshtastic',
  MESHCORE_MQTT_SECRET_KEY: 'mqtt:meshcore',
  MESHCORE_IDENTITY_SECRET_KEY: 'meshcore:identity',
  MQTT_PROFILES_SECRET_KEY: 'mqtt:profiles',
}));
vi.mock('@/renderer/lib/connectionPanelStorageMigrations', () => ({
  runConnectionPanelStorageMigrations: vi.fn(),
}));

describe('SecureSecretsStartup', () => {
  beforeEach(() => {
    initialize.mockReset();
    unavailable.mockReset().mockReturnValue([]);
    forget.mockReset().mockResolvedValue(undefined);
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
    await waitFor(() => {
      expect(initialize).toHaveBeenCalledOnce();
    });
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

  it('shows recovery for failed preference preparation and retries it before secrets or runtimes', async () => {
    const prepare = vi
      .fn()
      .mockRejectedValueOnce(new Error('corrupt preference row'))
      .mockResolvedValueOnce(undefined);
    initialize.mockResolvedValue(undefined);
    render(
      <SecureSecretsStartup prepare={prepare}>
        <p>Runtime mounted</p>
      </SecureSecretsStartup>,
    );
    expect(await screen.findByRole('alert')).not.toHaveTextContent('corrupt preference row');
    expect(initialize).not.toHaveBeenCalled();
    expect(screen.queryByText('Runtime mounted')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Runtime mounted')).toBeInTheDocument();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenCalledOnce();
  });

  it('waits for post-secret cache finalization and retries its failure before mounting runtimes', async () => {
    const order: string[] = [];
    const prepare = vi.fn(() => {
      order.push('prepare');
      return Promise.resolve();
    });
    initialize.mockImplementation(() => {
      order.push('secrets');
      return Promise.resolve();
    });
    const finish = vi
      .fn()
      .mockImplementationOnce(() => {
        order.push('finish');
        return Promise.reject(new Error('unreadable source'));
      })
      .mockImplementationOnce(() => {
        order.push('finish');
        return Promise.resolve();
      });
    render(
      <SecureSecretsStartup prepare={prepare} finish={finish}>
        <p>Runtime mounted</p>
      </SecureSecretsStartup>,
    );
    expect(await screen.findByRole('alert')).not.toHaveTextContent('unreadable source');
    expect(screen.queryByText('Runtime mounted')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Runtime mounted')).toBeInTheDocument();
    expect(order).toEqual(['prepare', 'secrets', 'finish', 'prepare', 'secrets', 'finish']);
  });

  it('does not offer credential removal for generic preparation failures or stale blocked keys', async () => {
    unavailable.mockReturnValue(['mqtt:meshtastic']);
    const prepare = vi.fn().mockRejectedValue(new Error('database unavailable'));
    render(<SecureSecretsStartup prepare={prepare}>Runtime mounted</SecureSecretsStartup>);
    await screen.findByRole('alert');
    expect(screen.queryByText('Remove unreadable credentials…')).toBeNull();
    expect(forget).not.toHaveBeenCalled();
  });

  it('requires a fresh acknowledgment after cancel and never removes on cancel', async () => {
    initialize.mockRejectedValue(new Error('protected credential unavailable'));
    unavailable.mockReturnValue(['mqtt:meshtastic']);
    render(<SecureSecretsStartup>Runtime mounted</SecureSecretsStartup>);
    fireEvent.click(await screen.findByText('Remove unreadable credentials…'));
    expect(screen.getByText('Meshtastic MQTT')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toHaveFocus();
    expect(screen.getByText('Remove and retry')).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('Remove and retry')).toBeEnabled();
    fireEvent.click(screen.getByText('Cancel'));
    expect(forget).not.toHaveBeenCalled();
    expect(screen.getByText('Remove unreadable credentials…')).toHaveFocus();
    fireEvent.click(screen.getByText('Remove unreadable credentials…'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('Remove and retry')).toBeDisabled();
  });

  it('disables controls during removal, removes only the displayed keys, and repeats all startup phases', async () => {
    const order: string[] = [];
    const prepare = vi.fn(() => {
      order.push('prepare');
      return Promise.resolve();
    });
    const finish = vi.fn(() => {
      order.push('finish');
      return Promise.resolve();
    });
    initialize
      .mockImplementationOnce(() => {
        order.push('secrets');
        return Promise.reject(new Error('protected credential unavailable'));
      })
      .mockImplementationOnce(() => {
        order.push('secrets');
        return Promise.resolve();
      });
    unavailable.mockReturnValue(['mqtt:meshcore', 'meshcore:identity']);
    let complete: () => void = () => {};
    forget.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    render(
      <SecureSecretsStartup prepare={prepare} finish={finish}>
        Runtime mounted
      </SecureSecretsStartup>,
    );
    fireEvent.click(await screen.findByText('Remove unreadable credentials…'));
    fireEvent.click(screen.getByRole('checkbox'));
    const confirm = screen.getByText('Remove and retry');
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(forget).toHaveBeenCalledExactlyOnceWith(['mqtt:meshcore', 'meshcore:identity']);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
    expect(screen.queryByText('Runtime mounted')).toBeNull();
    complete();
    expect(await screen.findByText('Runtime mounted')).toBeInTheDocument();
    expect(order).toEqual(['prepare', 'secrets', 'prepare', 'secrets', 'finish']);
  });

  it('keeps safe recovery after a partial removal failure and refreshes the eligible keys', async () => {
    initialize.mockRejectedValue(new Error('protected credential unavailable'));
    unavailable
      .mockReturnValueOnce(['mqtt:profiles', 'meshcore:room:42'])
      .mockReturnValue(['meshcore:room:42']);
    forget.mockRejectedValueOnce(new Error('private credential value'));
    render(<SecureSecretsStartup>Runtime mounted</SecureSecretsStartup>);
    fireEvent.click(await screen.findByText('Remove unreadable credentials…'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Remove and retry'));
    expect(
      await screen.findByText(
        'The credentials could not be fully removed. Try again, or cancel to keep the remaining saved data.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('private credential value');
    expect(screen.queryByText('Saved MQTT profile passwords')).toBeNull();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('Remove and retry')).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Remove and retry'));
    await waitFor(() => {
      expect(forget).toHaveBeenLastCalledWith(['meshcore:room:42']);
    });
  });

  it('provides named, accessible confirmation controls for every eligible credential category', async () => {
    initialize.mockRejectedValue(new Error('protected credential unavailable'));
    unavailable.mockReturnValue([
      'mqtt:meshtastic',
      'meshcore:identity',
      'mqtt:profiles',
      'meshcore:room:42',
      'meshcore:repeater:43',
    ]);
    const { container } = render(<SecureSecretsStartup>Runtime mounted</SecureSecretsStartup>);
    fireEvent.click(await screen.findByText('Remove unreadable credentials…'));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(
      screen.getByRole('checkbox', {
        name: 'I understand I will need to reconfigure these credentials. This cannot be undone.',
      }),
    ).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
