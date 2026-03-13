// ─── Worker IPC types ────────────────────────────────────────────────────────

export type WorkerCommand = EncodeMessageCommand;

export interface EncodeMessageCommand {
  type: 'ENCODE_MESSAGE';
  id: number;
  text: string;
  channel: number;
  from: number;
  dest: number;
  replyId?: number;
}

export type WorkerEvent = EncodedEvent | WorkerErrorEvent;

export interface EncodedEvent {
  type: 'ENCODED';
  id: number;
  buffer: ArrayBuffer;
}

export interface WorkerErrorEvent {
  type: 'ERROR';
  id: number;
  error: string;
}

// ─── TransportManager event types ────────────────────────────────────────────

export type TransportName = 'device' | 'mqtt';
export type TransportStatus = 'sending' | 'acked' | 'failed';

export interface StatusUpdateEvent {
  tempId: number;
  transport: TransportName;
  status: TransportStatus;
  /** Final packet ID assigned by the transport (replaces tempId key) */
  finalPacketId?: number;
  error?: string;
}
