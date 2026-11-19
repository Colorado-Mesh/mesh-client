/**
 * Regression: while the destination protocol commit is deferred, the rail keeps
 * the optimistic selection; re-selecting that displayed protocol is a no-op and
 * must not clear a still-pending target. A newer pending target survives when an
 * older commit finishes.
 */
/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, useTransition } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPendingProtocolSelection,
  resetProtocolSwitchUiForTests,
  setPendingProtocolSelection,
} from '@/renderer/lib/protocolSwitchUiStore';
import type { MeshProtocol } from '@/renderer/lib/types';

import { ProtocolSwitcher } from './ProtocolSwitcher';

const deferredCommits: (() => void)[] = [];

vi.mock('react', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const React = await importOriginal<typeof import('react')>();
  return {
    ...React,
    useTransition: () =>
      [
        deferredCommits.length > 0,
        (cb: () => void) => {
          deferredCommits.push(cb);
        },
      ] as const,
  };
});

function PendingCommitHarness() {
  const [protocol, setProtocol] = useState<MeshProtocol>('meshtastic');
  const [, startTransition] = useTransition();

  const onProtocolChange = (newProtocol: MeshProtocol) => {
    const pending = getPendingProtocolSelection();
    if (newProtocol === pending) return;
    if (newProtocol === protocol) {
      if (pending == null) return;
      setPendingProtocolSelection(null);
      startTransition(() => {
        setProtocol(protocol);
        if (getPendingProtocolSelection() === null) {
          setPendingProtocolSelection(null);
        }
      });
      return;
    }
    setPendingProtocolSelection(newProtocol);
    startTransition(() => {
      setProtocol(newProtocol);
      if (getPendingProtocolSelection() === newProtocol) {
        setPendingProtocolSelection(null);
      }
    });
  };

  return (
    <ProtocolSwitcher
      followPendingSelection
      protocol={protocol}
      unreadByProtocol={{ meshtastic: 0, meshcore: 0, reticulum: 0 }}
      onProtocolChange={onProtocolChange}
    />
  );
}

describe('ProtocolSwitcher pending commit (deferred transition)', () => {
  beforeEach(() => {
    deferredCommits.length = 0;
    resetProtocolSwitchUiForTests();
  });

  afterEach(() => {
    deferredCommits.length = 0;
    resetProtocolSwitchUiForTests();
  });

  it('keeps optimistic selection while commit is unfinished; re-select is a no-op', async () => {
    const user = userEvent.setup();
    render(<PendingCommitHarness />);

    await user.click(screen.getByRole('radio', { name: 'Switch to Reticulum' }));
    expect(getPendingProtocolSelection()).toBe('reticulum');
    expect(deferredCommits).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Switch to Reticulum' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(screen.getByRole('radio', { name: 'Switch to Reticulum' }));
    expect(getPendingProtocolSelection()).toBe('reticulum');
    expect(deferredCommits).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Switch to Reticulum' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('preserves a newer pending target when an older deferred commit runs', async () => {
    const user = userEvent.setup();
    render(<PendingCommitHarness />);

    await user.click(screen.getByRole('radio', { name: 'Switch to Reticulum' }));
    await user.click(screen.getByRole('radio', { name: 'Switch to MeshCore' }));
    expect(getPendingProtocolSelection()).toBe('meshcore');
    expect(deferredCommits).toHaveLength(2);

    act(() => {
      deferredCommits.shift()?.();
    });
    expect(getPendingProtocolSelection()).toBe('meshcore');
    expect(screen.getByRole('radio', { name: 'Switch to MeshCore' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    act(() => {
      deferredCommits.shift()?.();
    });
    expect(getPendingProtocolSelection()).toBeNull();
    expect(screen.getByRole('radio', { name: 'Switch to MeshCore' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
