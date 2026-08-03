// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import i18n from '@/renderer/lib/i18n';

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

  it('uses outlined cyan chip action class and keeps interop only in aria/title', () => {
    render(
      <ReticulumVoiceCallButton lxmfPeerHash={'a'.repeat(32)} identityHash={'b'.repeat(32)} />,
    );
    const btn = screen.getByRole('button', { name: /start lxst voice call/i });
    expect(btn.className).toContain('border-cyan-500/35');
    expect(btn.className).toMatch(/text-cyan-/);
    expect(btn.className).not.toContain('hover:underline');
    const interop = i18n.t('reticulumVoice.help.interop');
    expect(btn.getAttribute('aria-label')).toContain(interop);
    expect(btn.getAttribute('title')).toContain(interop);
    expect(screen.queryByText(interop)).not.toBeInTheDocument();
  });
});
