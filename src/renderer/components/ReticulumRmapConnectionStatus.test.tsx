// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';

import { ReticulumRmapConnectionStatus } from './ReticulumRmapConnectionStatus';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => `${key}:${JSON.stringify(opts ?? {})}`,
  }),
}));

function iface(
  partial: Partial<ReticulumInterfaceRow> & Pick<ReticulumInterfaceRow, 'id' | 'type'>,
): ReticulumInterfaceRow {
  return {
    name: partial.name ?? partial.id,
    enabled: partial.enabled ?? true,
    status: partial.status ?? 'up',
    ...partial,
  };
}

describe('ReticulumRmapConnectionStatus', () => {
  it('shows not publishing and opens Network settings', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ReticulumRmapConnectionStatus
        sidecarApiReady
        interfaces={[iface({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0' })]}
        onOpenRmapSettings={onOpen}
      />,
    );
    expect(screen.getByText('connectionPanel.reticulumRmap.notPublishing:{}')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumRmap.openSettingsAria:{}' }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('link', { name: 'connectionPanel.reticulumRmap.openGlobalMapAria:{}' }),
    ).toHaveAttribute('href', 'https://rmap.world/');
  });

  it('shows publishing count and needs-sync warning', () => {
    render(
      <ReticulumRmapConnectionStatus
        sidecarApiReady
        interfaces={[
          iface({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
          iface({ id: 'r2', type: 'ble_peer', discoverable: false }),
        ]}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumRmap.publishing:{"count":1}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumRmap.needsSync:{"count":1}'),
    ).toBeInTheDocument();
  });
});
