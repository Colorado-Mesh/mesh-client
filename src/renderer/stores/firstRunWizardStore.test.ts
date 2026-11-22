import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FIRST_RUN_WIZARD_STORAGE_KEY } from '@/renderer/lib/firstRunWizard';
import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

import { useFirstRunWizardStore } from './firstRunWizardStore';

const reset = () => {
  useFirstRunWizardStore.setState({
    status: 'unseen',
    pickerOpen: false,
    tour: null,
    tourStep: 0,
  });
};

describe('first-run wizard store', () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  it('marks the wizard pending when the picker opens, and persists only the status', () => {
    useFirstRunWizardStore.getState().openPicker();
    expect(useFirstRunWizardStore.getState().pickerOpen).toBe(true);
    const saved = JSON.parse(localStorage.getItem(FIRST_RUN_WIZARD_STORAGE_KEY)!);
    expect(saved.state).toEqual({ status: 'pending' });
  });

  it('does not reopen once done', () => {
    useFirstRunWizardStore.setState({ status: 'done' });
    useFirstRunWizardStore.getState().openPicker();
    expect(useFirstRunWizardStore.getState().pickerOpen).toBe(false);
  });

  it('skip closes the picker for good', () => {
    const store = useFirstRunWizardStore;
    store.getState().openPicker();
    store.getState().skip();
    expect(store.getState()).toMatchObject({ status: 'done', pickerOpen: false, tour: null });
  });

  it('walks the tour step by step and ends after the last one', () => {
    const store = useFirstRunWizardStore;
    store.getState().openPicker();
    store.getState().startTour(['meshtastic', 'reticulum']);
    expect(store.getState()).toMatchObject({
      status: 'done',
      pickerOpen: false,
      tour: ['meshtastic', 'reticulum'],
      tourStep: 0,
    });
    store.getState().nextTourStep();
    expect(store.getState().tourStep).toBe(1);
    store.getState().nextTourStep();
    expect(store.getState().tour).toBeNull();
  });

  it('endTour stops the tour at any step', () => {
    const store = useFirstRunWizardStore;
    store.getState().startTour(['meshtastic', 'meshcore', 'reticulum']);
    store.getState().nextTourStep();
    store.getState().endTour();
    expect(store.getState()).toMatchObject({ tour: null, tourStep: 0 });
  });

  it('recovers defaults when persisted JSON is malformed and still completes hydration', async () => {
    const warn = mockConsoleWarn();
    localStorage.setItem(FIRST_RUN_WIZARD_STORAGE_KEY, '{not-json');
    await useFirstRunWizardStore.persist.rehydrate();
    expect(useFirstRunWizardStore.getState().status).toBe('unseen');
    expect(useFirstRunWizardStore.persist.hasHydrated()).toBe(true);
    expect(localStorage.getItem(FIRST_RUN_WIZARD_STORAGE_KEY)).toBeNull();
    expect(warn.spy).toHaveBeenCalled();
    warn.restore();
  });

  it('restores a pending status after restart without restoring an open picker or tour', async () => {
    const store = useFirstRunWizardStore;
    store.getState().openPicker();
    const saved = localStorage.getItem(FIRST_RUN_WIZARD_STORAGE_KEY)!;
    reset();
    localStorage.setItem(FIRST_RUN_WIZARD_STORAGE_KEY, saved);
    await store.persist.rehydrate();
    expect(store.getState()).toMatchObject({ status: 'pending', pickerOpen: false, tour: null });
  });
});
