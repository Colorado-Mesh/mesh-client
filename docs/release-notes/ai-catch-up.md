# Catch up release notes (unreleased)

- Ask follow-up questions about a completed Catch up. Answers use the summary plus a capped raw transcript (and multi-pass digests as fallback), stream into the card, and stay in session memory.
- Scale large Catch ups beyond five bullets: structured Conversations + One-offs summaries with a higher completion budget; keep compact five-bullet output for small single-pass jobs.
- Add optional conversation summaries across supported protocols, using OS AI, downloaded models or configured endpoints.
- Offer Llama 3.2 3B Instruct (recommended for quality) and Qwen2.5 1.5B Instruct Q4_K_M (faster for slower machines) downloads, plus Apple Silicon MLX twins. Raise on-device Catch up prompt headroom so bundled engines keep Conversations/One-offs when digests fit. Prior Qwen3 1.7B / 1B (and older) catalog ids become not-ready until the user picks a current model.
- On Apple Silicon, prepare Metal Catch up when AI is enabled (bundled helper or local Xcode discovery without changing `xcode-select`); list both MLX twins even while Metal is preparing; allow MLX downloads before Metal is ready; gate Use/Catch up on the helper with in-app Retry and user-guide docs. Detect a missing Metal Toolchain and show `xcodebuild -downloadComponent MetalToolchain`; always surface a Retry success or failure notice. Document rebooting when that download loops.
- Keep a Set up Catch up action visible after enabling AI when the engine or model is not ready. It opens AI settings without reading history or starting a summary.
- Recover from failed or stalled startup status reads. Saved opt-in keeps the setup shortcut available while readiness is unknown; generation still requires a ready engine.
- Start waiting summaries automatically when the active summary finishes, fails or is cancelled. Preserve cancellation and timeouts after endpoint acknowledgement.
- Preserve each conversation's summary range when switching tabs/protocols and regenerating, including custom hour ranges.
- Identify local dates, timezone and UTC offsets in summary prompts so transcript times are not mistaken for UTC.
- Add an App settings summary timeout (30–1800 seconds), including model loading. Downloaded models can take several minutes.
- Keep local packaging working when the optional Apple AI helper is absent. Exclude the unusable Windows OS AI helper from NSIS installers.

## RRC changes, including when AI is disabled

- Show a New messages divider and jump to the first unread incoming message after history loads.
- Anchor first-time unread rooms to the actual unread arrival, so later hub notices, self messages and blur races cannot hide the divider.
- Keep unread badges visible for the selected room while reading older messages.
- Preserve scroll position when new messages arrive while scrolled up.
- Mark messages read only while the conversation is visible, the window is focused and the reader is at the latest messages.
- Keep read state, delayed history and queued scroll actions scoped to the current hub, room and connection session.
