# Chat

The **Chat** tab is where you read and send messages on Meshtastic, MeshCore, and Reticulum. This guide covers what Chat is on each protocol, how conversations are organized, the composer, searching and the unified inbox, scheduled send, and how to read delivery status honestly. For developer internals (storage, ingest, dedup), see [Chat panel (developer reference)](development/chat.md). For stuck or missing messages, see [Troubleshooting — Chat, nodes, and notifications](troubleshooting.md#chat-nodes-and-notifications).

---

## What Chat is on each protocol

Chat is one shared layout with protocol-specific plumbing underneath. Protocol accent colors differ; the controls are the same.

| Protocol   | What you chat in                                                       | Message size                                                                  |
| ---------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Meshtastic | Channels and direct messages (DMs)                                     | Long text is split into numbered parts automatically                          |
| MeshCore   | Channels and direct messages. Rooms (BBS) have their own **Rooms** tab | One radio packet per message; text that does not fit is blocked, never split  |
| Reticulum  | LXMF direct messages only. Hub rooms live on the separate **RRC** tab  | Large text limit; no packet-style splitting (attachments and voice memos too) |

On Reticulum, Chat has no channel chips. Pick a contact, paste a 32-character destination hash or an `lxmf://` address, or open a peer from the Nodes tab. See [Reticulum — Chat (LXMF)](reticulum.md#chat-lxmf) and [Reticulum — RRC](reticulum.md#rrc-reticulum-relay-chat).

Meshtastic and MeshCore can run at the same time as Reticulum. Chat shows the conversations of whichever protocol tab is active; unread badges and passive toasts tell you when another protocol hears traffic.

---

## Channels and conversations

### Chips and the DM strip

Channels appear as chips across the top, and direct messages in their own strip or picker. When the lists are long:

- Scroll controls show how many unread conversations sit above or below, and let you reveal one without selecting it or marking it read.
- **All channels** and **All direct messages** open a searchable picker (**Find a channel**, **Find a conversation**) that also shows the unread count.
- On Reticulum, DM chips wrap like channel chips; long peer names wrap, and avatars, unread badges, mute, and close stay on each chip.

Unread counts stay on a conversation chip even while it is selected until you have actually read to the bottom. If the conversation holds an unread MECP report, the chip shows a shield icon colored by the most severe one (see [EMCOMM](emcomm.md)). A **New messages** divider marks where unread begins, and **Jump to Unread** / **Jump to Latest** scroll to either end.

### Mute

The bell on a conversation (**Mute this conversation** / **Unmute this conversation**) silences ordinary chat sounds and desktop notifications for that one conversation. It does not silence emergency (MECP) alerts, which follow their own rules. The global mute and notification-mode settings are in [Notification sounds](notification-sounds.md) and **App → Notifications**.

### Pin and archive

Pin and archive organize your tab strip. They are separate from starring messages and from mute.

| Action                        | Effect                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| **Pin this conversation**     | The chip moves to the front of the strip, in the order you pinned.                  |
| **Archive this conversation** | The chip is hidden from the strip until you choose **Show archived conversations**. |
| **Unpin** / **Unarchive**     | Reverses the action.                                                                |

A conversation cannot be pinned and archived at once: pinning an archived conversation unarchives it, and archiving a pinned one unpins it. An archived conversation that is currently open, or that has unread messages, is never hidden, so you do not miss new traffic. Pin and archive choices are saved on this computer, separately for each protocol and identity. If saving fails (for example storage is full or disabled), Chat says so and keeps your previous choice.

### Order chats

**Order chats** opens a dialog to rearrange chips by dragging a handle, using the arrow keys, or using the move buttons. **Sort A–Z** orders by displayed name and **Default order** restores the original. This changes only how chats are displayed, never channel indices, destinations, or room membership.

### Remove and clear (MeshCore)

Right-click a MeshCore channel chip (or press the menu key, or Shift+F10 with the chip focused) to open its menu:

- **Clear messages** deletes every saved message in that channel from this computer. The channel stays and new messages keep arriving. Available on any channel, including Public.
- **Remove channel** makes the radio stop receiving the channel and forget its key. It is not offered for Public (slot 0), and it needs the radio connected. You can add the channel again later.

Both ask for confirmation, and neither runs if the radio or the channel in that slot changed while the confirmation was open.

Meshtastic channels are managed on the **Radio** tab, not from Chat. Reticulum DM chips use the close button to remove a conversation tab.

### Catching up

- **Meshtastic:** **Catch up from Store & Forward** asks a mesh router for recent history (up to 100 messages) when one has been seen.
- **MeshCore:** **Sync chats from radio** reads contacts and channel slots from a connected companion without changing the radio. Chat also shows when messages are still queued on the radio and can **Sync now**.

---

## Composer

The composer is the same for channels and DMs on every protocol (and is shared with MeshCore Rooms).

### Drafts

Unsent text is saved per conversation and restored when you come back, including after a restart. Selecting another conversation does not lose what you typed. Sending clears that draft.

### Sending and keys

- **Enter** sends. **Shift+Enter** inserts a new line.
- When the radio is not connected, the button reads **Queue** and the message waits in the outbox (see [Outbox and delivery honesty](#outbox-and-delivery-honesty)).
- The composer is hidden in the **Starred messages** view so a send cannot be aimed at the wrong conversation.

### Mentions

Type `@` to open a name picker. Use the arrow keys to move, and **Tab** or **Enter** to insert. Mentions render as compact labels in the message instead of raw `@[Name]` brackets. See [MeshCore / Meshtastic parity — mention tokens](meshcore-meshtastic-parity.md#chat-mention-tokens).

### Length limits and chunking

Limits are counted in bytes on the wire, so non-Latin scripts and emoji use more of the budget than plain ASCII. The composer shows a counter as you approach the limit.

| Protocol   | Per-message limit                                                                                                                  | Longer text                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Meshtastic | 228 bytes of text (a reply uses 5 more bytes of the budget)                                                                        | Split into up to 9 parts, each prefixed `[1/N]`, `[2/N]`       |
| MeshCore   | 160-byte wire packet. A channel message loses your display name plus a colon-space prefix; a DM keeps all 160; a room post loses 4 | Blocked. The send button is disabled and a notice explains why |
| Reticulum  | 4096 for the composer                                                                                                              | Not split in Chat                                              |

MeshCore does not split because busy repeaters often drop numbered parts. Multi-part messages from other clients still reassemble when received. Sending several MeshCore messages close together also shows a dismissible warning that repeaters may drop messages sent too fast; it does not block the send.

### Spellcheck, emoji, and extras

- Spellcheck is on. Right-click a misspelled word for replacements.
- **Emoji** inserts an emoji: the system emoji panel on macOS and Windows, an inline picker on Linux.
- **Share location** sends your current GPS or static position as a chat message.
- Reticulum DMs add **Attach file or photo**, a voice-memo recorder, and **Share as paper** / **Scan paper** for encrypted offline LXMF messages. Attachments are limited per message; see the tooltip on the attach button for the exact count and size.
- MeshCore Giphy GIF send appears only when **MeshCore Open compatibility** is enabled under **Radio**. See [MeshCore / Meshtastic parity](meshcore-meshtastic-parity.md).

### F1–F12 macros

Every composer has twelve text macros. The bar is collapsed by default: use **Show macros** to open it and **Edit macros** to set each slot's label and message text (changes save automatically).

- **When used** chooses **Put in message box** (the default) or **Send now**. **Send now** only fires when the box is empty, so a half-written draft is never sent or lost.
- Press a plain **F1**–**F12** (no modifier) to use that slot. The key goes to the composer you are looking at.
- **Size** offers Small, Medium, and Large; touchscreens default to Large.
- Your operating system may keep some F-keys for itself.

### MECP siren (opt-in)

Emergency reports are off in the composer until you enable **App → MECP → Show MECP buttons in Chat**. When on, a red siren button (request help or report conditions) and a blue shield button (respond) appear next to Send. See [EMCOMM: MECP and Incident Command](emcomm.md).

---

## Finding messages

### Search the open conversation

**Search messages** in the conversation toolbar filters the open channel or DM. It shows a result count and highlights matches in the bubbles. Press **Esc** to close it.

### Search all conversations

Press **Ctrl+Shift+F** (**Cmd+Shift+F** on macOS) to open **Search all messages**, or use **Search all conversations** in the Chat toolbar. It searches saved history for every enabled protocol at once.

- Narrow results with **Protocol**, **Direction** (**All**, **Received**, **Sent**), and **Sender** (a name or id).
- Each protocol returns at most 50 matches per query, merged newest first.
- Picking a result opens that conversation and scrolls to the message.
- Direction needs to know which messages are yours. If your own node or hash is not known yet, **Received** and **Sent** return nothing for that protocol.
- Search covers what is stored locally, not what is still on a radio.

### Filter by sender

Click a sender name to filter the conversation to that sender (**Filtering by name**). **Clear filter** or **Esc** removes it. Each sender row also lets you view that node's details.

### Jump to date

**Jump to date** opens a calendar and scrolls the conversation to that day. **Esc** closes it.

### Starred messages

Star a message from its action row (**Star message** / **Unstar message**). **Starred messages** in the toolbar lists them newest first, with **Go to message** to jump back to the original. Opening Starred never marks another conversation read. Starred is limited to 200 messages per protocol; starring more drops the oldest.

---

## Unified inbox

Press **Ctrl+Shift+U** (**Cmd+Shift+U** on macOS) to open the **Unified inbox**. You can also open it from the global search dialog.

The inbox lists **received** messages from every enabled protocol, newest first, capped at 200. It leaves out your own sends and reaction rows.

- **Protocol** and **Filter** (text or sender) narrow the list.
- Click a row to open its conversation at that message. Tick rows (or **Select all messages**) for batch actions.

| Action             | What it does                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| **Copy**           | Copies one plain-text line per message (time, protocol, sender, conversation, text).                     |
| **Export**         | Saves a `.txt` file. The format has no protocol column, so the protocol is appended to each sender name. |
| **Star**           | Adds to the same Starred list used in Chat. Already-starred messages are skipped.                        |
| **Delete locally** | Asks for confirmation, then removes the message from this inbox.                                         |

**Delete locally** does not delete Meshtastic or MeshCore chat history: those messages are only hidden from the inbox and remain in their conversations. For Reticulum, the message is also removed from the saved Reticulum history. Nothing is ever deleted from a radio or sent to other people. If the change cannot be saved, nothing is removed.

---

## Scheduled send

Schedule a message to go out later instead of now.

1. Type the message in a channel or DM and click **Schedule send** next to the other composer buttons.
2. Pick **In 15 minutes**, **In 1 hour**, or **Tomorrow 9:00**, or set any date and time in **Send at**.
3. Click **Schedule**.

Rules:

- The time must be at least 5 seconds in the future and within the next 30 days.
- Scheduled messages are stored on this computer and survive a restart. **The app must be running** at the scheduled time; nothing is sent from a closed app.
- At the time, the message sends only if a radio or stack is connected and ready. If it is not, the message waits and tries again once sending is possible (the outbox's normal 24-hour limit counts from the scheduled time).
- Scheduling works from the Chat composer only (not Rooms or RRC). It works from any tab, so you do not need to keep Chat open.
- Long text that would be split is split when you schedule it, and each part is queued.

The pending message appears in the conversation as **Scheduled for time**. From there you can **Edit** (change the text and time) or **Send now**. Messages that were split into parts can be rescheduled but not reworded.

MeshCore MQTT-only caveat: a MeshCore connection that is MQTT-only has no radio path for Chat sends, so scheduled and queued MeshCore messages wait rather than go out. Connect the companion radio for them to send. Meshtastic MQTT-only connections can send, labeled "via MQTT".

---

## Message actions

Hover or focus a message to reveal its action row (or turn on **Always show message actions** under **App → Appearance**). Which buttons appear depends on the protocol and the message.

| Action                 | Where it applies                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| **Reply**              | Quotes the message and sends your text as a reply (requires the message's packet id on Meshtastic). |
| **React**              | Emoji reaction (tapback) on all three protocols.                                                    |
| **Copy message**       | Copies the text.                                                                                    |
| **Star message**       | Adds to Starred.                                                                                    |
| **Filter by sender**   | Filters the conversation to that sender.                                                            |
| **Resend message**     | Retries a message that failed.                                                                      |
| **Send signal report** | Replies with reception stats for messages heard over RF or Bluetooth; unavailable otherwise.        |
| Translate              | Appears when offline translation is enabled in **App → Translation**.                               |

Other bubble features: hop badges, link previews (HTTPS only), inline images, structured cards for signal reports, and weather posts. A toolbar toggle shows only weather posts in the selected channel, and its inline settings can hide them from the normal channel view, add a pattern, or mark a sender as a weather sender. Hidden weather posts do not add unread badges or play sounds. DMs are never filtered, and Reticulum (DM-only) has no weather view.

**Export chat** in the toolbar saves the current conversation as a `.txt` file through a Save dialog.

---

## Outbox and delivery honesty

Chat reports what the network told it, not what you hoped. A message can leave your radio and still not be acknowledged.

### Queued messages

If you send while disconnected, the message is queued in the durable outbox and survives a restart. When sending is possible it is tried, and on failure retried after about 30 seconds, then 2 minutes, then 10 minutes, for up to four attempts in total. Automatic drain stops for messages older than 24 hours; you can still retry or cancel one by hand. **Retry** and **Cancel** are on each outbox row. A row marked **Blocked** (for example no encryption key for that recipient) is not retried until the cause is fixed.

### Automatic resend

A message that was sent but fails is resent automatically up to three times, after 15 seconds, 1 minute, and 3 minutes. The bubble shows **Retrying (1/3) in time**, and **Cancel retry** stops it. After the third attempt only the manual **Resend message** button remains. Emergency (MECP) reports are exempt and use their own outbox, which keeps retrying until acknowledged. Channel sends on MeshCore are also exempt, because a MeshCore channel flood has no delivery acknowledgement to fail on.

### What the status means

| Status                              | Meaning                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Queued** / **Scheduled for time** | Waiting in the outbox. Not sent yet.                                                                         |
| **Sending…**                        | Handed to the radio or stack; no result yet.                                                                 |
| **Delivered**                       | A positive acknowledgement came back (see below).                                                            |
| **no ACK**                          | No other node acknowledged. The message may still have been broadcast, for example when nobody was in range. |
| **Failed**                          | The send or acknowledgement failed. Resend or wait for automatic retry.                                      |
| **Blocked**                         | Cannot send as queued (for example a missing encryption key).                                                |

What counts as an acknowledgement differs by protocol:

- **Meshtastic:** a channel or broadcast message is **Delivered** when the mesh sends back an ACK. A Wi-Fi/TCP link to your own radio working does not imply a mesh ACK.
- **MeshCore:** a DM is acknowledged by the recipient. A channel message is a flood with no delivery ACK, so Chat shows **Heard by** repeaters instead: the repeaters confirmed to have forwarded your own packet, counted for about two minutes after sending. Treat "Heard by 0" as unknown, not as proof of loss.
- **Reticulum:** statuses are explicit about where the message is: **Sending…**, **Sent (awaiting peer receipt)**, **Queued at propagation node**, **Stored at propagation node (not yet delivered to peer)**, **Kept in your local propagation inbox (not delivered to peer)**, **Paper**, **Delivered**, or **Failed to send**. A path being reachable (**Path reachable**) means a route is known, not that the message was delivered. See [Reticulum — Chat (LXMF)](reticulum.md#chat-lxmf).

A message stored at a propagation node is waiting for the recipient to pick it up; it is not **Delivered**.

---

## Per-protocol differences

| Area                    | Meshtastic                           | MeshCore                                                       | Reticulum                                         |
| ----------------------- | ------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------- |
| Conversations           | Channels and DMs                     | Channels and DMs; Rooms on the **Rooms** tab                   | LXMF DMs only; hub rooms on **RRC**               |
| Message size            | 228 bytes, auto-split to 9 parts     | One packet (about 160 bytes on the wire); no splitting         | 4096 in the composer; attachments and voice memos |
| Channel delivery ACK    | Yes                                  | No (flood); **Heard by** repeaters instead                     | Not applicable (no channels)                      |
| Auto resend             | Yes                                  | DMs yes; channel sends no                                      | Yes                                               |
| Remove / clear channel  | Manage channels on the **Radio** tab | Chip menu: **Remove channel**, **Clear messages**              | Close a DM chip                                   |
| History catch-up        | **Catch up from Store & Forward**    | **Sync chats from radio**                                      | Propagation nodes deliver stored messages         |
| Extra composer features | Share location                       | Share location; Giphy GIF with **MeshCore Open compatibility** | Attach file or photo, voice memo, paper messages  |
| MQTT-only sending       | Allowed                              | Not sent (no RF path); queued and scheduled messages wait      | Not applicable                                    |

Pin, archive, mute, star, search, the unified inbox, macros, and scheduled send are available on all three.

---

## Related

- [EMCOMM: MECP and Incident Command](emcomm.md) — emergency reports and the **Incident** tab
- [Settings and keyboard shortcuts](settings.md) — launcher, App and Radio tabs, shortcut table
- [Maps](maps.md) — shared locations and node positions on the Map
- [Notification sounds](notification-sounds.md) — tones, volume, per-event presets
- [Reticulum in mesh-client](reticulum.md) — LXMF Chat, RRC, propagation nodes
- [Localization & Languages](localization.md)
- [Troubleshooting — Chat, nodes, and notifications](troubleshooting.md#chat-nodes-and-notifications)
- [Chat panel (developer reference)](development/chat.md)
