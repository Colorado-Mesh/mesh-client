/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  noteMeshcomNetworkTimeFromText,
  resetMeshcomNetworkTimeForTests,
} from '../lib/meshcom/meshcomNetworkTime';
import type { DeviceState } from '../lib/types';
import ConnectionPanel from './ConnectionPanel';

const connectedState: DeviceState = {
  status: 'configured',
  myNodeNum: 42,
  reconnectAttempt: 0,
  connectionType: 'serial',
  firmwareVersion: '4.35p',
};

describe('ConnectionPanel MeshCom network time tile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T20:20:00.000Z'));
    resetMeshcomNetworkTimeForTests();
    noteMeshcomNetworkTimeFromText('{CET}2026-11-21 20:15:00');
  });

  afterEach(() => {
    vi.useRealTimers();
    resetMeshcomNetworkTimeForTests();
  });

  it('shows network time detail on the radio link tile for MeshCom', () => {
    render(
      <ConnectionPanel
        state={connectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcom"
      />,
    );
    expect(screen.getByText(/Network time 2026-11-21 20:15:00 \(just now\)/)).toBeInTheDocument();
  });

  it('omits network time detail for non-MeshCom protocols', () => {
    render(
      <ConnectionPanel
        state={connectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );
    expect(screen.queryByText(/Network time/)).not.toBeInTheDocument();
  });
});
