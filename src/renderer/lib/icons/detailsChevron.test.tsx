import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DetailsChevron } from './detailsChevron';
import { IconMotionProvider } from './iconMotionContext';

vi.mock('lucide-react-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    ChevronDown: () => <svg data-testid="chevron" />,
  };
});

describe('DetailsChevron', () => {
  it('renders chevron icon', () => {
    render(
      <IconMotionProvider>
        <DetailsChevron />
      </IconMotionProvider>,
    );
    expect(screen.getByTestId('chevron')).toBeInTheDocument();
  });
});
