import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IconMotionProvider } from './iconMotionContext';
import { TabIcon } from './tabIcons';

vi.mock('lucide-react-motion', async (importOriginal) => {
  const actual = await importOriginal();
  const MockIcon = () => <svg data-testid="tab-svg" />;
  return {
    ...(actual as Record<string, unknown>),
    Link2: MockIcon,
    MessageCircle: MockIcon,
    Users: MockIcon,
    Settings: MockIcon,
    MapPin: MockIcon,
    ChartBar: MockIcon,
    Lock: MockIcon,
    Wrench: MockIcon,
    FileChartColumn: MockIcon,
    Blocks: MockIcon,
    Radio: MockIcon,
    House: MockIcon,
    Crosshair: MockIcon,
    ChartPie: MockIcon,
    Code: MockIcon,
    Wifi: MockIcon,
    GitBranch: MockIcon,
    Shield: MockIcon,
  };
});

describe('TabIcon', () => {
  it('renders svg for known slot', () => {
    render(
      <IconMotionProvider>
        <TabIcon name="Chat" />
      </IconMotionProvider>,
    );
    expect(screen.getByTestId('tab-svg')).toBeInTheDocument();
  });

  it('returns null for unknown slot', () => {
    const { container } = render(
      <IconMotionProvider>
        <TabIcon name="Verbinden" />
      </IconMotionProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
