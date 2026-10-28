# Discord feedback verification

Branch: `fix/radio-chat-setup`. Updated base: `4c70a754a96bc7bb8a0569455e239211efc343bf`
(v6.5.0 plus PR #1332). The upstream serial-error hints were preserved.

All three original image files were downloaded through Library and inspected locally before
implementation: IMG_0017.jpeg (BLE), IMG_0018.jpeg (radio chats and ordering), IMG_0019.jpeg
(location default). Their Library identities remain in the materialized file metadata.
No unrelated checkout, installed-app profile, live location preference or radio was changed.

## Behavior coverage

Automated tests and actual runtime exercise are separate evidence below. Runtime tests use
isolated temporary profiles, a synthetic TCP companion and the real Electron IPC/SDK/SQLite
path. macOS E2E uses Chromium's mock Keychain to avoid waiting on or accessing the user's native
Keychain. This is not physical radio or native credential-storage validation.

| Check                                                        | Implementation and verification                                                          | Result  | Evidence                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| MeshCore discovery without advertised NUS                    | Unfiltered MeshCore scan; fake manager scan/connect and real-backend filter unit test    | passed  | `gatt/manager.rs::scan_filters_by_mode`, `btleplug_backend.rs::meshcore_picker_does_not_require_advertised_nus` |
| Other BLE profiles retain filtering                          | Meshtastic/RNode filter assertions                                                       | passed  | Same Rust tests; common code on Linux/macOS/Windows                                                             |
| Generic discovery failure guidance                           | Separate service discovery from authentication; pairing classification remains unchanged | passed  | Existing BLE error/pairing suites in full Vitest; recovery guidance updated in every locale                     |
| Physical Windows BLE invisibility/service failure            | Requires Windows plus reporter's radio/firmware/adapter and official-app comparison      | blocked | macOS executor has no authorized radio; the reported physical root cause is unconfirmed                         |
| Fresh radio channels and Room contacts                       | Connect-time import plus explicit read-only sync                                         | passed  | Connected runtime regression and Electron radio journey                                                         |
| Repeated sync and duplicate prevention                       | Single-flight operation; safe channel/contact merge                                      | passed  | Runtime test and repeated actual Sync clicks                                                                    |
| SDK partial/error reads                                      | Capacity-bounded indexed reads; every Err rejects; typed-array and TCP-array raw frames  | passed  | Strict reader tests; real TCP fixture read-failure/recovery journey                                             |
| Empty slots, missing/invalid capacity and wrong-slot replies | Empty slots respected; unsupported metadata rejected; wrong replies timeout              | passed  | `meshcoreRadioChatSync.test.ts`                                                                                 |
| Setup in progress and interrupted setup                      | Wait for setup; generation-aware cancellation with timer cleanup                         | passed  | Setup wait regression; actual sync starts before optional setup finishes                                        |
| Disconnect while SQLite is reading                           | Guard before publication and persistence                                                 | passed  | Deferred database-read runtime regression                                                                       |
| Persistence failure and retry                                | Await acknowledged contact save; propagate failure                                       | passed  | Disk-full/retry runtime regression                                                                              |
| Live contact/path updates during persistence                 | Preserve only intervening map changes when publishing staged data                        | passed  | Deferred-save/live-contact runtime regression and platform-matrix map tests                                     |
| Existing history, names, credentials and local entries       | Reuse safe contact merge; no radio deletion/write during sync                            | passed  | Runtime merge tests and existing Rooms/contact regression suites                                                |
| Radio reconnect/restart and restored rooms                   | Isolated app closed and relaunched; imported rooms and chosen order remain               | passed  | Electron radio journey                                                                                          |
| Channel order dialog opens and saves                         | Stable slot IDs; presentation-only ordering                                              | passed  | Component tests and real Electron channel controls                                                              |
| Channel pointer drag                                         | Captured pointer on handle                                                               | passed  | Electron mouse drag from Zulu to Alpha                                                                          |
| A–Z sort and default/reset                                   | Display names sorted; original order restored on request                                 | passed  | Component tests and Electron channel/Room sorting                                                               |
| Cancel and Escape                                            | Draft discarded and focus restored                                                       | passed  | Component tests and Electron journeys                                                                           |
| Up/Down keys and arrow buttons                               | Keyboard and touch-accessible alternatives                                               | passed  | Component tests and Electron DM/Room journeys                                                                   |
| Touch drag and phone layout                                  | Real Chromium touch input, 390×844, no horizontal overflow                               | passed  | Electron shared DM journey                                                                                      |
| Focus during live rerender and focus trap                    | Stable close callback and dialog focus lifecycle                                         | passed  | Focus-preservation, trap and axe component tests                                                                |
| Empty/single-entry control                                   | Order action disabled                                                                    | passed  | Component empty-state test                                                                                      |
| Save failure                                                 | Dialog stays open with retryable error                                                   | passed  | Component storage-failure test                                                                                  |
| All-protocol DM order and reload                             | Protocol/self/surface-scoped preferences                                                 | passed  | Electron Meshtastic/MeshCore/Reticulum journey; hook protocol matrix                                            |
| MeshCore Room order                                          | Saved order drives actual Room rows                                                      | passed  | Electron room journey including relaunch                                                                        |
| RRC joined/listed/favorite/recent order                      | One globally ordered list matches the editor                                             | passed  | Actual local-app synthetic-hub browser journey plus RRC regression/axe tests; live hub remains below            |
| Temporarily absent entries                                   | Visible reorders keep absent entries in their prior slots                                | passed  | Disappear → reorder → return hook regression                                                                    |
| Fresh/missing/invalid sharing preference                     | Strict boolean opt-in, default false                                                     | passed  | Settings/guard tests, three-protocol AppPanel tests, actual fresh Electron checkbox                             |
| Existing explicit true/false and legacy migration            | Preserve stored choice; no forced rewrite                                                | passed  | Migration/unrelated-write regressions; actual opt-in and reload                                                 |
| No app location send without consent                         | Existing shared transmission guard; host refresh remains gated                           | passed  | Guard/default/RMAP tests; synthetic radio observed no set-position command                                      |
| Local GPS/static position with sharing off                   | Existing local-only behavior retained                                                    | passed  | GPS/AppPanel regression suites                                                                                  |
| Actual Windows/Linux desktop UI                              | Other host operating systems unavailable                                                 | blocked | Platform matrices and hosted build/tests provide partial proof, not physical UI proof                           |
| Live RRC hub and real USB/reflash/radio reconnect            | External hardware/hub not available or authorized                                        | blocked | Synthetic TCP/runtime and existing regression evidence only                                                     |

## Verification runs

- Dedicated review: six local reviewers covered code, architecture, chaos, security,
  completeness and connector contracts. Their confirmed findings were fixed with regressions:
  stale session publication, partial SDK reads, unacknowledged persistence, overlapping setup,
  intervening live updates, focus reset, ineffective RRC moves and absent-entry ordering.
- Scoped buttonmash: 180 actions, 49 states, no medium/high/critical findings. Two findings were
  harness-only: a double-click action timed out (low) and a form was deliberately skipped by the
  auth-form guardrail (info). Report: `/tmp/mesh-discord-chaos/report.html`.
- Electron: the final rebased build passed both feature journeys plus existing empty-state,
  protocol-switch and dialog-cancel regressions: 5 tests, 33.6 s (final rebuilt application). Initial failed runs
  exposed an unavailable native Keychain, test navigation/selector mistakes, invalid synthetic
  public keys and an unsupported identity-export response. Those test issues were corrected;
  the real frame normalization and setup-wait paths were also exercised and fixed.
- Translation review corrected ambiguous purchase-order wording in the new ordering labels.
- Latest focused persistence/capacity run: 28 tests in two suites passed.
- Actual RRC browser validation passed cross-group A–Z, sidebar order, reload persistence,
  mobile move/save and no page errors. Synthetic hub state; no live hub connected.
  Harness: `/tmp/mesh-discord-rrc-ui.mjs`; screenshots inspected locally.
- Upstream connection/error regression rerun passed 169 tests after rebase.
- Final comprehensive `pnpm run check:pr` on code revision
  `2be1d81b04fadf2355f0becc617b8f4032b56d21`: full lint, all typechecks,
  strict-shared, 17,455 tests / 1,403 files, full-feature Rust formatting, Clippy and
  844 Rust tests passed. Required commit hooks and security/source scanners passed;
  the implementation hook also ran 6,392 related Vitest tests.
- Final production build and the five Electron journeys passed after translation corrections.
- Final request/diff/checklist audit passed. Dedicated review found no remaining material
  issues; the latest persistence/capacity regression set passed all 28 tests.

This document records local evidence. Publication, pushed-commit verification, CodeRabbit,
CodeQL and CI are checked separately on the pull request's delivered head and reported in the
handoff. Local passes do not imply hosted approval or physical hardware validation. The only
later local change is this evidence document; it does not invalidate the code/runtime results.

The physical Windows BLE failure is not claimed fixed or fully verified. Test it by installing
this PR build on Windows with the affected companion: close the official app, scan with and
without OS pairing, connect and exchange messages, restart/reconnect, and verify that missing
services and genuine authentication failures show the correct separate recovery guidance.
