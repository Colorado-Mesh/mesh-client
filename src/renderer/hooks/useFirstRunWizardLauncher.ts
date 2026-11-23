import { useEffect } from 'react';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import { shouldOpenFirstRunPicker } from '../lib/firstRunWizard';
import { useFirstRunWizardStore } from '../stores/firstRunWizardStore';

const FRESH_INSTALL_IPC_RETRIES = 1;

async function wasDatabaseCreatedThisLaunch(ask: () => Promise<unknown>): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= FRESH_INSTALL_IPC_RETRIES; attempt += 1) {
    try {
      return await ask();
    } catch (err) {
      console.debug('[renderer/hooks/useFirstRunWizardLauncher] catch:', err);

      lastErr = err;
    }
  }
  throw lastErr;
}

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

    const run = () => {
      if (useFirstRunWizardStore.getState().status === 'pending') {
        decide(false);
        return;
      }
      const ask = window.electronAPI?.db?.wasCreatedThisLaunch;
      if (typeof ask !== 'function') return;
      void wasDatabaseCreatedThisLaunch(ask)
        .then(decide)
        .catch((err: unknown) => {
          console.warn(
            'mcL0745 [FirstRunWizard] fresh-install check failed ' + errLikeToLogString(err),
          );
          if (cancelled) return;
          if (useFirstRunWizardStore.getState().status !== 'unseen') return;
          // IPC failed after retry — fail open so onboarding is not permanently skipped.
          decide(true);
        });
    };

    let unsubHydration: (() => void) | undefined;
    if (useFirstRunWizardStore.persist.hasHydrated()) {
      run();
    } else {
      unsubHydration = useFirstRunWizardStore.persist.onFinishHydration(run);
    }

    return () => {
      cancelled = true;
      unsubHydration?.();
    };
  }, []);
}
