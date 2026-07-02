/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'count' in opts) return `${key}:${opts.count}`;
      if (opts && 'name' in opts) return `${key}:${opts.name}`;
      return key;
    },
  }),
}));

import { ReticulumLocalInterfaceConnectingBlock } from './ReticulumLocalInterfaceConnectingBlock';

describe('ReticulumLocalInterfaceConnectingBlock', () => {
  it('renders cyan connecting status for BLE interfaces', () => {
    render(
      <ReticulumLocalInterfaceConnectingBlock
        interfaces={[
          {
            id: 'nv0n2',
            name: 'NV0N2',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: 'ble://aa:bb',
          },
        ]}
      />,
    );

    expect(
      screen.getByText('connectionPanel.reticulumLocalInterfaces.connectingHeading:1'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumLocalInterfaces.connectingRow:NV0N2'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('border-cyan-700/45');
  });
});
