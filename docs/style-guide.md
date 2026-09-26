# UI style guide

Rules for the Mesh Client desktop UI, written for contributors and for AI coding agents. It came out of the redesign in [issue #1062](https://github.com/Colorado-Mesh/mesh-client/issues/1062) (Option B navigation with Option C's launcher, planned for v6). The mockups and screenshots are on that issue.

When a rule here conflicts with an older panel, follow this guide for new or changed UI and leave untouched panels alone (no drive-by restyling; see `AGENTS.md`).

## Quick checklist

Use this before opening a PR that touches UI.

- Colors come from the tokens in [Color](#color). No new hex values, no gradients, glows or text shadows.
- Protocol colors (cyan, amber, and green on the Meshtastic badge) appear only on the protocol switcher and its badges.
- Every icon-only control has an `aria-label`. Text meets 4.5:1 contrast. Slate-500 and darker are never used for text.
- New or changed UI with colored fills has a `vitest-axe` test that calls `hydrateAxeThemeColors()`.
- Copy follows [Copy](#copy): no em or en dashes, no emoji, sentence case, strings in `en/translation.json`.
- A new panel has a slot in `tabSlotIds.ts`, a capability in `appTabMappings.ts`, and a rail section in `navSections.ts`.
- The layout works at 1024x768 (tested) and does not break at 900x600 (best effort).
- Behavior is the same on Linux, macOS and Windows. Shortcuts use Cmd on macOS and Ctrl elsewhere.

## Layout

The v6 shell has four parts. Their code lives in `src/renderer/components/shell/`.

| Part           | Size             | Holds                                                                                                                        |
| -------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| App rail       | 72px wide        | Protocol switcher (MT / MC / RN), then Chat, Network, Map, Monitor, Device; Incident and App at the bottom                   |
| Section header | 52px tall        | Section name, the section's panels as a segmented tablist, then global actions (flood advert, launcher, language)            |
| Status bar     | 28px tall        | Radio link, MQTT, TAK, send queue and queue indicators on the left; contact and message counts and update state on the right |
| Launcher       | 680px wide modal | Every visible panel, grouped by section and searchable, with pin toggles                                                     |

Where things go:

- Link state and counts belong in the status bar, not in panels or the header. Status bar items are buttons that open the owning panel.
- App-wide actions go in the section header's action area. Keep it short; it has to fit at 1024px next to five sub-tabs.
- Panel actions go in the panel's own toolbar, not in the shell.
- Panels scroll inside the main viewport. Do not add a second horizontal scroll container.

Small screens: the Electron minimum window is 900x600 (`src/main/index.ts`). Test at 1024x768 (`e2e/small-window.spec.ts`); below that is best effort. The rail compacts its buttons below 720px of height and scrolls if it must. The section tablist scrolls horizontally rather than wrapping. Status bar counts hide below the `lg` breakpoint.

## Navigation

Sections and the panels in them (MeshCore shown; other protocols drop what their capabilities hide):

| Section  | Panels                                                                               |
| -------- | ------------------------------------------------------------------------------------ |
| Chat     | Chat, Rooms, RRC, Games                                                              |
| Network  | Contacts / Nodes / Peers, Repeaters, Graph, Topology, Nomad Network, Remote          |
| Map      | Map                                                                                  |
| Monitor  | Diagnostics, Telemetry, Stats, Sniffer, RF                                           |
| Device   | Connection, Radio (Network on Reticulum), Modules (Meshtastic), Admin, Security, TAK |
| Incident | Incident                                                                             |
| App      | App                                                                                  |

Rules:

- Panel labels do not change when they move into a section. Every panel stays reachable from the rail and from the launcher.
- Clicking a section reopens the panel last shown in it for the current protocol.
- Gate panels with capabilities (`ProtocolCapabilities`), never with `protocol === '...'`. Sections with no visible panel are hidden.
- Adding a panel: add the slot to `TAB_SLOT_IDS`, its requirement to `TAB_CAPABILITY_REQUIREMENTS`, and its section to `SECTION_SLOT_ORDER` in `navSections.ts`. `navSections.test.ts` fails if a slot has no section. The launcher and badges pick it up from there.
- Badges: unread messages use `bg-red-600`, pending rncp file offers use `bg-amber-800`, both with white text (`lib/navBadges.ts`). The rail badge is the sum of its section's badges. Counts cap at `99+`. The accessible name carries the count, for example "Chat, 6 unread".

## Keyboard

| Shortcut                        | Action                                                   |
| ------------------------------- | -------------------------------------------------------- |
| Ctrl+K (Cmd+K on macOS)         | Open or close the launcher                               |
| Ctrl+1 to Ctrl+4 (Cmd on macOS) | Open pinned panel 1 to 4                                 |
| Arrow keys, Home, End           | Move between section tabs (automatic activation)         |
| Up and Down in the launcher     | Move between panels; Up from the first returns to search |
| Enter in the launcher           | Open the first match, or the focused panel               |
| Ctrl+P (Cmd+P) in the launcher  | Pin or unpin the focused panel                           |
| Esc                             | Close the launcher or dialog                             |

Pins are stored in `mesh-client:launcherPins`, shared by all protocols, four at most. The defaults are Chat, Contacts, Map and Connection. A pin for a panel the current protocol hides does nothing on that protocol.

Dialogs trap Tab, close on Esc, and return focus to the control that opened them.

## Color

Use the Tailwind token classes, not hex. Users can change the tokens in App > Appearance > Colors (`src/renderer/lib/themeColors.ts`), and hard-coded hex ignores their choice.

| Token (class)                                 | Default               | Use                                                        |
| --------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| `bg-app-bg`                                   | `#020617`             | App background, section header, main viewport              |
| `bg-deep-black`                               | `#0f172a`             | Rail, status bar, cards, panels, launcher                  |
| `bg-sidebar-active-bg`                        | `#1e293b`             | Active nav item, selected row, hover fill                  |
| `border-slate-800`                            | `#1e293b`             | Hairlines between shell parts and inside cards             |
| `bg-secondary-dark` / `border-secondary-dark` | `#334155`             | Secondary control fill, stronger borders                   |
| `text-muted`                                  | `#94a3b8`             | Muted text, placeholders, inactive icons                   |
| `text-slate-300`                              | `#cbd5e1`             | Secondary text                                             |
| `text-slate-200`                              | `#e2e8f0`             | Primary text                                               |
| `text-bright-green`                           | `#86efac`             | App accent: active nav, sender names, success text         |
| `bg-readable-green`                           | `#15803d`             | Fills under white text (primary buttons, Meshtastic badge) |
| `bg-green-500`                                | `#22c55e`             | Online and connected status dots only                      |
| `text-red-400` / `bg-red-600`                 | `#f87171` / `#dc2626` | Danger text and outlines / unread badge fill               |
| `text-blue-400`                               | `#60a5fa`             | Links, RF source icon                                      |

Protocol colors: MeshCore cyan (`text-cyan-400`, badge `bg-cyan-800`), Reticulum amber (`text-amber-400`, badge `bg-amber-800`), Meshtastic uses brand green. They appear only on the protocol switcher and its badges (`lib/protocolTheme.ts`).

Never use `#000000` or `#ffffff` as a surface, gradients, glows, text shadows, or left-border accent stripes on cards and rows.

## Type

- Body text uses IBM Plex Sans (`font-sans`). Message text is 14px, most UI text 13px, secondary labels 12px, badges and status bar 11 to 11.5px.
- Use the mono stack (`font-mono`) for IDs, keys, numbers, times, queue counts and the status bar. Add `tabular-nums` where numbers update in place.
- Section titles are 16px semibold; panel titles 18px semibold.
- The UI typeface is IBM Plex Sans with IBM Plex Mono for mono text (OFL-1.1), bundled under `src/renderer/assets/fonts/plex` with latin, latin-ext and cyrillic subsets so every locale except CJK renders in Plex; CJK falls back to the system font. Weights: sans 400, 500 and 600; mono 400 and 500. Never add web font links; the app must work offline.

## Controls

- Buttons: 30 to 36px tall, radius 8px (`rounded-lg`), label 13px medium, with an icon when it helps.
  - Primary: `bg-readable-green` with white text. One per view.
  - Secondary: `bg-sidebar-active-bg` with `border-secondary-dark`.
  - Danger: an outline sized to its label (red-400 text, faint red border, transparent fill). Never a full-width red bar.
  - Icon-only: 30 to 32px square, transparent, `text-muted`, `aria-label` and `title`.
- Related actions sit in a button group with shared borders. A main action with rare variants is a split button (Export with its formats; Disconnect with "Disconnect all and quit").
- Table rows get one overflow menu for their actions, not a row of colored buttons.
- Segmented controls (section tabs, filters): `bg-deep-black` track with `border-slate-800`, active segment `bg-sidebar-active-bg` with `text-slate-200`, others `text-muted`.
- Inputs: 32px tall, `bg-app-bg`, `border-secondary-dark`, radius 6 to 8px, a real `<label>` (visually hidden is fine).
- Numbers the user nudges (retry counts) use a stepper: minus, value, plus.
- Label and value pairs sit in a grid inside their card (about 560px wide at most), never stretched across the window.
- Cards and panels: `bg-deep-black`, `border-slate-800`, radius 12px.
- Status: a dot only where it carries state (online, stale, offline; connected, stopped). Pulses go on a separate `aria-hidden` element, never on small text (see `ProtocolUnreadBadge.tsx`).

## Components

Use the shared primitives in [`src/renderer/components/ui/`](https://github.com/Colorado-Mesh/mesh-client/tree/main/src/renderer/components/ui) instead of restyling native elements per panel. They already carry the sizes, tokens and ARIA wiring above.

| Need                                                           | Use                                              |
| -------------------------------------------------------------- | ------------------------------------------------ |
| Button (primary, secondary, danger, ghost) or icon-only button | `Button`, `IconButton` (`Button.tsx`)            |
| Related actions with shared borders                            | `ButtonGroup`, `GroupButton`                     |
| Main action with rare variants; row overflow actions           | `SplitButton`, `MenuButton`, `Menu` (`Menu.tsx`) |
| Filter or mode choice                                          | `SegmentedControl` (radio group, arrow keys)     |
| On/off setting with a description                              | `Switch`                                         |
| Small integers (retry counts)                                  | `Stepper`                                        |
| Card with a 56px header, title, status and actions             | `Panel`                                          |
| One link at a glance (radio, MQTT, TAK)                        | `StatusTile`, `StatusDot`                        |
| Label and value pairs                                          | `LabelValueGrid`, `LabelValue`                   |
| Read-only value with a copy button                             | `CopyField`                                      |
| Shortcut hint                                                  | `Kbd`                                            |
| Inputs, selects, checkboxes, chips, inline notices             | class strings in `formClasses.ts`                |

Menus render in a portal above modals (`Z_POPOVER_MENU` in `lib/modalZIndex.ts`), close on Escape or outside click, and return focus to their trigger.

## Copy

- No em or en dashes. Use a comma, a period or a hyphen.
- No emoji. At most one middle dot per line.
- Sentence case for labels and group headings. No uppercase letter-spaced micro labels.
- Name things the way the rest of the app does (Contacts on MeshCore, Nodes on Meshtastic, Peers on Reticulum; the tab label keys do this).
- Every string goes through `t()` with an English key in `src/renderer/locales/en/translation.json`. See [`docs/agents/i18n.md`](agents/i18n.md).

## Accessibility

- Real `<button type="button">` and `<input>` elements with labels; `aria-label` on icon-only buttons.
- `aria-current="page"` on the active rail section; `role="tablist"` with `aria-selected`, `aria-controls` and roving `tabIndex` on section tabs.
- Text contrast 4.5:1. `readable-green` must keep 4.5:1 under white (`themeColors.test.ts`).
- Component tests assert `toHaveNoViolations()` after `hydrateAxeThemeColors()`; do not mock `themeColors` in axe tests.
- The status bar keeps a polite live region for radio link changes.
- More in [`docs/accessibility-checklist.md`](accessibility-checklist.md).

## Status

Done in the first v6 PR: the rail, section header, status bar, launcher with pins and shortcuts, the brand mark and community links moved to App > About, and this guide.

Still to do, each as its own PR: the Contacts detail pane (replacing the node detail modal), Connection status tiles with split Disconnect and a stepper, chat bubble and toolbar restyle, the Repeaters row overflow menu, RRC and MeshCore Rooms layouts (the four side panels problem), and the font decision.
