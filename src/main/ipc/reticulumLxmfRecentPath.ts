/** Path-only match for LXMF recent catch-up (query string ignored). */
export function isLxmfRecentApiPath(apiPath: string): boolean {
  const pathOnly = apiPath.split('?', 1)[0] ?? apiPath;
  return pathOnly === '/api/v1/lxmf/recent';
}
