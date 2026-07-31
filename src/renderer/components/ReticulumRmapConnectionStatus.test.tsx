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
  it('shows not publishing in gray and opens Network settings', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ReticulumRmapConnectionStatus
        sidecarApiReady
        interfaces={[iface({ id: 'r', type: 'rnode', serial_port: '/dev/ttyUSB0' })]}
        onOpenRmapSettings={onOpen}
      />,
    );
    const status = screen.getByText('connectionPanel.reticulumRmap.notPublishing:{}');
    expect(status).toBeInTheDocument();
    expect(status).toHaveClass('text-gray-400');
    expect(status).not.toHaveClass('text-amber-300');
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumRmap.openSettingsAria:{}' }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('link', { name: 'connectionPanel.reticulumRmap.openGlobalMapAria:{}' }),
    ).toHaveAttribute('href', 'https://rmap.world/');
  });

  it('shows amber X of Y when partially publishing', () => {
    render(
      <ReticulumRmapConnectionStatus
        sidecarApiReady
        interfaces={[
          iface({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
          iface({ id: 'r2', type: 'ble_peer', discoverable: false }),
          iface({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 }),
        ]}
      />,
    );
    const status = screen.getByText(
      'connectionPanel.reticulumRmap.publishingOf:{"current":1,"total":2}',
    );
    expect(status).toBeInTheDocument();
    expect(status).toHaveClass('text-amber-300');
    expect(screen.queryByText(/needsSync/)).not.toBeInTheDocument();
  });

  it('shows green X of Y when fully publishing', () => {
    render(
      <ReticulumRmapConnectionStatus
        sidecarApiReady
        interfaces={[
          iface({ id: 'r1', type: 'rnode', serial_port: '/dev/ttyUSB0', discoverable: true }),
          iface({ id: 'r2', type: 'ble_peer', discoverable: true }),
          iface({ id: 'i', type: 'i2p', discoverable: true }),
        ]}
      />,
    );
    const status = screen.getByText(
      'connectionPanel.reticulumRmap.publishingOf:{"current":3,"total":3}',
    );
    expect(status).toHaveClass('text-brand-green');
    expect(status).not.toHaveClass('text-amber-300');
  });

  it('excludes tcp hubs from Y and shows noPublishTargets when none eligible', () => {
    render(
      <ReticulumRmapConnectionStatus
        sidecarApiReady
        interfaces={[iface({ id: 't', type: 'tcp', host: 'rmap.world', port: 4242 })]}
      />,
    );
    expect(screen.getByText('connectionPanel.reticulumRmap.notPublishing:{}')).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumRmap.noPublishTargets:{}'),
    ).toBeInTheDocument();
  });
});
