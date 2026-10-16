import type { AiSummaryMessage, AiSummaryRequest } from './ai-types';

export interface AiHistoryMessage extends AiSummaryMessage {
  /** Local identity for channel visibility filters; never part of the model prompt. */
  senderId?: number | null;
}

export interface AiHistoryQuery {
  protocol: AiSummaryRequest['protocol'];
  surface: AiSummaryRequest['surface'];
  sinceMs: number;
  untilMs: number;
  channel?: number;
  peerId?: number;
  ownNodeIds?: number[];
  identityId?: string;
  peerHash?: string;
  roomServerId?: number;
  hubHash?: string;
  room?: string;
  radioNodeId?: number;
  channelKey?: string;
}
