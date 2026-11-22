import { useEffect } from 'react';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import { shouldOpenFirstRunPicker } from '../lib/firstRunWizard';
import { useFirstRunWizardStore } from '../stores/firstRunWizardStore';

/**
 * Opens the first-run protocol picker once per launch when this is a fresh install (the main
 * process created the database this launch) or an earlier launch quit on the picker.
 * A failed or missing bridge counts as an existing install, so the picker never blocks startup.
 */
export function useFirstRunWizardLauncher(): void {
  useEffect(() => {
    let cancelled = false;
    const decide = (databaseCreated: unknown) => {
      if (cancelled) return;
      const { status, openPicker } = useFirstRunWizardStore.getState();
      if (shouldOpenFirstRunPicker(status, databaseCreated)) openPicker();
    };
    if (useFirstRunWizardStore.getState().status === 'pending') {
      decide(false);
      return () => {
        cancelled = true;
      };
    }
    const ask = window.electronAPI?.db?.wasCreatedThisLaunch;
    if (typeof ask !== 'function') return;
    void Promise.resolve()
      .then(() => ask())
      .then(decide)
      .catch((err: unknown) => {
        console.warn('[FirstRunWizard] fresh-install check failed ' + errLikeToLogString(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);
}
