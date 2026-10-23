import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ENV_FORCE_FILE_ORIGIN,
  ENV_SKIP_ORIGIN_MIGRATION,
  RENDERER_SCHEME,
} from '../shared/rendererOrigin';

export type RendererLoadSource = 'env' | 'dist' | 'custom-protocol';

export interface ResolveRendererLoadUrlOptions {
  devServerUrl?: string;
  distIndexPath: string;
  customProtocolUrl?: string;
  migrationCompleted?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedRendererLoadUrl {
  url: string;
  openDevTools: boolean;
  source: RendererLoadSource;
}

/** The custom renderer scheme always uses the verified built-renderer startup path. */
export function normalizeDevServerUrl(devServerUrl?: string): string | undefined {
  if (!devServerUrl) return undefined;
  try {
    if (new URL(devServerUrl).protocol === `${RENDERER_SCHEME}:`) return undefined;
  } catch {
    // catch-no-log-ok preserve malformed overrides so loading reports the original invalid URL.
  }
  return devServerUrl;
}

/**
 * An explicit external dev/E2E URL selects that renderer. All other launches use the built
 * renderer and require verified migration before switching its origin, including `pnpm start`.
 */
export function resolveRendererLoadUrl(
  options: ResolveRendererLoadUrlOptions,
): ResolvedRendererLoadUrl {
  const env = options.env ?? process.env;
  const forceFile = env[ENV_FORCE_FILE_ORIGIN] === '1' || env[ENV_SKIP_ORIGIN_MIGRATION] === '1';
  const fileResult: ResolvedRendererLoadUrl = {
    url: pathToFileURL(path.resolve(options.distIndexPath)).toString(),
    openDevTools: false,
    source: 'dist',
  };

  // Recovery flags always retain the legacy origin, including with a dev-server override.
  if (forceFile) return fileResult;

  const devServerUrl = normalizeDevServerUrl(options.devServerUrl);
  if (devServerUrl) {
    return {
      url: devServerUrl,
      // E2E can explicitly load the production file without opening DevTools.
      openDevTools: !/^file:/i.test(devServerUrl),
      source: 'env',
    };
  }

  if (options.customProtocolUrl && options.migrationCompleted === true) {
    return {
      url: options.customProtocolUrl,
      openDevTools: false,
      source: 'custom-protocol',
    };
  }

  // Until the origin copy verifies, retain the historical origin and all its localStorage.
  return fileResult;
}
