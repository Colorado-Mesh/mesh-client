import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import FirmwareStatusIndicator from './FirmwareStatusIndicator';

describe('FirmwareStatusIndicator', () => {
  const noop = vi.fn();

  it('renders nothing for idle phase', () => {
    const { container } = render(<FirmwareStatusIndicator phase="idle" onOpenReleases={noop} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for error phase', () => {
    const { container } = render(<FirmwareStatusIndicator phase="error" onOpenReleases={noop} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a spinner with status role for checking phase', () => {
    render(<FirmwareStatusIndicator phase="checking" onOpenReleases={noop} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders up-to-date indicator for up-to-date phase', () => {
    render(<FirmwareStatusIndicator phase="up-to-date" onOpenReleases={noop} />);
    expect(screen.getByLabelText('Firmware is up to date')).toBeInTheDocument();
  });

  it('does not render a button for up-to-date phase', () => {
    render(<FirmwareStatusIndicator phase="up-to-date" onOpenReleases={noop} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders amber button with version for update-available phase', () => {
    render(
      <FirmwareStatusIndicator
        phase="update-available"
        latestVersion="1.14.1"
        onOpenReleases={noop}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeInTheDocument();
    expect(screen.getByText('v1.14.1')).toBeInTheDocument();
  });

  it('calls onOpenReleases when update-available button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenReleases = vi.fn();
    render(
      <FirmwareStatusIndicator
        phase="update-available"
        latestVersion="1.14.1"
        onOpenReleases={onOpenReleases}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(onOpenReleases).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations for checking phase', async () => {
    const { container } = render(
      <FirmwareStatusIndicator phase="checking" onOpenReleases={noop} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations for up-to-date phase', async () => {
    const { container } = render(
      <FirmwareStatusIndicator phase="up-to-date" onOpenReleases={noop} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations for update-available phase', async () => {
    const { container } = render(
      <FirmwareStatusIndicator
        phase="update-available"
        latestVersion="1.14.1"
        onOpenReleases={noop}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
