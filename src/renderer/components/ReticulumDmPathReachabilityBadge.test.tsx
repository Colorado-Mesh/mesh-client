// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RETICULUM_DM_HEADER_ACTION_CLASS } from '@/renderer/lib/reticulumDmHeaderActions';

import {
  ReticulumDmPathActions,
  ReticulumDmPathReachabilityBadge,
} from './ReticulumDmPathReachabilityBadge';
import { ToastProvider } from './Toast';

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: vi.fn().mockResolvedValue(true),
  probeReticulumPeer: vi.fn(),
  requestReticulumPeerPath: vi.fn(),
  formatReticulumPeerPathToast: () => ({ message: 'ok', variant: 'success' as const }),
  formatReticulumPeerProbeToast: () => ({ message: 'ok', variant: 'success' as const }),
}));

vi.mock('@/renderer/stores/reticulumPeerStore', () => ({
  refreshReticulumPeersFromSidecar: vi.fn(),
  useReticulumPeerStore: { getState: () => ({ updatePeer: vi.fn() }) },
}));

function precedes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('ReticulumDmPathReachabilityBadge', () => {
  it('uses slate status chip tokens for reachable state', () => {
    render(<ReticulumDmPathReachabilityBadge status="reachable" hops={2} />);
    const badge = screen.getByRole('status', { name: 'Destination path is reachable' });
    expect(badge.className).toContain('bg-slate-800/60');
    expect(badge.className).toContain('rounded-lg');
  });
});

describe('ReticulumDmPathActions', () => {
  it('renders Probe before Path with shared cyan action class', () => {
    render(
      <ToastProvider>
        <ReticulumDmPathActions
          destinationHash={'a'.repeat(32)}
          status="reachable"
          onReprobe={vi.fn()}
          onProbeSettled={vi.fn()}
        />
      </ToastProvider>,
    );
    const probe = screen.getByRole('button', {
      name: 'Probe Reticulum path reachability for this destination',
    });
    const path = screen.getByRole('button', {
      name: 'Request Reticulum path to this destination',
    });
    expect(precedes(probe, path)).toBe(true);
    expect(probe.className).toBe(RETICULUM_DM_HEADER_ACTION_CLASS);
    expect(path.className).toBe(RETICULUM_DM_HEADER_ACTION_CLASS);
    expect(probe.className).toContain('text-cyan-400');
    expect(probe.className).not.toMatch(/border-gray-600/);
    expect(path.className).not.toMatch(/border-gray-600/);
  });

  it('keeps Probe before Path when unreachable', () => {
    render(
      <ToastProvider>
        <ReticulumDmPathActions
          destinationHash={'b'.repeat(32)}
          status="unreachable"
          onReprobe={vi.fn()}
          onProbeSettled={vi.fn()}
        />
      </ToastProvider>,
    );
    const probe = screen.getByRole('button', {
      name: 'Probe Reticulum path reachability for this destination',
    });
    const path = screen.getByRole('button', {
      name: 'Request Reticulum path to this destination',
    });
    expect(precedes(probe, path)).toBe(true);
  });
});
