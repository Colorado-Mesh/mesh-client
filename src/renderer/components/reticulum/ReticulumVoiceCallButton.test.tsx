// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ReticulumVoiceCallButton } from './ReticulumVoiceCallButton';

const callPeer = vi.fn();

vi.mock('@/renderer/lib/reticulumVoiceSession', () => ({
  reticulumVoiceCallPeer: (...args: unknown[]) => callPeer(...args),
}));

describe('ReticulumVoiceCallButton', () => {
  beforeEach(() => {
    callPeer.mockReset();
  });

  it('invokes call helper with peer hash and has no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ReticulumVoiceCallButton lxmfPeerHash={'a'.repeat(32)} identityHash={'b'.repeat(32)} />,
    );
    await user.click(screen.getByRole('button', { name: /start lxst voice call/i }));
    expect(callPeer).toHaveBeenCalledWith('a'.repeat(32), { identityHash: 'b'.repeat(32) });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
