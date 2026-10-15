import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import {
  type MeshcoreTelemetryPushActions,
  MeshcoreTelemetryPushError,
} from '../hooks/meshcore/useMeshcoreTelemetryPush';
import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { MeshcoreTelemetryPushSubscription } from '../lib/meshcore/meshcoreTelemetryPush';
import MeshcoreTelemetryPushSection from './MeshcoreTelemetryPushSection';

function makePush(overrides: Partial<MeshcoreTelemetryPushActions> = {}) {
  return {
    subscriptions: new Map<number, MeshcoreTelemetryPushSubscription>(),
    subscribe: vi.fn(() => Promise.reject(new Error('unused'))),
    unsubscribe: vi.fn(() => Promise.resolve()),
    clearAll: vi.fn(),
    ...overrides,
  } satisfies MeshcoreTelemetryPushActions;
}

const ACTIVE: MeshcoreTelemetryPushSubscription = {
  nodeId: 7,
  tag: 1,
  options: { timeoutSecs: 3600, thresholds: { temperature: 0.5 } },
  grantedSecs: 3600,
  subscribedAt: 0,
  lastPushAt: null,
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('MeshcoreTelemetryPushSection', () => {
  it('logs in, then subscribes with the entered thresholds and lease', async () => {
    const push = makePush({ subscribe: vi.fn(() => Promise.resolve(ACTIVE)) });
    const ensureAccess = vi.fn(() => Promise.resolve(true));
    render(
      <MeshcoreTelemetryPushSection
        nodeId={7}
        push={push}
        ensureAccess={ensureAccess}
        disabled={false}
      />,
    );
    fireEvent.change(screen.getByLabelText('Humidity (%)'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Subscription length (minutes)'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      expect(push.subscribe).toHaveBeenCalledWith(7, {
        timeoutSecs: 1800,
        thresholds: { temperature: 0.5, voltage: 0.1, pressure: 1 },
      });
    });
    expect(ensureAccess).toHaveBeenCalled();
  });

  it('does not subscribe when login is cancelled', async () => {
    const push = makePush();
    const ensureAccess = vi.fn(() => Promise.resolve(false));
    render(
      <MeshcoreTelemetryPushSection
        nodeId={7}
        push={push}
        ensureAccess={ensureAccess}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      expect(ensureAccess).toHaveBeenCalled();
    });
    expect(push.subscribe).not.toHaveBeenCalled();
  });

  it.each([
    ['noMetrics', /does not report any of the selected values/],
    ['rejected', /refused the subscription/],
  ] as const)('explains a %s failure', async (code, message) => {
    const push = makePush({
      subscribe: vi.fn(() => Promise.reject(new MeshcoreTelemetryPushError(code))),
    });
    render(
      <MeshcoreTelemetryPushSection
        nodeId={7}
        push={push}
        ensureAccess={() => Promise.resolve(true)}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('shows status and unsubscribes when switched off', async () => {
    const push = makePush({ subscriptions: new Map([[7, ACTIVE]]) });
    render(
      <MeshcoreTelemetryPushSection
        nodeId={7}
        push={push}
        ensureAccess={() => Promise.resolve(true)}
        disabled={false}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/Waiting for the first change/);
    expect(screen.getByLabelText('Temperature (°C)')).toBeDisabled();
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      expect(push.unsubscribe).toHaveBeenCalledWith(7);
    });
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <MeshcoreTelemetryPushSection
        nodeId={7}
        push={makePush({ subscriptions: new Map([[7, { ...ACTIVE, lastPushAt: 1 }]]) })}
        ensureAccess={() => Promise.resolve(true)}
        disabled={false}
      />,
    );
    const details = container.querySelector('details');
    if (details) details.open = true;
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
