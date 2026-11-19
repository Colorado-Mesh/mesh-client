import type { AiSummaryMessage, AiSummaryRequest } from './ai-types';

export interface AiHistoryMessage extends AiSummaryMessage {
  /** Row id for pagination cursors; never part of the model prompt. */
  id?: number;
  /** Local identity for channel visibility filters; never part of the model prompt. */
  senderId?: number | null;
  /** Arrival key, when the query set `byArrival`; never part of the model prompt. */
  order?: number;
}

export interface AiHistoryQuery {
  protocol: AiSummaryRequest['protocol'];
  surface: AiSummaryRequest['surface'];
  sinceMs: number;
  untilMs: number;
  /**
   * Page size (newest-first page). Defaults to AI_MAX_MESSAGES; main may return one extra
   * row to signal that older history remains.
   */
  limit?: number;
  /** Exclusive cursor: only rows older than (beforeAt, beforeId) in DESC order. */
  beforeAt?: number;
  beforeId?: number;
  /**
   * Range, order and cursor on the arrival key (`received_at`, or the sender's stamp for rows
   * saved before receipt times were kept) instead of the stamp; rows then carry `order`.
   */
  byArrival?: boolean;
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
