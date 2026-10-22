import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { CoiMemorySnapshot } from '@/renderer/lib/coiMemorySampler';
import i18n from '@/renderer/lib/i18n';

import { AppSupportSection } from './AppSupportSection';

const memory = vi.hoisted(() => {
  const snapshot: CoiMemorySnapshot = {
    crossOriginIsolated: true,
    supported: true,
    sampling: false,
    failed: false,
    samples: [],
  };
  return { snapshot, listeners: new Set<() => void>(), sampleNow: vi.fn() };
});

vi.mock('@/renderer/lib/coiMemorySampler', () => ({
  getCoiMemorySnapshot: () => memory.snapshot,
  subscribeCoiMemorySnapshot: (listener: () => void) => {
    memory.listeners.add(listener);
    return () => memory.listeners.delete(listener);
  },
  sampleCoiMemoryNow: memory.sampleNow,
}));

function updateMemory(next: Partial<CoiMemorySnapshot>) {
  act(() => {
    memory.snapshot = { ...memory.snapshot, ...next };
    memory.listeners.forEach((listener) => {
      listener();
    });
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  memory.snapshot = {
    crossOriginIsolated: true,
    supported: true,
    sampling: false,
    failed: false,
    samples: [],
  };
  memory.sampleNow.mockReset();
  memory.sampleNow.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  expect(memory.listeners.size).toBe(0);
});

describe('App Support memory diagnostics', () => {
  it('shows an empty state, samples manually, and renders published results', () => {
    render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    expect(screen.getByText(/No samples yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sample now' }));
    expect(memory.sampleNow).toHaveBeenCalledTimes(1);
    updateMemory({ sampling: true });
    expect(screen.getByRole('button', { name: 'Sample now' })).toBeDisabled();
    expect(screen.getByText('Sampling…')).toBeInTheDocument();
    updateMemory({
      sampling: false,
      samples: [
        { at: 1_000, bytes: 10_000_000 },
        { at: 2_000, bytes: 12_000_000 },
      ],
    });
    expect(screen.getByRole('status')).toHaveTextContent('Latest estimate: 12 MB');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Sample now' })).toBeEnabled();
  });

  it.each([
    [{ crossOriginIsolated: false }, /requires cross-origin isolation/],
    [{ supported: false }, /does not support memory sampling/],
  ] as const)('explains unavailable sampling: %j', (state, explanation) => {
    memory.snapshot = { ...memory.snapshot, ...state };
    render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    expect(screen.getByText(explanation)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sample now' })).toBeDisabled();
  });

  it('shows an actionable failure while preserving the sample history', () => {
    memory.snapshot = {
      ...memory.snapshot,
      failed: true,
      samples: [{ at: 1_000, bytes: 10_000_000 }],
    };
    render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Memory sampling failed');
    expect(screen.getByText('10 MB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sample now' })).toBeEnabled();
  });

  it('keeps both support export actions and disables them during export', () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<AppSupportSection exporting={null} onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export support bundle for GitHub' }));
    expect(onExport).toHaveBeenLastCalledWith('github');
    fireEvent.click(screen.getByRole('button', { name: 'Export support bundle for developer' }));
    expect(onExport).toHaveBeenLastCalledWith('developer');
    rerender(<AppSupportSection exporting="github" onExport={onExport} />);
    expect(screen.getByRole('button', { name: 'Export support bundle for GitHub' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Export support bundle for developer' }),
    ).toBeDisabled();
  });

  it.each([false, true])('has no axe violations with isolation %s', async (isolated) => {
    memory.snapshot = {
      ...memory.snapshot,
      crossOriginIsolated: isolated,
      samples: isolated
        ? [
            { at: 1_000, bytes: 10_000_000 },
            { at: 2_000, bytes: 12_000_000 },
          ]
        : [],
    };
    const { container } = render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
