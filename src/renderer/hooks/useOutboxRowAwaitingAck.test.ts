import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetOutboxRowSendStateForTests, setOutboxRowAwaitingAck } from '../lib/chatOutboxDrain';
import { useOutboxRowAwaitingAck } from './useOutboxRowAwaitingAck';

describe('useOutboxRowAwaitingAck', () => {
  beforeEach(() => {
    resetOutboxRowSendStateForTests();
  });

  it('is false for a row that is not awaiting an ACK', () => {
    const { result } = renderHook(() => useOutboxRowAwaitingAck(7));
    expect(result.current).toBe(false);
  });

  it('becomes true when the drain starts waiting and false once acknowledged', () => {
    const { result } = renderHook(() => useOutboxRowAwaitingAck(7));
    act(() => {
      setOutboxRowAwaitingAck(7, true);
    });
    expect(result.current).toBe(true);
    act(() => {
      setOutboxRowAwaitingAck(7, false);
    });
    expect(result.current).toBe(false);
  });

  it('tracks each row independently', () => {
    const first = renderHook(() => useOutboxRowAwaitingAck(1));
    const second = renderHook(() => useOutboxRowAwaitingAck(2));
    act(() => {
      setOutboxRowAwaitingAck(1, true);
    });
    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(false);
  });

  it('picks up state for a row that was already waiting', () => {
    setOutboxRowAwaitingAck(3, true);
    const { result } = renderHook(() => useOutboxRowAwaitingAck(3));
    expect(result.current).toBe(true);
  });
});
