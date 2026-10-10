import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ProtocolSwitcher } from './ProtocolSwitcher';

describe('ProtocolSwitcher', () => {
  it('has no serious axe violations with three protocol pills', async () => {
    const { container } = render(
      <ProtocolSwitcher
        protocol="meshcore"
        unreadByProtocol={{ meshtastic: 2, meshcore: 0 }}
        onProtocolChange={() => {}}
      />,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
