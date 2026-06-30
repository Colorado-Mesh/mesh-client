import type { MessageTransport } from '@/renderer/stores/messageStore';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

/** Sidecar session lifecycle API registered by the Reticulum runtime mount. */
export interface ReticulumSessionApi {
  connect: () => Promise<void>;
  connectAutomatic: () => Promise<void>;
  disconnect: () => Promise<void>;
  finalizeDriverDisconnect: () => Promise<void>;
  selfNodeId: string | number | null;
  getFullNodeLabel: (nodeId: number) => string;
  sendMessage: ReticulumSendMessageFn;
  sendAttachment?: (file: File, to: number | string) => Promise<void>;
  sendReaction?: (glyph: string, replyId: number, channel: number) => Promise<void>;
  handleSidecarEvent?: (event: ReticulumSidecarEvent) => void;
  resolveOutboundVia?: (destinationHash: string) => MessageTransport;
}

let activeSession: ReticulumSessionApi | null = null;

export function registerReticulumSession(api: ReticulumSessionApi | null): void {
  activeSession = api;
}

export function getReticulumSession(): ReticulumSessionApi {
  if (!activeSession) {
    throw new Error('[reticulumSession] Reticulum runtime is not mounted');
  }
  return activeSession;
}

export function tryGetReticulumSession(): ReticulumSessionApi | null {
  return activeSession;
}

/** Typed send helper — ProtocolRuntime declares sendMessage as `never[]` for cross-protocol surface. */
export type ReticulumSendMessageFn = (
  text: string,
  to: number | string,
  replyToHash?: string,
  pendingId?: string,
) => Promise<void>;

export function getReticulumSendMessage(
  session: ReticulumSessionApi | null,
): ReticulumSendMessageFn | null {
  if (!session) return null;
  return session.sendMessage;
}

export function resolveReticulumOutboundVia(destinationHash: string): MessageTransport {
  return activeSession?.resolveOutboundVia?.(destinationHash) ?? 'network';
}

/** @deprecated Use registerReticulumSession from useReticulumRuntime mount */
export function bindReticulumSession(runtime: {
  sendMessage: ReticulumSendMessageFn;
  selfNodeId: string | number | null;
  getFullNodeLabel: (nodeId: number) => string;
  connect: () => Promise<void>;
  connectAutomatic: () => Promise<void>;
  disconnect: () => Promise<void>;
  finalizeDriverDisconnect?: () => Promise<void>;
  sendAttachment?: (file: File, to: number | string) => Promise<void>;
  sendReaction?: (glyph: string, replyId: number, channel: number) => Promise<void>;
  handleSidecarEvent?: ReticulumSessionApi['handleSidecarEvent'];
  resolveOutboundVia?: (destinationHash: string) => MessageTransport;
}): void {
  registerReticulumSession({
    ...runtime,
    finalizeDriverDisconnect: runtime.finalizeDriverDisconnect ?? runtime.disconnect,
  });
}
