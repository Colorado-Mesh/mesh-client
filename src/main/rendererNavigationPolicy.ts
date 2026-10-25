import { RENDERER_HOST, RENDERER_SCHEME } from '@/shared/rendererOrigin';

function hasCredentials(url: URL): boolean {
  return url.username !== '' || url.password !== '';
}

/** Compare against the URL chosen at startup, never a later document's URL. */
export function isAllowedRendererNavigation(rendererUrl: string, targetUrl: string): boolean {
  try {
    const renderer = new URL(rendererUrl);
    const target = new URL(targetUrl);
    if (hasCredentials(renderer) || hasCredentials(target)) return false;
    if (renderer.protocol !== target.protocol) return false;

    if (renderer.protocol === 'file:') {
      // file: has an opaque origin; another local HTML file must not inherit the bridge.
      return renderer.host === target.host && renderer.pathname === target.pathname;
    }

    if (renderer.protocol === `${RENDERER_SCHEME}:`) {
      // Node's URL.origin is "null" for custom schemes; compare the authority explicitly.
      return (
        renderer.hostname === RENDERER_HOST &&
        renderer.port === '' &&
        target.hostname === RENDERER_HOST &&
        target.port === ''
      );
    }

    if (renderer.protocol === 'http:' || renderer.protocol === 'https:') {
      return renderer.origin === target.origin;
    }
    return false;
  } catch {
    // catch-no-log-ok malformed navigation targets are untrusted.
    return false;
  }
}

export interface RendererPermissionContext {
  rendererUrl: string;
  requestingUrl?: string;
  requestingOrigin?: string;
  isMainFrame: boolean;
  sameWebContents: boolean;
}

/** A session-wide permission callback must attest both the frame and its document URL. */
export function isAllowedRendererPermission(context: RendererPermissionContext): boolean {
  if (
    !context.sameWebContents ||
    !context.isMainFrame ||
    !context.requestingUrl ||
    !isAllowedRendererNavigation(context.rendererUrl, context.requestingUrl)
  ) {
    return false;
  }
  if (context.requestingOrigin === undefined) return true;
  return isAllowedRendererDeviceOrigin(context.rendererUrl, context.requestingOrigin);
}

/**
 * Origin-only check for the device callback, which cannot identify the requesting frame.
 * Use only alongside the full serial permission check and guarded device selector.
 */
export function isAllowedRendererDeviceOrigin(
  rendererUrl: string,
  requestingOrigin: string,
): boolean {
  try {
    const renderer = new URL(rendererUrl);
    const origin = new URL(requestingOrigin);
    if (hasCredentials(origin) || origin.search || origin.hash) return false;
    if (origin.pathname !== '' && origin.pathname !== '/') return false;
    if (renderer.protocol === 'file:') {
      return origin.protocol === 'file:' && origin.host === renderer.host;
    }
    return isAllowedRendererNavigation(rendererUrl, requestingOrigin);
  } catch {
    // catch-no-log-ok opaque or malformed origins cannot establish device access.
    return false;
  }
}
