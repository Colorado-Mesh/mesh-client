# Scheduled Broadcasts

Use the **Broadcasts** sub-tab under Chat to schedule up to twelve recurring one-packet
messages (B1–B12) to Meshtastic or MeshCore channels, MeshCore rooms, or RRC rooms.

## Requirements

- mesh-client must be **running** (no OS-level alarm).
- The radio for each target must be **connected** at fire time.
- Missed occurrences (app closed, asleep, or radio down) are **skipped**, not sent late —
  the slot shows a **Missed** result and advances to the next time.

## Courtesy

Shared LoRa channels and rooms are scarce airtime. Prefer infrequent schedules, few
targets, and messages the mesh actually needs — do not spam.

## Limits

- One packet per target (no multi-part chunking). Oversize text is blocked when you save.
- Up to 8 targets per slot, 10 seconds between targets, 5 minutes max per run.
- Exporting the SQLite database includes your broadcast text and schedules.

## Master switch

**Enable scheduled broadcasts** must be on for timers to arm. **Send now** still uses the
same delivery path but does not advance the next due time. App → Danger Zone → Clear All
Local Data deletes all slots and turns the master switch off. Device factory reset does not.
