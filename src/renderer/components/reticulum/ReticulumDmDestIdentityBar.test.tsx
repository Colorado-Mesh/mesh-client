import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReticulumDmDestIdentityBar } from '@/renderer/components/reticulum/ReticulumDmDestIdentityBar';
import type { ResolveReticulumStaleChatDestResult } from '@/renderer/lib/reticulum/resolveReticulumStaleChatDest';

const WIRED = 'd010ea4417f71ff4fd15a6182747aaec';
const WIRED_ID = '098c1ee916253f73459dda7ced773c60';
const TEST = 'e3359f1314aff4fb6261400a8202149b';

const writeTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/renderer/lib/writeClipboardText', () => ({
  writeClipboardText: (...args: unknown[]) => writeTextMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      if (key === 'chatPanel.reticulumDmLxmfPrefix') return `LXMF ${opts?.prefix}…`;
      if (key === 'chatPanel.reticulumDmIdentityPrefix') return `ID ${opts?.prefix}…`;
      if (key === 'chatPanel.reticulumDmCopyLxmfAria') return `Copy LXMF ${opts?.prefix}`;
      if (key === 'chatPanel.reticulumDmCopyIdentityAria') return `Copy ID ${opts?.prefix}`;
      if (key === 'chatPanel.reticulumDmDestHashesAria') return 'Destination hashes';
      if (key === 'chatPanel.reticulumDmStaleAlternateAria') return 'Stale alternate';
      if (key === 'chatPanel.reticulumDmStaleAlternate') {
        return `open ${opts?.openPrefix} alt ${opts?.alternatePrefix}`;
      }
      if (key === 'chatPanel.reticulumDmStaleAlternateNamed') {
        return `open ${opts?.openPrefix} alt ${opts?.alternatePrefix} name ${opts?.name}`;
      }
      if (key === 'chatPanel.reticulumDmStaleAlternateDismissAria') return 'Dismiss warning';
      if (key === 'common.copied') return 'Copied';
      return key;
    },
  }),
}));

describe('ReticulumDmDestIdentityBar', () => {
  beforeEach(() => {
    writeTextMock.mockClear();
  });

  it('shows LXMF and identity prefixes with copy controls', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumDmDestIdentityBar
        lxmfHash={WIRED}
        identityHash={WIRED_ID}
        staleHint={{ status: 'ok' }}
      />,
    );
    expect(screen.getByText('LXMF d010ea44…')).toBeInTheDocument();
    expect(screen.getByText('ID 098c1ee9…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Stale alternate')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy LXMF d010ea44' }));
    expect(writeTextMock).toHaveBeenCalledWith(WIRED);
  });

  it('hides identity when unknown and shows no banner when ok', () => {
    render(
      <ReticulumDmDestIdentityBar
        lxmfHash={WIRED}
        identityHash={null}
        staleHint={{ status: 'ok' }}
      />,
    );
    expect(screen.getByText('LXMF d010ea44…')).toBeInTheDocument();
    expect(screen.queryByText(/ID /)).not.toBeInTheDocument();
  });

  it('shows stale-alternate banner and dismisses it', async () => {
    const user = userEvent.setup();
    const staleHint: ResolveReticulumStaleChatDestResult = {
      status: 'stale_alternate',
      openHash: WIRED,
      alternateHash: TEST,
      alternateDisplayName: 'Ceorl-test',
      reason: 'name_family',
    };
    render(
      <ReticulumDmDestIdentityBar lxmfHash={WIRED} identityHash={WIRED_ID} staleHint={staleHint} />,
    );
    expect(screen.getByLabelText('Stale alternate')).toHaveTextContent(
      'open d010ea44 alt e3359f13 name Ceorl-test',
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(screen.queryByLabelText('Stale alternate')).not.toBeInTheDocument();
  });

  it('uses unnamed stale copy when alternate has no display name', () => {
    const staleHint: ResolveReticulumStaleChatDestResult = {
      status: 'stale_alternate',
      openHash: WIRED,
      alternateHash: TEST,
      alternateDisplayName: null,
      reason: 'failed_other_lxmf',
    };
    render(
      <ReticulumDmDestIdentityBar lxmfHash={WIRED} identityHash={null} staleHint={staleHint} />,
    );
    expect(screen.getByLabelText('Stale alternate')).toHaveTextContent(
      'open d010ea44 alt e3359f13',
    );
  });
});
