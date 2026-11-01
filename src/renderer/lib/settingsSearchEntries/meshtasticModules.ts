import type { SettingsSearchSurface } from '../settingsSearch';

/**
 * Meshtastic module-port surfaces (protocol exception: gated by capability flags, so MeshCore and
 * Reticulum never list them).
 */
export const meshtasticModulesSurface: SettingsSearchSurface = {
  entries: [
    {
      id: 'admin.remoteShell',
      slot: 'Admin',
      labelKey: 'remoteShell.title',
      keywords: ['shell', 'terminal', 'ssh', 'pty', 'console', 'command line'],
      visible: (ctx) => ctx.capabilities.hasRemoteShell,
    },
  ],
  // Not swept: the section's remaining keys are warning prose, status text and control labels.
  files: [{ path: 'src/renderer/components/MeshtasticRemoteShellSection.tsx' }],
  exempt: {},
};
