import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionIcon, MqttGlobeIcon } from './connectionIcons';
import { IconMotionProvider } from './iconMotionContext';

vi.mock('lucide-react-motion', async (importOriginal) => {
  const actual = await importOriginal();
  const MockIcon = ({ className }: { className?: string }) => (
    <svg data-testid="mock-icon" className={className} />
  );
  return {
    ...(actual as Record<string, unknown>),
    Bluetooth: MockIcon,
    Cpu: MockIcon,
    Radio: MockIcon,
    Globe: MockIcon,
  };
});

function renderWithMotion(ui: React.ReactElement) {
  return render(<IconMotionProvider>{ui}</IconMotionProvider>);
}

describe('connectionIcons', () => {
  it('renders BLE transport icon', () => {
    renderWithMotion(<ConnectionIcon type="ble" />);
    expect(screen.getByTestId('mock-icon')).toBeInTheDocument();
  });

  it('renders serial transport icon', () => {
    renderWithMotion(<ConnectionIcon type="serial" />);
    expect(screen.getByTestId('mock-icon')).toBeInTheDocument();
  });

  it('renders http transport icon', () => {
    renderWithMotion(<ConnectionIcon type="http" />);
    expect(screen.getByTestId('mock-icon')).toBeInTheDocument();
  });

  it('renders mqtt globe icon', () => {
    renderWithMotion(<MqttGlobeIcon />);
    expect(screen.getByTestId('mock-icon')).toBeInTheDocument();
  });
});
