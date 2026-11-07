# Catch up (AI conversation summaries)

Catch up summarizes the selected conversation in Chat, Rooms, or RRC **without posting to the mesh**. AI is **off by default**. Nothing runs until you enable it under **App → AI conversation summaries** and choose a ready engine.

## Enable and choose an engine

1. Open **App → AI conversation summaries**.
2. Turn on **Enable AI summaries**.
3. Choose an engine:
   - **Built-in OS AI** — Apple Intelligence or Windows on-device AI when the device supports it.
   - **Downloaded model (offline)** — verified models stored on this computer (CPU or Apple Silicon Metal).
   - **Local server** / **Remote provider** — your own endpoint (remote requires HTTPS and an acknowledgment that conversation text leaves the device).

If Catch up is not ready yet, the chat toolbar shows **Set up Catch up** (or **Fix Catch up engine** when a model is selected but not runnable). That opens these settings.

## Offline models (downloaded)

Downloads use the network once; summaries then run offline on this device.

- **CPU (portable)** — works on macOS, Windows, and Linux via a bundled WASM runner.
- **Apple Silicon (MLX / Metal)** — recommended on Macs with Apple Silicon for faster Catch up. Labeled **Recommended on macOS**.

On each card:

- **Download** fetches and verifies the model.
- **Use model** selects it for Catch up (Metal models require Metal Catch up to be ready).
- **Remove** deletes the on-disk pack. Removing an unused or outdated pack keeps your engine settings.

Llama 3.2 3B is marked **Recommended for quality**. Qwen2.5 1.5B is marked **Faster for slower machines**.

## Metal Catch up on Mac

On Apple Silicon, Mesh Client prepares a small **Metal** helper when you enable AI (or when you open AI settings). Release builds normally include this helper already.

While it prepares, settings show **Preparing Metal Catch up on this Mac…**.

If Metal Catch up is not ready:

- You can still **download** MLX models.
- **Use model** for MLX stays unavailable until Metal is ready.
- Use a **portable CPU** model for Catch up in the meantime.
- Follow the on-screen next steps (for example open **Xcode** from Applications if prompted, finish any first-launch setup, then tap **Retry Metal Catch up**).
- If settings say the **Metal Toolchain** is missing, run `xcodebuild -downloadComponent MetalToolchain` in Terminal, finish any Xcode prompts, wait for the download, then tap **Retry Metal Catch up**. Confirm with `xcrun -sdk macosx metal -v` (a version line means Metal is available even when Xcode has no on-disk `usr/bin/metal` stub).
- Updating Mesh Client can help when a release should already include Metal.

You do **not** need to run Terminal commands or change developer tools for normal use.

## Troubleshooting

- If `xcodebuild -downloadComponent MetalToolchain` loops (keeps downloading or never finishes), reboot the Mac and run the command again, then tap **Retry Metal Catch up**.

## Follow-up questions

After a Catch up finishes, you can ask follow-up questions in the summary card. Answers use the summary plus retained source messages for that Catch up and stay in session memory (they are not posted to the mesh).

## Privacy

- Catch up never posts automatically.
- Remote engines send conversation text to the provider you configure.
- Offline / OS engines keep summary work on this device (aside from the one-time model download when using downloaded packs).
