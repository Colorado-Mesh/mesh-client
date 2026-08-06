import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { FIRMWARE_PRODUCTS } from '@/renderer/lib/flasher/firmwareConfigs';
import {
  clearFlasherFlashSession,
  markFlasherFlashCompleted,
  markFlasherProvisionCompleted,
} from '@/renderer/lib/flasher/flasherSessionPort';

import { RNodeFlasherSection } from './RNodeFlasherSection';

describe('RNodeFlasherSection', () => {
  beforeEach(() => {
    clearFlasherFlashSession();
  });

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

  it('restores provision unlock after remount when flash completed in session', () => {
    markFlasherFlashCompleted();
    const { unmount } = render(<RNodeFlasherSection portBlocked={false} />);
    unmount();

    render(<RNodeFlasherSection portBlocked={false} />);
    const provision = screen.getByRole('button', { name: /provision/i });
    expect(provision).not.toBeDisabled();
    expect(provision.className).toContain('bg-readable-green');
    expect(screen.getByRole('button', { name: /set firmware hash/i })).toBeDisabled();
  });

  it('restores set firmware hash unlock after remount when provision completed', () => {
    markFlasherFlashCompleted();
    markFlasherProvisionCompleted();
    const { unmount } = render(<RNodeFlasherSection portBlocked={false} />);
    unmount();

    render(<RNodeFlasherSection portBlocked={false} />);
    expect(screen.getByRole('button', { name: /set firmware hash/i })).not.toBeDisabled();
  });

  it('clears step unlock when product selection changes', async () => {
    const user = userEvent.setup();
    markFlasherFlashCompleted();
    markFlasherProvisionCompleted();
    render(<RNodeFlasherSection portBlocked={false} />);

    expect(screen.getByRole('button', { name: /set firmware hash/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /provision/i })).toHaveTextContent(/provisioned/i);

    const product = FIRMWARE_PRODUCTS[0];
    if (!product) {
      throw new Error('expected FIRMWARE_PRODUCTS to be non-empty');
    }
    await user.selectOptions(screen.getByLabelText(/^product$/i), product.catalogKey);

    expect(screen.getByRole('button', { name: /provision/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /set firmware hash/i })).toBeDisabled();
  });
});
