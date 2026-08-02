import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ConnectionLinkMeter from './ConnectionLinkMeter';

describe('ConnectionLinkMeter', () => {
  it('shows BLE RSSI bars and dBm', () => {
    render(<ConnectionLinkMeter kind="ble-rssi" rssi={-65} />);
    expect(screen.getByText('Signal')).toBeInTheDocument();
    expect(screen.getByText('-65 dBm')).toBeInTheDocument();
  });

  it('shows em dash when BLE RSSI is unknown', () => {
    render(<ConnectionLinkMeter kind="ble-rssi" rssi={null} />);
    expect(screen.getByText('Signal')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows link quality RTT in ms', () => {
    render(<ConnectionLinkMeter kind="ip-rtt" rttMs={42} level={4} />);
    expect(screen.getByText('Link quality')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
  });

  it('shows em dash when IP RTT is unknown', () => {
    render(<ConnectionLinkMeter kind="ip-rtt" rttMs={null} />);
    expect(screen.getByText('Link quality')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows Web Bluetooth unavailable phrase', () => {
    render(<ConnectionLinkMeter kind="unavailable" />);
    expect(screen.getByText('Unavailable (Web Bluetooth)')).toBeInTheDocument();
    expect(screen.getByLabelText('Signal')).toBeInTheDocument();
  });
});
