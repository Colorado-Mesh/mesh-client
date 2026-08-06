/** Shared LRGP games types (sidecar HTTP + WS ↔ renderer). */

export interface GamesStatusResponse {
  available: boolean;
  enabled: boolean;
  running?: boolean;
  reason?: string;
  apps?: GamesAppManifest[];
}

export interface GamesAppManifest {
  app_id: string;
  version: number;
  display_name: string;
  icon?: string;
  session_type?: string;
  max_players?: number;
  validation?: string;
  actions?: string[];
}

export interface GamesActionRequest {
  dest_hash: string;
  app_id: string;
  command: string;
  session_id?: string;
  payload?: Record<string, unknown>;
  delivery_method?: string;
}

export interface GamesActionResult {
  ok: boolean;
  session_id?: string;
  command?: string;
  msg_id?: string | null;
  reason?: string;
  error?: string;
}

export interface GamesOkResponse {
  ok: boolean;
  error?: string;
}

/** Known LRGP built-in app ids. */
export type GamesAppId = 'ttt' | 'chess';

/** Standard LRGP commands (mirrors `lrgp-rs` `constants.rs`). */
export const GAMES_CMD = {
  CHALLENGE: 'challenge',
  ACCEPT: 'accept',
  DECLINE: 'decline',
  MOVE: 'move',
  RESIGN: 'resign',
  DRAW_OFFER: 'draw_offer',
  DRAW_ACCEPT: 'draw_accept',
  DRAW_DECLINE: 'draw_decline',
} as const;

export type GamesCommand = (typeof GAMES_CMD)[keyof typeof GAMES_CMD];

export type GamesSessionStatus = 'pending' | 'active' | 'completed' | 'expired' | 'declined';

/** Sidecar overlay delivery state (Ratspeak-aligned LXMF outbound bridge). */
export type GamesDeliveryState =
  'idle' | 'pending' | 'sending' | 'propagating' | 'propagated' | 'delivered' | 'failed';

/** Chess FIDE draw-claim reason codes (`lrgp-rs` ChessApp `KEY_REASON`). */
export const GAMES_DRAW_CLAIM = {
  THREEFOLD: '3fr',
  FIFTY_MOVE: '50m',
} as const;

export type GamesDrawClaimReason = (typeof GAMES_DRAW_CLAIM)[keyof typeof GAMES_DRAW_CLAIM];

/** True when `delivery_state` means an outbound move is still in flight. */
export function isGamesDeliveryInFlight(state: string | undefined | null): boolean {
  return state === 'pending' || state === 'sending' || state === 'propagating';
}

/** `lrgp-rs` TicTacToeApp session metadata (see `session_to_json` in tictactoe.rs). */
export interface GamesTttMetadata {
  board: string;
  turn: string;
  first_turn: string;
  my_marker: string;
  move_count: number;
  winner: string;
  terminal: string;
  draw_offered: boolean;
}

/** `lrgp-rs` ChessApp session metadata (see `default_metadata` in chess.rs). */
export interface GamesChessMetadata {
  fen: string;
  moves: string[];
  my_color: string;
  first_turn: string;
  turn: string;
  move_count: number;
  winner: string;
  terminal: string;
  draw_offered: boolean;
  draw_offer_reason?: string;
  in_check: boolean;
  legal_moves: string[];
}

/** LRGP session record (`Session` struct in lrgp-rs `session.rs`), as JSON. */
export interface GameSession {
  session_id: string;
  identity_id: string;
  app_id: string;
  app_version: number;
  contact_hash: string;
  initiator: string;
  /** One of {@link GamesSessionStatus}; kept as `string` since the sidecar may add new values. */
  status: string;
  /**
   * Sidecar overlay LXMF delivery state (`sending` / `propagating` / `failed` / …).
   * Optional for older payloads; treated as idle when absent.
   */
  delivery_state?: string;
  metadata: Record<string, unknown>;
  unread: number;
  created_at: number;
  updated_at: number;
  last_action_at: number;
}

export interface GamesListSessionsResponse {
  sessions?: GameSession[];
  error?: string;
}

export interface GamesSessionDetailResponse {
  session?: GameSession | null;
  error?: string;
}

/** Payload for the LRGP `games.update` WS event. */
export interface GamesUpdateEventPayload {
  app_id: string;
  session_id: string;
  direction?: 'inbound' | 'outbound';
  session: GameSession | null;
  event?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

/** Payload for the LRGP `games.action_result` WS event. */
export interface GamesActionResultEventPayload {
  app_id: string;
  session_id: string;
  ok: boolean;
  error?: string;
}

/** Prefix for all dedicated games IPC (blocked on generic proxy). */
export const GAMES_API_PREFIX = '/api/v1/games/';

export function isGamesApiPath(apiPath: string): boolean {
  const q = apiPath.indexOf('?');
  const pathOnly = q >= 0 ? apiPath.slice(0, q) : apiPath;
  return pathOnly === '/api/v1/games' || pathOnly.startsWith(GAMES_API_PREFIX);
}

export function parseGamesActionRequest(opts: unknown): GamesActionRequest | { error: string } {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
    return { error: 'invalid_game_action' };
  }
  const o = opts as Record<string, unknown>;
  const destHash = o.dest_hash;
  const appId = o.app_id;
  const command = o.command;
  if (typeof destHash !== 'string' || destHash.length === 0) {
    return { error: 'invalid_dest_hash' };
  }
  if (typeof appId !== 'string' || appId.length === 0) {
    return { error: 'invalid_app_id' };
  }
  if (typeof command !== 'string' || command.length === 0) {
    return { error: 'invalid_command' };
  }
  const out: GamesActionRequest = {
    dest_hash: destHash,
    app_id: appId,
    command,
  };
  if (typeof o.session_id === 'string') {
    out.session_id = o.session_id;
  }
  if (o.payload != null && typeof o.payload === 'object' && !Array.isArray(o.payload)) {
    out.payload = o.payload as Record<string, unknown>;
  }
  if (typeof o.delivery_method === 'string') {
    out.delivery_method = o.delivery_method;
  }
  return out;
}
