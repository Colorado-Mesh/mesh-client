import { app, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';

import { RENDERER_HOST, RENDERER_SCHEME } from '@/shared/rendererOrigin';

const suspendedSenders = new WeakSet<WebContents>();

/** Fence queued renderer writes while explicit data reset unloads the old document. */
export function suspendIpcSender(sender: WebContents): () => void {
  suspendedSenders.add(sender);
  return () => suspendedSenders.delete(sender);
}

/** Validate IPC sender origin to prevent untrusted renderers from invoking privileged handlers. */
export function validateIpcSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  if (suspendedSenders.has(event.sender)) return false;
  const frame = event.senderFrame;
  if (!frame) return false;
  try {
    if (
      frame.detached ||
      event.processId !== frame.processId ||
      event.frameId !== frame.routingId
    ) {
      return false;
    }
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
