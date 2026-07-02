import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { RNodeFlasherSection } from './RNodeFlasherSection';

describe('RNodeFlasherSection', () => {
  it('has no axe violations', async () => {
    hydrateAxeThemeColors(document.documentElement);
    const { container } = render(<RNodeFlasherSection portBlocked={false} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('renders flasher content without outer details wrapper', () => {
    const { container } = render(<RNodeFlasherSection portBlocked={false} />);
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('keeps provision disabled until flash succeeds', () => {
    render(<RNodeFlasherSection portBlocked={false} />);
    const provision = screen.getByRole('button', { name: /provision/i });
    expect(provision).toBeDisabled();
    expect(provision.className).toContain('border-gray-600');
    expect(provision.className).not.toContain('bg-readable-green');
  });

  it('keeps set firmware hash disabled until provision completes', () => {
    render(<RNodeFlasherSection portBlocked={false} />);
    const hashButton = screen.getByRole('button', { name: /set firmware hash/i });
    expect(hashButton).toBeDisabled();
    expect(hashButton.className).toContain('border-gray-600');
  });

  it('wraps flash controls in a bordered section', () => {
    render(<RNodeFlasherSection portBlocked={false} />);
    expect(screen.getByRole('heading', { name: /flash firmware/i, level: 4 })).toBeInTheDocument();
  });
});
