import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { LAST_SERIAL_PORT_KEY } from '@/renderer/lib/serialPortSignature';
import type { SerialPortInfo } from '@/renderer/lib/types';

import { FlasherSerialPortPicker } from './FlasherSerialPortPicker';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const ports: SerialPortInfo[] = [
  { portId: 'z', displayName: 'Zulu Board', portName: '/dev/ttyUSB1' },
  { portId: 'a', displayName: 'Alpha Board', portName: '/dev/ttyUSB0' },
];

function portOrder(): string[] {
  return screen
    .getAllByRole('button')
    .map((el) => el.getAttribute('aria-label') ?? '')
    .filter((label) => label.includes('Board'))
    .map((label) => (label.includes('Alpha') ? 'Alpha Board' : 'Zulu Board'));
}

describe('FlasherSerialPortPicker', () => {
  beforeEach(() => {
    localStorage.clear();
    hydrateAxeThemeColors(document.documentElement);
  });

  it('sorts unordered ports A–Z by default and reverses on Name click', async () => {
    const user = userEvent.setup();
    render(<FlasherSerialPortPicker ports={ports} onSelect={vi.fn()} onCancel={vi.fn()} />);
    expect(portOrder()).toEqual(['Alpha Board', 'Zulu Board']);

    await user.click(screen.getByRole('button', { name: 'connectionPanel.sortByNameAsc' }));
    expect(portOrder()).toEqual(['Zulu Board', 'Alpha Board']);
  });

  it('keeps the last-used badge on the same port after sort', async () => {
    const user = userEvent.setup();
    localStorage.setItem(LAST_SERIAL_PORT_KEY, 'z');
    render(<FlasherSerialPortPicker ports={ports} onSelect={vi.fn()} onCancel={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: /Zulu Board.*flasher.lastUsedPort/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'connectionPanel.sortByNameAsc' }));
    expect(
      screen.getByRole('button', { name: /Zulu Board.*flasher.lastUsedPort/ }),
    ).toBeInTheDocument();
    expect(portOrder()[0]).toBe('Zulu Board');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <FlasherSerialPortPicker ports={ports} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
