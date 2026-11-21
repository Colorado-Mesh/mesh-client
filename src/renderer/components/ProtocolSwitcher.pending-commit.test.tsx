/**
 * Regression: while the destination protocol commit is held (Suspense), the rail
 * keeps the optimistic selection; re-selecting that displayed protocol is a no-op.
 * A newer pending target survives when an older held commit is released first.
 */
/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense, useEffect, useState, useTransition } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getPendingProtocolSelection,
  resetProtocolSwitchUiForTests,
  setPendingProtocolSelection,
} from '@/renderer/lib/protocolSwitchUiStore';
import type { MeshProtocol } from '@/renderer/lib/types';

import { ProtocolSwitcher } from './ProtocolSwitcher';

interface DestinationHold {
  promise: Promise<void> | null;
  release: (() => void) | null;
}

function createHold(): DestinationHold {
  const hold: DestinationHold = { promise: null, release: null };
  hold.promise = new Promise<void>((resolve) => {
    hold.release = () => {
      hold.promise = null;
      hold.release = null;
      resolve();
    };
  });
  return hold;
}

/** Suspends while `hold.promise` is set so the transition destination stays uncommitted. */
function DestinationGate({
  protocol,
  hold,
}: {
  protocol: MeshProtocol;
  hold: DestinationHold;
}): null {
  if (hold.promise != null && protocol !== 'meshtastic') {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Suspense gate
    throw hold.promise;
  }
  return null;
}

function PendingCommitHarness({ hold }: { hold: DestinationHold }) {
  const [protocol, setProtocol] = useState<MeshProtocol>('meshtastic');
  const [, startTransition] = useTransition();

  useEffect(() => {
    const pending = getPendingProtocolSelection();
    if (pending == null || pending !== protocol) return;
    setPendingProtocolSelection(null);
  }, [protocol]);

  const onProtocolChange = (newProtocol: MeshProtocol) => {
    const pending = getPendingProtocolSelection();
    if (newProtocol === pending) return;
    if (newProtocol === protocol) {
      if (pending == null) return;
      setPendingProtocolSelection(null);
      startTransition(() => {
        setProtocol(protocol);
      });
      return;
    }
    setPendingProtocolSelection(newProtocol);
    startTransition(() => {
      setProtocol(newProtocol);
    });
  };

  return (
    <>
      <ProtocolSwitcher
        followPendingSelection
        protocol={protocol}
        unreadByProtocol={{ meshtastic: 0, meshcore: 0, reticulum: 0, meshcom: 0 }}
        onProtocolChange={onProtocolChange}
      />
      <span data-testid="committed-protocol">{protocol}</span>
      <Suspense fallback={null}>
        <DestinationGate protocol={protocol} hold={hold} />
      </Suspense>
    </>
  );
}

describe('ProtocolSwitcher pending commit (held destination render)', () => {
  let hold: DestinationHold;

  beforeEach(() => {
    resetProtocolSwitchUiForTests();
    hold = createHold();
  });

  afterEach(() => {
    hold.release?.();
    resetProtocolSwitchUiForTests();
  });

  it('shows pending selection after the action while destination commit is held; re-select is a no-op', async () => {
    const user = userEvent.setup();
    render(<PendingCommitHarness hold={hold} />);

    await user.click(screen.getByRole('radio', { name: 'Switch to Reticulum' }));

    expect(getPendingProtocolSelection()).toBe('reticulum');
    expect(screen.getByTestId('committed-protocol')).toHaveTextContent('meshtastic');
    expect(screen.getByRole('radio', { name: 'Switch to Reticulum' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(screen.getByRole('radio', { name: 'Switch to Reticulum' }));
    expect(getPendingProtocolSelection()).toBe('reticulum');
    expect(screen.getByTestId('committed-protocol')).toHaveTextContent('meshtastic');

    await act(async () => {
      hold.release?.();
      await Promise.resolve();
    });
    expect(getPendingProtocolSelection()).toBeNull();
    expect(screen.getByTestId('committed-protocol')).toHaveTextContent('reticulum');
  });

  it('preserves a newer pending target when an older held commit is released first', async () => {
    const user = userEvent.setup();
    const firstHold = hold;
    render(<PendingCommitHarness hold={firstHold} />);

    await user.click(screen.getByRole('radio', { name: 'Switch to Reticulum' }));
    expect(getPendingProtocolSelection()).toBe('reticulum');
    expect(screen.getByTestId('committed-protocol')).toHaveTextContent('meshtastic');

    // Second click while first destination is still held — replace optimistic target.
    await user.click(screen.getByRole('radio', { name: 'Switch to MeshCore' }));
    expect(getPendingProtocolSelection()).toBe('meshcore');
    expect(screen.getByRole('radio', { name: 'Switch to MeshCore' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByTestId('committed-protocol')).toHaveTextContent('meshtastic');

    // Release the shared hold so transition destination(s) can commit.
    await act(async () => {
      firstHold.release?.();
      await Promise.resolve();
    });
    expect(getPendingProtocolSelection()).toBeNull();
    expect(screen.getByTestId('committed-protocol')).toHaveTextContent('meshcore');
    expect(screen.getByRole('radio', { name: 'Switch to MeshCore' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
