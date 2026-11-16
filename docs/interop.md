# Tests and interoperability

Product-level coverage matrix for mesh-client across **Meshtastic**, **MeshCore**, and **Reticulum** (Ratspeak / Nomad / LXST / LRGP). Inspired by [interop.ratspeak.org](https://interop.ratspeak.org/) — this page indexes what mesh-client automates in CI and what still needs a live/manual gold test.

Status values:

| Cell          | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| **Automated** | Vitest, Playwright E2E, and/or sidecar Rust tests cover the journey |
| **Manual**    | Documented live gold checklist; not in CI                           |
| **N/A**       | Capability does not exist for that protocol                         |
| **Gap**       | Desired coverage missing or incomplete                              |

Deep feature parity for LoRa lives in [meshcore-meshtastic-parity.md](meshcore-meshtastic-parity.md). Reticulum Games: [reticulum-games-parity.md](reticulum-games-parity.md). Nomad hosting: [nomad-hosting-interop.md](nomad-hosting-interop.md). Remote (rnsh/rncp): [reticulum-development.md](reticulum-development.md#remote-rnsh--rncp-interop-smoke).

## Coverage matrix

| Capability                          | Meshtastic                            | MeshCore                         | Reticulum                                                                        |
| ----------------------------------- | ------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| Connect (BLE / serial / TCP / HTTP) | Automated (unit + panel E2E walk)     | Automated (fake TCP radio E2E)   | Automated (sidecar start / panel E2E)                                            |
| Chat channel / group                | Automated                             | Automated                        | N/A (LXMF DM / RRC / Rooms elsewhere)                                            |
| Chat DM                             | Automated                             | Automated                        | Automated (Vitest + dual-sidecar TCP when present)                               |
| Reactions / tapbacks                | Automated                             | Automated (incl. Open wire)      | Automated (LXMF reaction field)                                                  |
| MQTT ingest / publish               | Automated                             | Automated (JSON / LetsMesh)      | N/A                                                                              |
| Map / positions                     | Automated                             | Automated                        | Automated (RMAP discovery)                                                       |
| Diagnostics                         | Automated                             | Automated                        | Automated (`ReticulumDiagnosticEngine`)                                          |
| Rooms (BBS)                         | N/A                                   | Automated (Vitest) + Manual live | N/A                                                                              |
| Repeaters admin / ping              | N/A                                   | Automated (E2E fake repeater)    | N/A                                                                              |
| LXMF Direct / Propagated            | N/A                                   | N/A                              | Automated (sidecar) + Manual vs Ratspeak                                         |
| Network stamps / Link MTU           | N/A                                   | N/A                              | Automated (stack settings + dual-sidecar)                                        |
| LXST voice Call                     | N/A                                   | N/A                              | Automated (signalling) + Manual audio vs Ratspeak                                |
| LXMF voice memos                    | N/A                                   | N/A                              | Automated (encode path)                                                          |
| LRGP Games                          | N/A                                   | N/A                              | Automated (UI/API) + Manual wire vs Ratspeak                                     |
| Nomad page hosting                  | N/A                                   | N/A                              | Automated (unit) + Manual ([nomad-hosting-interop](nomad-hosting-interop.md))    |
| Remote rnsh / rncp                  | N/A                                   | N/A                              | Manual ([smoke table](reticulum-development.md#remote-rnsh--rncp-interop-smoke)) |
| Contact Cards / Team Roster         | Automated                             | Automated                        | Automated                                                                        |
| Scheduled Broadcasts                | Automated                             | Automated                        | Automated                                                                        |
| TAK                                 | Automated                             | Automated                        | Automated                                                                        |
| MECP / EMCOMM                       | Automated                             | Automated                        | Automated                                                                        |
| Protocol switcher / panel matrix    | Automated (`e2e/panelMatrix.spec.ts`) | same                             | same                                                                             |

## Transports

| Transport    | Meshtastic            | MeshCore             | Reticulum                             |
| ------------ | --------------------- | -------------------- | ------------------------------------- |
| BLE          | Yes                   | Yes                  | RNode / BLE Peer (sidecar)            |
| Serial / USB | Yes                   | Yes (Web Serial)     | RNode serial                          |
| TCP          | Wi‑Fi / TCP fast path | Companion TCP bridge | TCPClient / TCPServer / Backbone hubs |
| HTTP         | Meshtastic HTTP       | —                    | Sidecar localhost HTTP API            |
| MQTT         | ServiceEnvelope       | JSON chat / packets  | —                                     |

## Cross-client applications

| Peer                                   | Exercised                     | Result                                         |
| -------------------------------------- | ----------------------------- | ---------------------------------------------- |
| Meshtastic firmware companion          | Connect, chat, MQTT           | Automated + Manual live radio                  |
| MeshCore companion / room / repeater   | Connect, chat, rooms, ping    | Automated fake radio + Manual live             |
| Ratspeak 1.1.0+ (LXMF / voice / games) | DM, Call, Games               | Manual gold (TCP hub)                          |
| NomadNet / MeshChat                    | Nomad pages / files           | Manual ([checklist](nomad-hosting-interop.md)) |
| Public MQTT brokers                    | Meshtastic / MeshCore presets | Manual                                         |

## Automated suite map

| Suite                             | Protocols                       | Entry                                                                                                                                                             |
| --------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest (renderer / main / shared) | All                             | `pnpm run test:run` / `test:staged`                                                                                                                               |
| Panel matrix E2E                  | Meshtastic, MeshCore, Reticulum | [`e2e/panelMatrix.spec.ts`](../e2e/panelMatrix.spec.ts) — [e2e-panels.yaml](../.github/workflows/e2e-panels.yaml)                                                 |
| MeshCore repeater E2E             | MeshCore                        | [`e2e/meshcore-repeater-admin.spec.ts`](../e2e/meshcore-repeater-admin.spec.ts) — [e2e-meshcore-repeaters.yaml](../.github/workflows/e2e-meshcore-repeaters.yaml) |
| Full Playwright                   | All (daily)                     | [e2e.yaml](../.github/workflows/e2e.yaml)                                                                                                                         |
| Sidecar Rust (`rns-stack`)        | Reticulum                       | `pnpm run check:reticulum-sidecar` / tests.yaml path gate                                                                                                         |
| Dual-sidecar TCP interop          | Reticulum                       | [`reticulum-sidecar/src/stack/interop_tcp_tests.rs`](../reticulum-sidecar/src/stack/interop_tcp_tests.rs) (LXMF, stamps, voice signalling)                        |

## Manual gold

| Scenario                         | Notes                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| Live Meshtastic BLE/serial/HTTP  | Chat + MQTT against another client                                |
| Live MeshCore companion          | Rooms login/post; Repeaters ping/CLI on air                       |
| mesh-client ↔ Ratspeak LXMF DM   | Shared TCP hub; stamp off and stamp-on                            |
| mesh-client ↔ Ratspeak LXST Call | Audio path; stamp settings aligned                                |
| mesh-client ↔ Ratspeak Games     | TTT / Chess / Four in a Row ([parity](reticulum-games-parity.md)) |
| Nomad hosting                    | [nomad-hosting-interop.md](nomad-hosting-interop.md)              |
| Foreign LoRa overhear            | Diagnostics tables on Meshtastic / MeshCore tabs                  |

## Open gaps

| Gap                                                                           | State                                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Meshtastic connected chat send/receive E2E (parity with MeshCore TCP fixture) | Gap — panel walk exists; deepen when a Meshtastic fake companion is practical |
| Four in a Row wire vs Ratspeak                                                | Manual pending ([games parity](reticulum-games-parity.md))                    |
| Dual-sidecar voice PCM audio (not only signalling)                            | Gap — signalling automated; audio Manual                                      |
| Python NomadNet / MeshChat in CI                                              | Manual only (no peer binaries in CI)                                          |

## Reticulum network stamps (1.6.0 → 1.6.2)

Upstream Reticulum phases network stamps: **1.6.0** implements primitives (emit/enforce off by default); **1.6.1** enables emission by default; **1.6.2** enables enforcement by default. mesh-client exposes **Stamp announces and path requests**, **Require stamps**, and **Link MTU discovery** under Network → Stack settings (defaults match 1.6.0 / Ratspeak 1.1.0).
