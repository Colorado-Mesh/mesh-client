import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IconMotionProvider } from './iconMotionContext';
import { IconRestart, IconUpdateAvailable, IconUpToDate, IconWarning } from './statusIcons';

vi.mock('lucide-react-motion', async (importOriginal) => {
  const actual = await importOriginal();
  const MockIcon = () => <svg data-testid="status-svg" />;
  return {
    ...(actual as Record<string, unknown>),
    Check: MockIcon,
    Download: MockIcon,
    RotateCcw: MockIcon,
    TriangleAlert: MockIcon,
  };
});

describe('statusIcons', () => {
  it('renders update status icons', () => {
    render(
      <IconMotionProvider>
        <IconUpToDate />
        <IconWarning />
        <IconUpdateAvailable />
        <IconRestart />
      </IconMotionProvider>,
    );
    expect(screen.getAllByTestId('status-svg')).toHaveLength(4);
  });
});
