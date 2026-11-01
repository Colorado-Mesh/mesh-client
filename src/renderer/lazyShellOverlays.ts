/** App-shell overlays/dialogs kept out of the App entry chunk (1000 kB budget). */

export function loadAppAboutSection() {
  return import('./components/AppAboutSection').then((m) => ({ default: m.AppAboutSection }));
}

export function loadConfigureNodeSelector() {
  return import('./components/ConfigureNodeSelector');
}

export function loadGlobalMessageSearchDialog() {
  return import('./components/GlobalMessageSearchDialog').then((m) => ({
    default: m.GlobalMessageSearchDialog,
  }));
}

export function loadKeyVerificationDialog() {
  return import('./components/KeyVerificationDialog').then((m) => ({
    default: m.KeyVerificationDialog,
  }));
}

export function loadPanelLauncher() {
  return import('./components/shell/PanelLauncher').then((m) => ({ default: m.PanelLauncher }));
}

export function loadRncpEnableRequestModal() {
  return import('./components/remote/RncpEnableRequestModal').then((m) => ({
    default: m.RncpEnableRequestModal,
  }));
}

export function loadReticulumVoiceOverlay() {
  return import('./components/reticulum/ReticulumVoiceOverlay').then((m) => ({
    default: m.ReticulumVoiceOverlay,
  }));
}

export function loadStartupLocationPrompt() {
  return import('./components/StartupLocationPrompt');
}

export function loadUnifiedInboxDialog() {
  return import('./components/UnifiedInboxDialog').then((m) => ({
    default: m.UnifiedInboxDialog,
  }));
}
