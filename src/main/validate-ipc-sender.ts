import { app, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';

import { RENDERER_HOST, RENDERER_SCHEME } from '@/shared/rendererOrigin';

/** Validate IPC sender origin to prevent untrusted renderers from invoking privileged handlers. */
export function validateIpcSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  try {
    const url = new URL(frame.url);
    const isRendererOrigin =
      url.protocol === `${RENDERER_SCHEME}:` &&
      url.hostname === RENDERER_HOST &&
      url.port === '' &&
      url.username === '' &&
      url.password === '';
    const isDev = !app.isPackaged;
    if (isDev) {
      return (
        url.protocol === 'file:' ||
        isRendererOrigin ||
        (url.protocol === 'http:' &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) ||
        (url.protocol === 'https:' &&
          (url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === '[::1]'))
      );
    }
    return url.protocol === 'file:' || isRendererOrigin;
  } catch {
    // catch-no-log-ok invalid URL in frame is expected; treat as untrusted
    return false;
  }
}

export function assertIpcSender(event: IpcMainInvokeEvent | IpcMainEvent, channel: string): void {
  if (!validateIpcSender(event)) {
    throw new Error(`${channel}: unauthorized sender`);
  }
}
