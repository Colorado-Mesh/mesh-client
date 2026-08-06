# Reticulum Games — Ratspeak parity checklist

Living matrix for [issue #773](https://github.com/Colorado-Mesh/mesh-client/issues/773). Wire protocol is [lrgp-rs](https://github.com/ratspeak/lrgp-rs) (LRGP v1). Product surface reference is Ratspeak:

- `crates/ratspeak-tauri/src/commands/games.rs`
- `dashboard/static/js/games_tab.js`

Update this file when Games PRs land. `pnpm run update` warns on new Ratspeak releases with stub-kind `games-parity`.

**Last review:** 2026-08-05 vs Ratspeak **v1.0.25** (release notes were protocol/LXMF/UI — no Games command surface changes). `lrgp-rs` floated at `0b55361` (`origin/main`).

Status: `done` | `partial` | `wontfix` | `todo`

## Commands / API

| Ratspeak command          | mesh-client                                           | Status | Notes                 |
| ------------------------- | ----------------------------------------------------- | ------ | --------------------- |
| `send_game_action`        | `POST /api/v1/games/action` + `reticulum:gamesAction` | done   | Direct-preferred send |
| `get_available_games`     | `GET /api/v1/games/apps`                              | done   |                       |
| `get_all_game_sessions`   | `GET /api/v1/games/sessions`                          | done   | optional `?peer=`     |
| `get_active_games`        | `GET /api/v1/games/sessions?peer=`                    | done   | peer filter           |
| `get_game_session_detail` | `GET /api/v1/games/sessions/:id`                      | done   |                       |
| `mark_game_read`          | `POST …/read`                                         | done   |                       |
| `delete_game_session`     | `DELETE …/:id`                                        | done   |                       |
| `resend_last_game_action` | `POST …/resend`                                       | done   | same envelope/nonce   |

## UI

| Ratspeak UI                         | mesh-client                               | Status  | Notes                                                                     |
| ----------------------------------- | ----------------------------------------- | ------- | ------------------------------------------------------------------------- |
| Games tab                           | Left-rail Games (`Gamepad2`)              | done    | Reticulum-only via `hasLrgpGames`                                         |
| Session list filters                | GamesPanel filters                        | done    |                                                                           |
| Unread badge                        | session unread + Games tab badge          | done    | sidebar red pill via `gamesUnread`                                        |
| TTT board                           | `TicTacToeBoard`                          | done    |                                                                           |
| Chess board                         | `ChessBoard`                              | done    |                                                                           |
| Challenge from contacts             | Peers / Chat DM Challenge                 | done    |                                                                           |
| Draw / resign                       | session actions                           | done    |                                                                           |
| Delivery state / resend             | resend IPC + UI                           | partial | Resend on `action_result` fail; no session `delivery_state` / LXMF bridge |
| Notification route `lrgp:<session>` | `lrgp:` + `lxm://game/<id>` → Games tab   | done    | `MeshClientDeepLinkHost` + `openReticulumGameSession`                     |
| Optimistic rollback UI              | session refresh on failed `action_result` | partial | Sidecar rollback; no client-side optimistic board backup                  |
| Win celebration                     | —                                         | wontfix | optional polish; not required for interop                                 |

## Wire interop

| Scenario                        | Status |
| ------------------------------- | ------ |
| mesh-client ↔ mesh-client TTT   | done   |
| mesh-client ↔ mesh-client Chess | done   |
| mesh-client ↔ Ratspeak TTT      | done   |
| mesh-client ↔ Ratspeak Chess    | done   |

Manual gold test: two clients on a TCP hub — challenge → accept → play → resign/draw.

## Remaining follow-ups

1. **Session `delivery_state`** — Ratspeak tracks `sending` / `propagating` / `failed` via LXMF outbound callbacks; mesh-client still gates resend mainly on WS `games.action_result`.
2. **Persist last outbound envelope** across sidecar restart (Ratspeak DB; mesh-client in-memory only).
3. Chess promotion picker / threefold–50-move claim UX (Ratspeak has; mesh-client auto-queen).
