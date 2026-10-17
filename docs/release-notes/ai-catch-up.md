# Catch up release notes (unreleased)

- Add optional conversation summaries across supported protocols, using OS AI, downloaded models or configured endpoints.
- Offer Llama 3.2 1B and Qwen2.5 1.5B Q4_K_M downloads. Remove Qwen 0.5B and SmolLM2; choose a replacement explicitly if a removed model was selected.
- Keep a Set up Catch up action visible after enabling AI when the engine or model is not ready. It opens AI settings without reading history or starting a summary.
- Recover from failed or stalled startup status reads. Saved opt-in keeps the setup shortcut available while readiness is unknown; generation still requires a ready engine.
- Add an App settings summary timeout (30–1800 seconds), including model loading. Downloaded models can take several minutes.
- Keep local packaging working when the optional Apple AI helper is absent. Exclude the unusable Windows OS AI helper from NSIS installers.

## RRC changes, including when AI is disabled

- Show a New messages divider and jump to the first unread incoming message after history loads.
- Anchor first-time unread rooms to the actual unread arrival, so later hub notices, self messages and blur races cannot hide the divider.
- Keep unread badges visible for the selected room while reading older messages.
- Preserve scroll position when new messages arrive while scrolled up.
- Mark messages read only while the conversation is visible, the window is focused and the reader is at the latest messages.
- Keep read state, delayed history and queued scroll actions scoped to the current hub, room and connection session.
