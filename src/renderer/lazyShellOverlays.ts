import { lazy } from 'react';

/** App-shell overlays/dialogs kept out of the App entry chunk (1000 kB budget). */

export const AppAboutSection = lazy(() =>
  import('./components/AppAboutSection').then((m) => ({ default: m.AppAboutSection })),
);

export const ConfigureNodeSelector = lazy(() => import('./components/ConfigureNodeSelector'));

export const GlobalMessageSearchDialog = lazy(() =>
  import('./components/GlobalMessageSearchDialog').then((m) => ({
    default: m.GlobalMessageSearchDialog,
  })),
);

export const KeyVerificationDialog = lazy(() =>
  import('./components/KeyVerificationDialog').then((m) => ({ default: m.KeyVerificationDialog })),
);

export const PanelLauncher = lazy(() =>
  import('./components/shell/PanelLauncher').then((m) => ({ default: m.PanelLauncher })),
);

export const RncpEnableRequestModal = lazy(() =>
  import('./components/remote/RncpEnableRequestModal').then((m) => ({
    default: m.RncpEnableRequestModal,
  })),
);

export const ReticulumVoiceOverlay = lazy(() =>
  import('./components/reticulum/ReticulumVoiceOverlay').then((m) => ({
    default: m.ReticulumVoiceOverlay,
  })),
);

export const StartupLocationPrompt = lazy(() => import('./components/StartupLocationPrompt'));

export const UnifiedInboxDialog = lazy(() =>
  import('./components/UnifiedInboxDialog').then((m) => ({ default: m.UnifiedInboxDialog })),
);
