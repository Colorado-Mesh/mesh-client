import { RETICULUM_LXMF_RECENT_API_PATH } from '../../shared/reticulumApiPaths';

/** Path-only match for LXMF recent catch-up (query string ignored). */
export function isLxmfRecentApiPath(apiPath: string): boolean {
  const pathOnly = apiPath.split('?', 1)[0] ?? apiPath;
  return pathOnly === RETICULUM_LXMF_RECENT_API_PATH;
}
