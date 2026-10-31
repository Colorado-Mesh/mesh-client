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

function openMemoryDetails(container: HTMLElement) {
  const details = container.querySelector(
    'details[data-setting-anchor="app.support.rendererMemory"]',
  );
  expect(details).toBeInstanceOf(HTMLDetailsElement);
  expect((details as HTMLDetailsElement).open).toBe(false);
  (details as HTMLDetailsElement).open = true;
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
    const { container } = render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    openMemoryDetails(container);
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

  it('explains recovery mode when not isolated', () => {
    memory.snapshot = { ...memory.snapshot, crossOriginIsolated: false, supported: true };
    const { container } = render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    openMemoryDetails(container);
    expect(screen.getByText(/recovery mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sample now' })).toBeEnabled();
  });

  it('disables sampling when no API is available', () => {
    memory.snapshot = { ...memory.snapshot, supported: false };
    const { container } = render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    openMemoryDetails(container);
    expect(screen.getByText(/does not support memory sampling/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sample now' })).toBeDisabled();
  });

  it('shows an actionable failure while preserving the sample history', () => {
    memory.snapshot = {
      ...memory.snapshot,
      failed: true,
      samples: [{ at: 1_000, bytes: 10_000_000 }],
    };
    const { container } = render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    openMemoryDetails(container);
    expect(screen.getByRole('status')).toHaveTextContent('Memory sampling failed');
    expect(screen.getByText('10 MB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sample now' })).toBeEnabled();
  });

  it('labels process memory and excludes browser estimates from its trend and history', () => {
    memory.snapshot = {
      ...memory.snapshot,
      samples: [
        { at: 1000, bytes: 10_000_000 },
        { at: 2000, bytes: 120_000_000, source: 'renderer-process' },
      ],
    };
    const { container } = render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    openMemoryDetails(container);
    expect(screen.getByText(/Renderer process memory \(physical RAM\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Browser estimates/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Latest estimate: 120 MB');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('10 MB')).not.toBeInTheDocument();
    expect(container.querySelector('polyline')).not.toBeInTheDocument();
    updateMemory({
      samples: [
        ...memory.snapshot.samples,
        { at: 3000, bytes: 140_000_000, source: 'renderer-process' },
      ],
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(container.querySelector('polyline')).toHaveAttribute('points', '0,10 300,4');
  });

  it('shows JS heap, deltas, and breaks the sparkline across long gaps', () => {
    const hour = 3_600_000;
    memory.snapshot = {
      ...memory.snapshot,
      samples: [
        {
          at: 0,
          bytes: 100_000_000,
          source: 'renderer-process',
          jsHeapBytes: 40_000_000,
          domNodes: 1000,
        },
        {
          at: hour,
          bytes: 120_000_000,
          source: 'renderer-process',
          jsHeapBytes: 45_000_000,
          domNodes: 1100,
        },
        {
          at: 10 * hour,
          bytes: 200_000_000,
          source: 'renderer-process',
          jsHeapBytes: 50_000_000,
        },
        {
          at: 11 * hour,
          bytes: 180_000_000,
          source: 'renderer-process',
          jsHeapBytes: 48_000_000,
          domNodes: 1050,
        },
      ],
    };
    const { container } = render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    openMemoryDetails(container);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Latest estimate: 180 MB');
    expect(status).toHaveTextContent('JS heap: 48 MB');
    expect(status).toHaveTextContent('Working set Δ: −20 MB');
    expect(status).toHaveTextContent('JS heap Δ: −2 MB');
    expect(status).toHaveTextContent('DOM nodes: 1050');
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('keeps process sampling and its scope accessible', async () => {
    memory.snapshot = {
      ...memory.snapshot,
      samples: [{ at: 1000, bytes: 120_000_000, source: 'renderer-process' }],
    };
    const { container } = render(<AppSupportSection exporting={null} onExport={vi.fn()} />);
    openMemoryDetails(container);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps both support export actions and disables them during export', () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    const { container, rerender } = render(
      <AppSupportSection exporting={null} onExport={onExport} />,
    );
    const supportDetails = container.querySelector('details');
    expect(supportDetails).toBeInstanceOf(HTMLDetailsElement);
    supportDetails!.open = true;
    fireEvent.click(screen.getByRole('button', { name: 'Export support bundle for GitHub' }));
    expect(onExport).toHaveBeenLastCalledWith('github');
    fireEvent.click(screen.getByRole('button', { name: 'Export support bundle for developer' }));
    expect(onExport).toHaveBeenLastCalledWith('developer');
    rerender(<AppSupportSection exporting="github" onExport={onExport} />);
    const supportAfter = container.querySelector('details');
    if (supportAfter instanceof HTMLDetailsElement) supportAfter.open = true;
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
