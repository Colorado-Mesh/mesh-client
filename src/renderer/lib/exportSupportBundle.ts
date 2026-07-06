import type { SupportBundleMode } from '@/shared/support-bundle.types';

import { buildDebugSnapshotAsync } from './debugSnapshot';

export async function exportSupportBundleToDisk(mode: SupportBundleMode): Promise<string | null> {
  const json = JSON.stringify(await buildDebugSnapshotAsync(), null, 2);
  return window.electronAPI.support.exportBundle(mode, json);
}
