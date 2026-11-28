import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { ReachCheckSession } from '@/shared/reachCheck';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { type ReachCheckEntry, useReachCheckStore } from '../lib/reachCheck/reachCheckStore';
import type { IdentityId } from '../lib/types';
import { ReachCheckLine } from './ReachCheckLine';

const ID = 'meshcore:aa' as IdentityId;
const MSG = 'out:1700000000000:abc';

function session(overrides: Partial<ReachCheckSession> = {}): ReachCheckSession {
  return {
    id: 's1',
    code: 'MHC-1A2B3C',
    status: 'active',
    expiresAt: Date.now() + 600_000,
    observedCount: 7,
    expectedCount: 10,
    repeaterCount: 3,
    distanceText: '84 mi',
    sharePath: '/share/s1',
    ...overrides,
  };
}

function startEntry(overrides: Partial<ReachCheckEntry> = {}): void {
  useReachCheckStore.getState().start(ID, MSG, {
    origin: 'https://rangecheck.example.org',
    sessionId: 's1',
    code: 'MHC-1A2B3C',
    session: session(),
    state: 'polling',
    startedAt: Date.now(),
    ...overrides,
  });
}

beforeEach(() => {
  useReachCheckStore.setState({ entries: {} });
});

describe('ReachCheckLine', () => {
  it('renders nothing without an entry, for other senders, or without an identity', () => {
    const { container, rerender } = render(
      <ReachCheckLine messageId={MSG} isOwn identityId={ID} />,
    );
    expect(container).toBeEmptyDOMElement();
    startEntry();
    rerender(<ReachCheckLine messageId={MSG} isOwn={false} identityId={ID} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ReachCheckLine messageId={MSG} isOwn identityId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('drops the line and its entry when the code was not sent (bubble failed)', async () => {
    startEntry({ session: session({ observedCount: 0 }) });
    const { container, rerender } = render(
      <ReachCheckLine messageId={MSG} isOwn identityId={ID} />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<ReachCheckLine messageId={MSG} isOwn identityId={ID} failed />);
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => {
      expect(useReachCheckStore.getState().entryFor(ID, MSG)).toBeUndefined();
    });
  });

  it('shows waiting before any observer has reported', () => {
    startEntry({ session: session({ status: 'waiting', observedCount: 0 }) });
    render(<ReachCheckLine messageId={MSG} isOwn identityId={ID} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reach check: waiting for observers');
  });

  it('shows observers, repeaters and the farthest distance', () => {
    startEntry();
    render(<ReachCheckLine messageId={MSG} isOwn identityId={ID} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reach check: 7 of 10 observers, 3 repeaters, farthest 84 mi',
    );
  });

  it('uses singular forms and leaves out what the server did not report', () => {
    startEntry({
      session: session({ observedCount: 1, expectedCount: 1, repeaterCount: 1, distanceText: '' }),
    });
    render(<ReachCheckLine messageId={MSG} isOwn identityId={ID} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reach check: 1 of 1 observer, 1 repeater',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('farthest');
  });

  it('says finished once the code has expired', () => {
    startEntry({ state: 'finished' });
    render(<ReachCheckLine messageId={MSG} isOwn identityId={ID} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reach check finished: 7 of 10 observers, 3 repeaters, farthest 84 mi',
    );
  });

  it('says no observers heard it when it finished without any', () => {
    startEntry({ state: 'finished', session: session({ status: 'expired', observedCount: 0 }) });
    render(<ReachCheckLine messageId={MSG} isOwn identityId={ID} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reach check finished: no observers heard it',
    );
  });

  it('says when the server no longer has the results, without a link', () => {
    startEntry({ state: 'gone' });
    render(<ReachCheckLine messageId={MSG} isOwn identityId={ID} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reach check: results no longer on the server',
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says when the server cannot be reached', () => {
    startEntry({ state: 'error', error: 'network' });
    render(<ReachCheckLine messageId={MSG} isOwn identityId={ID} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reach check: server not reachable');
  });

  it('links Full results to the configured origin plus the share path', () => {
    startEntry();
    render(<ReachCheckLine messageId={MSG} isOwn identityId={ID} />);
    const link = screen.getByRole('link', { name: 'Full results' });
    expect(link).toHaveAttribute('href', 'https://rangecheck.example.org/share/s1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('has no axe violations', async () => {
    startEntry();
    const { container } = render(<ReachCheckLine messageId={MSG} isOwn identityId={ID} />);
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
