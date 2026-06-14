import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IconMotionProvider } from './iconMotionContext';
import { SpinnerIcon } from './spinnerIcon';

vi.mock('lucide-react-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    Loader: () => <svg data-testid="loader" />,
  };
});

describe('SpinnerIcon', () => {
  it('renders loader when active', () => {
    render(
      <IconMotionProvider>
        <SpinnerIcon />
      </IconMotionProvider>,
    );
    expect(screen.getByTestId('loader')).toBeInTheDocument();
  });

  it('returns null when inactive', () => {
    const { container } = render(
      <IconMotionProvider>
        <SpinnerIcon active={false} />
      </IconMotionProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
