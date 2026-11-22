import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockConsoleWarn } from '../lib/vitestConsoleMock';
import { useFirstRunWizardStore } from '../stores/firstRunWizardStore';
import { useFirstRunWizardLauncher } from './useFirstRunWizardLauncher';

interface ApiWindow {
  electronAPI?: { db?: { wasCreatedThisLaunch?: () => Promise<unknown> } };
}

const setBridge = (fn: (() => Promise<unknown>) | undefined) => {
  (window as unknown as ApiWindow).electronAPI = fn ? { db: { wasCreatedThisLaunch: fn } } : {};
};

describe('useFirstRunWizardLauncher', () => {
  const original = (window as unknown as ApiWindow).electronAPI;

  beforeEach(() => {
    localStorage.clear();
    useFirstRunWizardStore.setState({
      status: 'unseen',
      pickerOpen: false,
      tour: null,
      tourStep: 0,
    });
  });

  afterEach(() => {
    (window as unknown as ApiWindow).electronAPI = original;
  });

  it('opens the picker on a fresh install', async () => {
    setBridge(() => Promise.resolve(true));
    renderHook(() => {
      useFirstRunWizardLauncher();
    });
    await waitFor(() => {
      expect(useFirstRunWizardStore.getState().pickerOpen).toBe(true);
    });
    expect(useFirstRunWizardStore.getState().status).toBe('pending');
  });

  it('leaves an existing install alone', async () => {
    const ask = vi.fn(() => Promise.resolve(false));
    setBridge(ask);
    renderHook(() => {
      useFirstRunWizardLauncher();
    });
    await waitFor(() => {
      expect(ask).toHaveBeenCalled();
    });
    expect(useFirstRunWizardStore.getState()).toMatchObject({
      status: 'unseen',
      pickerOpen: false,
    });
  });

  it('reopens a pending wizard without asking the database', () => {
    const ask = vi.fn(() => Promise.resolve(false));
    setBridge(ask);
    useFirstRunWizardStore.setState({ status: 'pending' });
    renderHook(() => {
      useFirstRunWizardLauncher();
    });
    expect(useFirstRunWizardStore.getState().pickerOpen).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('never opens once done, even on a fresh database', async () => {
    const ask = vi.fn(() => Promise.resolve(true));
    setBridge(ask);
    useFirstRunWizardStore.setState({ status: 'done' });
    renderHook(() => {
      useFirstRunWizardLauncher();
    });
    await waitFor(() => {
      expect(ask).toHaveBeenCalled();
    });
    expect(useFirstRunWizardStore.getState().pickerOpen).toBe(false);
  });

  it('treats a missing bridge as an existing install', () => {
    setBridge(undefined);
    renderHook(() => {
      useFirstRunWizardLauncher();
    });
    expect(useFirstRunWizardStore.getState().pickerOpen).toBe(false);
  });

  it('retries once and fails open when the check keeps failing', async () => {
    const warn = mockConsoleWarn();
    const ask = vi
      .fn()
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockRejectedValueOnce(new Error('ipc down'));
    setBridge(ask);
    renderHook(() => {
      useFirstRunWizardLauncher();
    });
    await waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(useFirstRunWizardStore.getState().pickerOpen).toBe(true);
    });
    expect(useFirstRunWizardStore.getState().status).toBe('pending');
    expect(warn.spy).toHaveBeenCalled();
    warn.restore();
  });

  it('opens pending after hydration when persisted status was pending', async () => {
    setBridge(undefined);
    localStorage.setItem(
      'mesh-client:firstRunWizard',
      JSON.stringify({ state: { status: 'pending' }, version: 0 }),
    );
    await useFirstRunWizardStore.persist.rehydrate();
    renderHook(() => {
      useFirstRunWizardLauncher();
    });
    await waitFor(() => {
      expect(useFirstRunWizardStore.getState().pickerOpen).toBe(true);
    });
  });
});
