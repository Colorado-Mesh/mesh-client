import type { SupportBundleMode } from '@/shared/support-bundle.types';

import { sampleCoiMemoryNow } from './coiMemorySampler';
import { buildDebugSnapshotAsync } from './debugSnapshot';

export async function exportSupportBundleToDisk(mode: SupportBundleMode): Promise<string | null> {
  await sampleCoiMemoryNow();
  const json = JSON.stringify(await buildDebugSnapshotAsync(), null, 2);
  return window.electronAPI.support.exportBundle(mode, json);
}
