import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfigApplyNotice } from './ConfigApplyNotice';

describe('ConfigApplyNotice', () => {
  it('renders persist and restart notes', () => {
    render(<ConfigApplyNotice />);

    expect(
      screen.getByText(
        "Applied settings are saved to the device's flash memory and persist across reboots.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The device may briefly restart when you apply settings.'),
    ).toBeInTheDocument();
  });
});
