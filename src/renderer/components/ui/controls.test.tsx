import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { Button, IconButton } from './Button';
import { CopyField } from './CopyField';
import { LabelValue, LabelValueGrid } from './LabelValue';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';
import { StatusTile } from './StatusTile';
import { Stepper } from './Stepper';
import { Switch } from './Switch';

describe('Button', () => {
  it('defaults to type=button and applies the variant', () => {
    render(
      <>
        <Button variant="primary">Connect</Button>
        <Button variant="danger">Disconnect</Button>
      </>,
    );
    const connect = screen.getByRole('button', { name: 'Connect' });
    expect(connect).toHaveAttribute('type', 'button');
    expect(connect.className).toContain('bg-brand-green');
    const disconnect = screen.getByRole('button', { name: 'Disconnect' });
    expect(disconnect.className).toContain('text-red-400');
    expect(disconnect.className).not.toContain('w-full');
  });

  it('gives icon buttons a title from their aria-label', () => {
    render(<IconButton aria-label="Refresh contacts" icon={<svg aria-hidden="true" />} />);
    expect(screen.getByRole('button', { name: 'Refresh contacts' })).toHaveAttribute(
      'title',
      'Refresh contacts',
    );
  });
});

function Segments({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('all');
  return (
    <SegmentedControl
      aria-label="Filter by status"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      options={[
        { value: 'all', label: 'All', count: 394 },
        { value: 'online', label: 'Online', count: 174, dot: 'ok' },
        { value: 'stale', label: 'Stale', count: 101, dot: 'idle' },
        { value: 'offline', label: 'Offline', count: 119, dot: 'off' },
      ]}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a radiogroup with one checked segment in tab order', () => {
    render(<Segments />);
    const group = screen.getByRole('radiogroup', { name: 'Filter by status' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All 394' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'All 394' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Online 174' })).toHaveAttribute('tabindex', '-1');
  });

  it('selects with click and arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Segments onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Stale 101' }));
    expect(onChange).toHaveBeenLastCalledWith('stale');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Stale 101' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('offline');
    expect(screen.getByRole('radio', { name: 'Offline 119' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Offline 119' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('all');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'All 394' }), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('offline');
  });
});

function StepperHarness({ onChange }: { onChange: (v: number) => void }) {
  const [value, setValue] = useState(3);
  return (
    <Stepper
      label="Max reconnect attempts"
      value={value}
      min={0}
      max={10}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe('Stepper', () => {
  it('steps with the buttons and clamps typed values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StepperHarness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Increase Max reconnect attempts' }));
    expect(onChange).toHaveBeenLastCalledWith(4);
    await user.click(screen.getByRole('button', { name: 'Decrease Max reconnect attempts' }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    const input = screen.getByRole('textbox', { name: 'Max reconnect attempts' });
    await user.clear(input);
    await user.type(input, '42{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(10);
    expect(input).toHaveValue('10');
    expect(screen.getByRole('button', { name: 'Increase Max reconnect attempts' })).toBeDisabled();
  });

  it('snaps non-numeric input back to the current value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StepperHarness onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Max reconnect attempts' });
    await user.clear(input);
    await user.type(input, 'abc');
    fireEvent.blur(input);
    expect(input).toHaveValue('3');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('toggles aria-checked', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [on, setOn] = useState(false);
      return <Switch checked={on} onChange={setOn} label="Enable TLS (mqtts / wss)" />;
    }
    render(<Harness />);
    const toggle = screen.getByRole('switch', { name: 'Enable TLS (mqtts / wss)' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});

describe('CopyField', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies the full value while showing the short one', async () => {
    const user = userEvent.setup();
    const writeText = vi.mocked(window.electronAPI.clipboard.writeText);
    writeText.mockResolvedValue(undefined);
    render(
      <CopyField
        value="1200D35FA9246B1564A596CC727FEFAD"
        display="1200D35F...727FEFAD"
        copyLabel="Copy client key"
      />,
    );
    expect(screen.getByText('1200D35F...727FEFAD')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy client key' }));
    expect(writeText).toHaveBeenCalledWith('1200D35FA9246B1564A596CC727FEFAD');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });
});

describe('Panel, StatusTile and LabelValue', () => {
  it('labels the panel region by its title and renders pairs as a description list', () => {
    render(
      <Panel title="Radio" status="Configured" actions={<Button>Docs</Button>}>
        <LabelValueGrid>
          <LabelValue label="Connection type">BLE</LabelValue>
          <LabelValue label="Firmware" mono>
            v1.16.0
          </LabelValue>
        </LabelValueGrid>
      </Panel>,
    );
    const region = screen.getByRole('region', { name: 'Radio' });
    expect(region).toHaveTextContent('Configured');
    expect(screen.getByText('Connection type').tagName).toBe('DT');
    expect(screen.getByText('BLE').tagName).toBe('DD');
  });

  it('has no axe violations for a tile, a panel and controls together', async () => {
    const { container } = render(
      <div>
        <StatusTile
          icon={<svg aria-hidden="true" />}
          label="TAK"
          status="Stopped"
          tone="idle"
          detail="Server not running"
          action={<Button>Start</Button>}
        />
        <Panel title="MQTT" status="Connected">
          <LabelValueGrid>
            <LabelValue label="Server" mono span>
              mqtt.example.org:1883
            </LabelValue>
          </LabelValueGrid>
          <Switch checked onChange={vi.fn()} label="Auto-connect on application start" />
          <StepperHarness onChange={vi.fn()} />
          <CopyField value="abc" copyLabel="Copy client key" />
          <Segments />
        </Panel>
      </div>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
