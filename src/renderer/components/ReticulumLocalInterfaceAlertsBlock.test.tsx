/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'count' in opts) return `${key}:${opts.count}`;
      if (opts && 'name' in opts) return `${key}:${opts.name}`;
      return key;
    },
  }),
}));

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import en from '@/renderer/locales/en/translation.json';

import { ReticulumLocalInterfaceAlertsBlock } from './ReticulumLocalInterfaceAlertsBlock';

describe('ReticulumLocalInterfaceAlertsBlock', () => {
  it('shows BLE offline hint that recommends remove-and-re-add', () => {
    render(
      <ReticulumLocalInterfaceAlertsBlock
        alerts={[
          {
            reason: 'enabled_down',
            iface: {
              id: 'rnode-ble',
              name: 'RNode 41F4',
              type: 'rnode',
              enabled: true,
              status: 'down',
              serial_port: 'ble://eccf2847-e1fd-3f5f-0811-064db1639a3d',
            },
          },
        ]}
        availablePorts={[]}
      />,
    );

    expect(
      screen.getByText('connectionPanel.reticulumLocalInterfaces.offline:RNode 41F4'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumLocalInterfaces.offlineHintBle'),
    ).toBeInTheDocument();
  });

  it('shows stale-bond BLE hint when the name is flagged', () => {
    render(
      <ReticulumLocalInterfaceAlertsBlock
        alerts={[
          {
            reason: 'enabled_down',
            iface: {
              id: 'rnode-ble',
              name: 'RNode 41F4',
              type: 'rnode',
              enabled: true,
              status: 'down',
              serial_port: 'ble://eccf2847-e1fd-3f5f-0811-064db1639a3d',
            },
          },
        ]}
        availablePorts={[]}
        bleBondRemovedNames={['RNode 41F4']}
      />,
    );

    expect(
      screen.getByText('connectionPanel.reticulumLocalInterfaces.offlineHintBleBondStale'),
    ).toBeInTheDocument();
  });

  it('shows fast-flap lockout copy and hides Restart stack', async () => {
    const onRestartStack = vi.fn();
    const { container } = render(
      <ReticulumLocalInterfaceAlertsBlock
        alerts={[
          {
            reason: 'tcp_fast_flap',
            iface: {
              id: 'ratspeak',
              name: 'Ratspeak',
              type: 'tcp',
              enabled: true,
              status: 'down',
              host: 'rns.ratspeak.org',
              port: 4242,
            },
          },
        ]}
        availablePorts={[]}
        onRestartStack={onRestartStack}
      />,
    );

    expect(
      screen.getByText('connectionPanel.reticulumLocalInterfaces.tcpFastFlap:Ratspeak'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumLocalInterfaces.tcpFastFlapHint'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'connectionPanel.reticulumLocalInterfaces.restartStackAria',
      }),
    ).not.toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Reticulum BLE offline hint copy', () => {
  it('tells users to remove and re-add a stale BLE RNode interface', () => {
    const hint = en.connectionPanel.reticulumLocalInterfaces.offlineHintBle;
    expect(hint).toMatch(/remove this interface and add it back/i);
    expect(hint).toMatch(/Pick device/);
    const stale = en.connectionPanel.reticulumLocalInterfaces.offlineHintBleBondStale;
    expect(stale).toMatch(/remove and re-add this interface/i);
  });
});
