import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConnectIcon } from './connectIcon';
import { IconMotionProvider } from './iconMotionContext';

function renderWithMotion(ui: React.ReactElement) {
  return render(<IconMotionProvider>{ui}</IconMotionProvider>);
}

describe('connectIcon', () => {
  it('renders plug/socket svg', () => {
    const { container } = renderWithMotion(<ConnectIcon data-testid="connect-icon" />);
    expect(screen.getByTestId('connect-icon')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders when animated for connecting header state', () => {
    renderWithMotion(<ConnectIcon animated className="text-orange-400" size={16} />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });
});
