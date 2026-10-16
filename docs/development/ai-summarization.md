# AI conversation summaries

Catch up summarizes the selected conversation without posting to the mesh. It supports
Meshtastic and MeshCore channels/DMs, Reticulum LXMF DMs, MeshCore rooms and RRC rooms.
The shared button and card provide unread/hour/loaded scopes, streamed text, cancellation,
copy, regenerate, dismiss, actual message count, truncation disclosure and a settings link.
Summaries are session memory only and should be checked against original traffic.

## Opt-in and privacy

AI starts disabled, with no model selection. Only App > AI conversation summaries and launcher
settings search expose the feature before opt-in. The optional startup `ai:getStatus` reads
settings without downloading, probing OS AI, creating a model directory or starting workers.
Native availability probes run only in open AI settings or on an explicit test/summary request.
A saved OS choice exposes Catch up after restart; the first click rechecks native readiness.

The main process owns endpoint requests and API keys. `AiConfig` encrypts keys with safeStorage,
rejects insecure OS storage and drops a key when its endpoint or engine changes. Provider blobs
are excluded from generic app-settings reads, and only validated `ai:*` writes may change AI
state, so generic preference writes cannot bypass disable teardown or endpoint validation.
Remote engines require HTTPS plus an acknowledgment specific to the saved endpoint. Local
engines accept literal loopback/private LAN and `.local` hosts. All endpoints disclose their
host on the result, including LAN servers, which receive text off-device. Redirects fail closed.
Gemini credentials use a header rather than the URL. Provider errors never include bodies or keys.

Disable/configuration changes abort active main requests, terminate native helpers, cancel model
jobs as appropriate, invalidate renderer requests and clear displayed summaries. Loaded WASM is
released at the end of each generation, cancellation or disable. Inference never invokes tools,
interprets HTML or posts messages. JSON-quoted transcript lines and untrusted-data instructions
reduce prompt injection risk; they do not guarantee model obedience.

## Engines and platform limits

| Engine             | Platforms             | Requirements                                                                                                         |
| ------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Apple Intelligence | macOS 26+             | Eligible hardware, Apple Intelligence enabled, staged universal Foundation Models helper                             |
| Windows Phi Silica | Windows 11 24H2+      | Copilot+ hardware, ready model, Microsoft LAF token/attestation and supported package identity with `systemAIModels` |
| Downloaded model   | macOS, Windows, Linux | Explicit verified GGUF download and selection; bundled wllama 3.8.1 CPU WASM worker                                  |
| Local server       | All                   | Ollama, LM Studio, llama.cpp, vLLM, LocalAI or compatible endpoint                                                   |
| Remote provider    | All                   | OpenAI-compatible, Anthropic, Gemini or Ollama wire format, HTTPS and acknowledgment                                 |

Linux has no built-in OS LLM API. Unsupported OS/hardware hides that choice.
The existing Windows NSIS distribution does not supply the required package identity or
Microsoft-issued LAF credentials. The Windows helper therefore reports unavailable in that
installation. Compilation alone does not establish Windows OS AI readiness. Its project accepts
maintainer-provided `AiLafToken`/`AiLafAttestation` MSBuild properties; do not invent these values
or request a model download during a probe. Build both Windows RIDs and select the matching staged
helper in beforePack. The other engines are available without those Windows requirements.

Native helper source lives in `native/ai/`; `scripts/build-ai-helper.mjs` stages binaries and
runtime dependencies under `resources/ai-helper/`. Build/release CI compiles the helpers before
packaging. Large binaries and Swift caches are excluded from Git and packaged resources.
Swift returns cumulative snapshots, so its helper emits only new suffixes. Windows has no
max-output-token option in this API; its helper uses a conservative 1,000-character bound.

## Data and runtime boundaries

`src/shared/ai-types.ts` is the preload contract. Main services are under `src/main/ai/`;
`src/main/ipc/ai-handlers.ts` owns validation, rate limits and lifecycle. Registration is inert.
HTTP adapters parse bounded SSE/NDJSON, require a completion marker, support fragmented UTF-8
and emit coalesced IPC chunks. OpenAI reasoning models use completion-token budgets; Gemini
thinking settings are model-aware. Hidden reasoning has a bounded allowance, while visible text
is independently capped at 1,000 characters. Context budgets select whole messages newest first, skip messages that do not fit, and disclose
truncation. An oversized newest message does not block older eligible input; when no complete message
fits, the request reports an input-size error without inference. The complete UTF-8 prompt, including framing and metadata, is conservatively bounded
to 3,500 bytes for both Apple’s and the WASM engine’s 4,096-token contexts.
This leaves output/template headroom for CJK, emoji and ASCII tokenization. Remote context
capacity remains model-dependent, with a 64,000-byte prompt cap.

A dedicated `ai:getHistory` query preserves existing generic DB query semantics while adding
inclusive time bounds and exact conversation filters **before** its 501-row cap. The extra row
signals truncation. Channels follow keyed identities across slot/radio changes; unkeyed legacy
rows use the existing current/null-radio fallback. DMs and rooms use peer/server and radio filters;
Reticulum uses identity plus full destination hash; RRC uses canonical hub/room and prose kinds.
MeshCore skew normalization occurs before range filtering. `idx_mc_msgs_room_ts` is additive and
idempotent; no schema version change is needed.

Chat and Rooms reuse their opening unread-divider snapshots while the divider is active.
After the divider is cleared, summaries use the current persisted read watermark; hiding a
divider must never reset the unread range to all history. Empty ranges skip inference. RRC persists canonical read
watermarks through `rrcReadWatermark.ts`, snapshots before selection clears unread and retains
that boundary while caught-up updates the live watermark. An absent watermark can fall back to
the live unread count when enough opening history exists. Without that history or a known
read boundary, the unread scope starts at opening time; choose an explicit time range to include
older traffic. Derived boundaries cannot lead the local clock. History retention can remove older traffic.
History/live overlap uses a multiset union: matching copies across sources count once, while distinct
messages with identical timestamp/sender/body within either source retain their multiplicity.
The card reports a fixed collected count from the selected range at request start, then the actual
included count after main prepares the prompt. Neither count claims all historical traffic still exists;
new arrivals can increase the live unread badge while a summary runs. Legacy future RRC read values
are repaired in storage once, without emitting change events from the read helper. The pending card never labels
offered messages as included before main confirms coverage.
Channel summaries apply the same default/custom weather patterns and marked-sender rules to fetched
history as to visible chat when hiding weather is enabled. Numeric sender metadata stays local and
is stripped by request validation. DMs and rooms retain weather text. The raw 501-row history cap
still applies before visibility filtering; preserve its truncation disclosure even if filtering leaves
fewer messages.

Bundled inference returns a validated `localJob` from main and runs through a thin renderer
`AiWorkerHost`. Wllama owns the actual WASM worker, so a second wrapper worker is unnecessary.
The module is dynamically imported only for explicit generation, uses bundled WASM, disables
CDN compatibility fallback and suppresses native logging. Single-thread CPU settings work
without changing cross-origin isolation. A global latch bounds model concurrency. The worker uses a single completion slot and bounded
128-token batches. Model loading and transcript processing are shown separately; worker startup
errors fail the request without retaining their potentially sensitive details. CPU inference has a five-minute deadline covering
model loading and generation; endpoint/native requests retain the one-minute deadline.
The renderer deadline also covers stalled main-process acknowledgements and runtime imports. Abort races
initialization and terminates the worker even if upstream model loading has not settled.
Downloaded-model settings explain that large conversations can take a few minutes. The prompt
asks for concrete updates, callsigns, times/places and stated answers, compresses greetings/banter,
and keeps unresolved questions open. Bundled sampling supplies llama.cpp's `repeat_penalty` and
`repeat_last_n` wire names (the pinned wllama types still use older names). Callback streaming
rejects sustained repeated phrases or sentences and releases the runtime through the same failure
path. Rejected text is cleared, with a larger-model/shorter-range retry suggestion. Copy is enabled
only for completed, non-error output. These controls do not establish factual accuracy.

`mesh-ai:` serves only enabled, verified manifest assets, with realpath containment and CORS for
the sandboxed renderer. Model installs stream to a unique temporary directory, hash incrementally
without buffering a gigabyte in memory, verify exact size/SHA-256 and publish by rename.
The pinned catalog records immutable Hugging Face revisions and publisher LFS SHA-256 values
checked on 2026-10-15. The two Qwen2.5 weight sets use Apache-2.0. Wllama and llama.cpp use MIT;
the npm license report covers the runtime. Model attribution belongs here, not in that report. The proposed 360M option was removed
after synthetic checks showed repetition and incorrect sender/question attribution. The catalog
is not an accuracy guarantee; users must verify summaries against original traffic. The 0.5B
model can also miss key facts, misread an unresolved request as a commitment or repeat itself, so its
catalog guidance labels it experimental. The larger model needs more memory/time and also requires
source verification. Real-model trials are bounded checks, not an accuracy guarantee: the revised
prompt extracted concrete outage, coverage, inspection and net-time details from a 41-message
synthetic chat, but the 1.5B model still omitted an open policy-link request.

## Validation

Focused tests cover default-off IPC behavior, URL/key policy, all adapters, fragmented streams,
response caps, cancellation, prompt framing, exact per-protocol DB scopes, broadcast/channel
remap history, verified installs, native pipe/exit/callback failures, renderer request correlation,
RRC watermarks and accessible controls. Run `pnpm run check:pr` before opening/updating the PR.
Native compilation and real-model smoke tests are separate from deterministic unit tests.
Windows runtime activation and hardware validation require an eligible, correctly packaged host.
