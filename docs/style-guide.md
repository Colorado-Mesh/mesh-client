# UI style guide

Rules for the Mesh Client UI (desktop today, iOS and Android later), written for contributors and for AI coding agents. It combines the Colorado Mesh style guide by ashortgrayble (color scales, type system, radius, elevation) with the v6 redesign from [issue #1062](https://github.com/Colorado-Mesh/mesh-client/issues/1062): Option B navigation (rail, section tabs, status bar) plus Option C's launcher.

The source of truth for exact values, contrast ratios and rationale is the [Colorado Mesh style guide in Figma](https://www.figma.com/design/ZPZsHgPZX8dQTUYzP4uDjZ/Colorado-Mesh?node-id=17-4). The tokens in `src/renderer/styles.css` carry its values.

When a rule here conflicts with an older panel, follow this guide for new or changed UI. Source-policy rules (see [Enforcement](#enforcement)) keep the most important ones from regressing.

## Who we design for

| Persona                | Uses                                                     | What matters                                                             |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Hobbyists (most users) | Chat above all, on a desktop; ages 16 to 78              | Chat that never loses a message, larger text on demand, obvious features |
| Mesh operators         | Diagnostics, map layers, Repeaters, Sniffer              | Dense data that stays fast with very large lists                         |
| Emergency managers     | MECP, Incident, map layers                               | Incident always one click away, unambiguous status colors                |
| Field responders       | Same as managers, on laptops running on battery, offline | Works with no internet, low motion, readable in daylight                 |

Impact grows from "it is fun" to "a retiree misses the conversation" to "emergency traffic". Treat anything on the chat or incident path as the last kind.

Principles:

1. Chat first. It is 99% of use once connected; nothing may push it out of reach.
2. Every feature is discoverable: from the rail, the section tabs, or the launcher (Ctrl+K / Cmd+K).
3. Design for 100,000 items. The app caps most lists at 10,000 by default, users can raise it. Virtualize or cap work, never do O(n) work per keystroke or per render on a hot path.
4. Everything can scroll vertically; wide content scrolls horizontally inside its own container, never the page.
5. Offline and on battery: no network fonts or assets, no decorative animation when Reduce motion is on.
6. Color carries meaning (status, protocol) and is never the only signal: pair it with text, an icon or a shape.

## Quick checklist

- Colors come from [tokens and scales](#color). No new hex, no gradients, glows or text shadows. Neutrals are ink.
- Text sizes are rem tokens ([Type](#type)); readable text is 12px or larger. No `text-[13px]`.
- Radius and shadow come from the tokens in [Radius](#radius) and [Elevation](#elevation).
- Icons are Lucide (`lucide-react-motion`); never emoji or text glyphs as icons.
- Every icon-only control has an `aria-label`; text meets 4.5:1.
- New or changed UI with colored fills has a `vitest-axe` test that calls `hydrateAxeThemeColors()`.
- Copy: sentence case, no em or en dashes, no emoji, strings in `en/translation.json`.
- A new panel has a slot in `tabSlotIds.ts`, a capability in `appTabMappings.ts` and a section in `navSections.ts`.
- Works at 1024x768 and at phone width (390px); same on Linux, macOS and Windows.

## Color

Everything uses Tailwind utility classes. Theme tokens (below) are CSS variables users can change in App > Appearance > Colors (`src/renderer/lib/themeColors.ts`); hard-coded hex ignores their choice and is only allowed in canvas drawing and Leaflet marker HTML.

`themeColors.ts` writes the theme tokens onto `:root` as inline styles at boot, which overrides the `@theme` block in `styles.css`. A changed default must change in both `styles.css` and `DEFAULT_THEME_COLORS`; `styleTokens.test.ts` fails when they drift.

### Neutrals (ink)

Neutrals come from the Midnight Serenity palette picked during review: Ink Black `#11151c` (950), Deep Space Blue `#212d40` (800) and Charcoal Blue `#364156` (700). The other steps are derived. 900 sits halfway between 950 and 800, and 50 to 600 keep Tailwind slate's lightness per step with the palette's hue, so text contrast stays where it was. The scale is `--color-ink-*` in `styles.css`, and a [theme](#themes) surface swaps all eleven steps at runtime.

Use `ink-*` utilities or the tokens below; `slate-*`, `zinc-*` and `gray-*` are rejected by source policy. Zinc was tried first and read as brown next to the Reticulum yellow.

| Token / class                                 | Default (ink)         | Use                                                   |
| --------------------------------------------- | --------------------- | ----------------------------------------------------- |
| `bg-app-bg`                                   | `#11151c` (950)       | App background, section header, main viewport         |
| `bg-deep-black`                               | `#19212d` (900)       | Rail, status bar, cards, panels, menus, launcher      |
| `bg-sidebar-active-bg`                        | `#212d40` (800)       | Active nav item, selected row, hover fill             |
| `border-ink-800`                              | `#212d40`             | Hairlines between shell parts and inside cards        |
| `bg-secondary-dark` / `border-secondary-dark` | `#364156` (700)       | Secondary control fill, field borders, stronger lines |
| `text-muted`                                  | `#93a0b7` (400)       | Secondary text, placeholders, inactive icons          |
| `text-ink-300` / `text-ink-200`               | `#cdd4e2` / `#e3e8f0` | Body text / primary text                              |

`ink-500` and darker are never text on dark surfaces (under 4.5:1).

### Protocol scales

Each protocol has a five-step scale, tuned in OKLCH and contrast-checked per step on light and dark backgrounds. Use the token classes (`text-meshtastic-500`, `bg-meshcore-700`, `border-reticulum-300`, and so on). The 500 base step marks the protocol (rail switcher, its name, identity links); the 700 step is the fill under white text (badges).

| Protocol   | Token prefix  | 100       | 300       | 500 (base) | 700       | 900       |
| ---------- | ------------- | --------- | --------- | ---------- | --------- | --------- |
| Meshtastic | `meshtastic-` | `#d1fae5` | `#a7f3d0` | `#67e8b4`  | `#047857` | `#064e3b` |
| MeshCore   | `meshcore-`   | `#cffafe` | `#a5f3fc` | `#00d3f2`  | `#0e7490` | `#164e63` |
| Reticulum  | `reticulum-`  | `#fef9c3` | `#fef08a` | `#facc15`  | `#a16207` | `#713f12` |

Reticulum is yellow, not amber, so it never reads as a warning. Protocol classes live in `lib/protocolTheme.ts` and are fixed: they keep their identity under every theme.

### Accent (theme)

The accent tokens follow the selected theme preset; the default preset is Meshtastic.

| Token / class                          | Default                  | Use                                                                        |
| -------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `text-bright-green` / `bg-brand-green` | `#67e8b4` meshtastic-500 | Accent: active nav, selection, focus ring, links, primary buttons          |
| `text-app-bg` on `bg-brand-green`      |                          | Primary button label (dark on accent, about 13:1)                          |
| `bg-readable-green`                    | `#047857` meshtastic-700 | Fills under white text; must keep 4.5:1 with white (`themeColors.test.ts`) |
| `--color-chat-outgoing-bg` / `-border` | 700 at 22% / 500 at 25%  | Own chat bubbles                                                           |

The token names say "green" for history; they hold whatever accent the theme sets.

### Status (semantic)

Status colors never double as the accent. The style guide gives each a Light-BG, Main and Dark-Text step. The Main step is a token; the other two are Tailwind steps until the designer's values are in `styles.css`.

| Meaning                 | Main token (dots, icons)   | Text on dark surfaces | Light (tint)             | Dark (fills) |
| ----------------------- | -------------------------- | --------------------- | ------------------------ | ------------ |
| Success, online         | `status-success` `#34d399` | `green-400`           | `green-900/40` or `100`  | `green-800`  |
| Warning, caution, stale | `status-warning` `#f97316` | `orange-400`          | `orange-900/40` or `100` | `orange-800` |
| Error, offline, danger  | `status-error` `#ef4444`   | `red-400`             | `red-900/40` or `100`    | `red-800`    |
| Info, neutral status    | `status-info` `#818cf8`    | `indigo-400`          | `indigo-900/40` or `100` | `indigo-800` |

- Status dots use `StatusDot` tones (`ok`, `idle`, `off`, `warn`, `error`, `info`), which read the Main tokens. Use `bg-status-*` / `text-status-*` for any other dot or status icon.
- Keep the `-400` steps for status text: the Main error red is under 4.5:1 on `ink-800` rows.
- Red means broken; orange means caution or delay (maintainer rule). Unread badges stay `bg-red-600` with white text, like the macOS dock.
- Inline notices use `NOTICE_CLASS` in `formClasses.ts`.

Allowed exceptions: favourite stars are `yellow-400`; search highlights are yellow; data scales (battery, SNR, MECP severity, chart series, packet types) keep their own ramps and are labelled.

### Themes

App > Appearance > Colors has two one-click choices (`lib/themePresets.ts`, `components/ThemePicker.tsx`). Any surface pairs with any accent, and single tokens can still be edited afterwards.

- **Surfaces** replace the whole neutral scale (every `ink-*` class, through `--color-ink-*` on `:root`) and the neutral tokens: Midnight (default), Slate, Zinc, Graphite, Deep sea, Dusk, Evergreen and High contrast. Deep sea, Dusk and Evergreen keep Midnight's lightness and chroma per step with another hue, so they stay tinted neutrals rather than colored backgrounds. High contrast brings body text near white and lifts field borders to 3:1 against panels (WCAG 1.4.11).
- **Accents** set the accent and the sent-message bubbles: Meshtastic (default), MeshCore, Reticulum, Sky and Classic green (the pre-v6 green). Slate with Classic green is the pre-v6 look.

`themePresets.test.ts` checks every surface's text pairs and every surface and accent pair against the guards in `themeColors.ts`, so no combination is ever reset. A light theme needs a sweep of hard-coded dark text first.

Never use `#000000` or `#ffffff` as a surface, gradients, glows, text shadows, or left-border accent stripes on cards and rows.

## Type

IBM Plex Sans for interface text (headings, body, labels, navigation); IBM Plex Mono for data readouts, signal metrics, IDs, keys, code and tabular numbers. Both are bundled (`src/renderer/assets/fonts/plex`, OFL-1.1) so the UI renders the same offline; CJK falls back to the system font.

All sizes are rem, so App > Appearance > Text size scales the whole UI (the root `font-size` is set by `lib/fontScale.ts`). Never use px font sizes; source policy rejects `text-[13px]`.

| Style guide role | Class                              | Size / line height | Use                                      |
| ---------------- | ---------------------------------- | ------------------ | ---------------------------------------- |
| Display          | `text-4xl font-light`              | 36 / 40            | Rare; empty-state hero                   |
| H1               | `text-3xl font-semibold`           | 30 / 36            | Page title (rare inside panels)          |
| H2               | `text-2xl font-semibold`           | 24 / 32            | Panel page titles                        |
| H3               | `text-lg font-medium`              | 18 / 28            | Section titles                           |
| H4               | `text-title font-semibold`         | 16 / 22            | Pane and card titles                     |
| H5               | `text-sm font-semibold`            | 14 / 20            | Group headings                           |
| Body             | `text-body-lg`                     | 14 / 20            | Chat messages, paragraphs                |
| Body (dense)     | `text-body`                        | 13 / 18            | Rows, inputs, menus, most controls       |
| Control          | `text-control`                     | 13 / 18            | Small buttons, chips                     |
| Caption          | `text-label`, `text-xs`            | 12 / 16            | Labels, captions, rail labels            |
| Data / tabular   | `font-mono text-meta tabular-nums` | 12 / 16            | Times, IDs, metrics that update in place |
| Badge            | `text-2xs`                         | 11 / 16            | Badge and tag text only                  |
| Count pill       | `text-3xs`                         | 10 / 14            | Numeric count pills only                 |

Tailwind's own `text-2xl` to `text-4xl` sizes are close to the guide's 22, 28 and 36px headings; use them until the designer's heading tokens are final.

Minimum: 12px for anything a person reads; 13px body for dense data views, 14px for standard content. Line height 1.4 to 1.5 for body, 1.2 to 1.3 for headings. Weights: sans 400, 500, 600; mono 400, 500. Those are the only faces bundled, so anything heavier is synthesized: `font-semibold` is the top weight for sans and `font-medium` for mono.

## Spacing

A 4px grid (Tailwind spacing, base 1rem = 16px): `0.5` 2px (inline icon gaps), `1` 4px (tight element gaps), `1.5` 6px (dense list spacing), `2` 8px (standard gaps), `3` 12px (compact padding), `4` 16px (card padding), `5` 20px, `6` 24px (section gaps), `8` 32px (major gaps), `12` 48px, `16` 64px (page margins). Main content padding is `p-1.5` on phones, `p-2.5` on tablets and `p-4` on desktop, so chat and the other panels get the space.

## Radius

Radius tokens in `styles.css` (`--radius-*`), so a family changes in one place. The sizes are Tailwind's stock scale; the Figma names use Tailwind v3's naming, which v4 (this app) shifted by one step, so the roles get their own class names:

| Class               | Size | Figma name | Stock v4 class | Use                                       |
| ------------------- | ---- | ---------- | -------------- | ----------------------------------------- |
| `rounded-none`      | 0    |            | `rounded-none` | Tables, inline data                       |
| `rounded-badge`     | 2px  | `sm`       | `rounded-xs`   | Badges, chips, tags, segments, menu items |
| `rounded-control`   | 4px  | (default)  | `rounded-sm`   | Buttons, inputs, selects, map controls    |
| `rounded-card`      | 6px  | `md`       | `rounded-md`   | Cards, panels, popovers, menus, notices   |
| `rounded-modal`     | 8px  | `lg`       | `rounded-lg`   | Modals, sheets                            |
| `rounded-container` | 12px | `xl`       | `rounded-xl`   | Page sections, large containers           |
| `rounded-full`      | pill |            | `rounded-full` | Pills, avatars, toggles, dots             |

## Elevation

The style guide's shadows are tuned for dark surfaces (much heavier than Tailwind's light-mode shadows), so they are their own tokens, not overrides of `shadow-sm` / `shadow-md` / `shadow-lg`. Source policy rejects the stock classes.

| Level | Class            | Use                                      |
| ----- | ---------------- | ---------------------------------------- |
| 0     | none             | Inline elements, table rows              |
| 1     | `shadow-level-1` | Cards, list items                        |
| 2     | `shadow-level-2` | Dropdowns, popovers, menus, map controls |
| 3     | `shadow-level-3` | Modals, dialogs                          |
| 4     | `shadow-level-4` | Toasts, floating panels                  |

The values in `styles.css` are provisional until the Figma shadows are copied in.

## Icons

- Lucide icons from `lucide-react-motion`, 14px (`h-3.5 w-3.5`) inline with 12 to 13px text, 16px (`h-4 w-4`) in buttons and the rail, 20px for pane actions. Decorative icons get `aria-hidden`.
- Never emoji or text glyphs as icons (⚠ ✕ ✓ ★ 📍 ← → ↻): they render differently per OS. Source policy flags a JSX line that is only such a glyph.
- Motion icons animate on hover of their parent (`PARENT_HOVER_ATTR`) and stop under Reduce motion.

## Layout

The v6 shell (`src/renderer/components/shell/`):

| Part           | Size        | Holds                                                                                                                                              |
| -------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| App rail       | 72px wide   | Protocol switcher (one segmented choice with the protocol name), Chat, Network, Map, Monitor, Device; Incident and App pinned at the bottom        |
| Section header | 52px tall   | Section name, its panels as a segmented tablist, global actions (flood advert, launcher, language, then Disconnect & Quit in red at the far right) |
| Status bar     | 28px tall   | Radio link, MQTT, TAK and queue on the left; counts and update state on the right                                                                  |
| Launcher       | 680px modal | Every visible panel plus contacts and channels, searchable, with pins                                                                              |

Phones and narrow windows (under 768px, `SHELL_COMPACT_QUERY`): the rail becomes a bottom bar with Chat, Network, Map, Incident and More; More opens the launcher as a bottom sheet. Touch targets grow with the `pointer-coarse:` variant (inputs 40px).

App > Protocols disables protocols the user does not run (`hiddenProtocols` in `mesh-client:appSettings`, all enabled by default; helpers in `lib/enabledProtocols.ts`). A disabled protocol leaves the switcher, is disconnected, and stays stopped across sleep and wake. It is skipped by RF auto-connect, Reticulum stack autostart, MQTT auto-launch, inactive-protocol toasts, notification clicks and Reticulum deep links. With one protocol enabled the switcher is not rendered in the rail or the More sheet.

Where things go:

- Link state and counts belong in the status bar; items there open the owning panel.
- App-wide actions go in the section header; panel actions in the panel's toolbar.
- Panels scroll inside the main viewport. Wide tables scroll horizontally inside their own container.
- Detail panes: on wide windows node and peer details open inline next to the list or the map (`DetailPaneHost`), and the map shrinks; on narrow windows they open as a modal. Actions lead the pane.
- Conversations (Chat, Rooms, RRC) use `chat/ConversationLayout`: list column, conversation, optional side panel (narrow or wide), collapsing to one pane at a time on phones.

Small windows: minimum 900x600 on desktop; test at 1024x768 and 390px. The rail compacts below 720px of height and scrolls; the section tablist scrolls horizontally.

## Navigation

| Section       | Panels                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------ |
| Chat          | Chat, Rooms, RRC, Games                                                                    |
| Network       | Contacts / Nodes / Peers, Repeaters, Graph, Topology, Remote, TAK                          |
| Map           | Map                                                                                        |
| Nomad Network | Nomad Network (Reticulum only; its own rail entry)                                         |
| Monitor       | Diagnostics, Stats, Sniffer, RF                                                            |
| Device        | Connection, Radio (Network on Reticulum), Modules (Meshtastic), Telemetry, Admin, Security |
| Incident      | Incident                                                                                   |
| App           | App                                                                                        |

- Panel labels do not change when they move into a section. Every panel is reachable from the rail and the launcher.
- Clicking a section reopens the panel last shown in it for the current protocol.
- Gate panels with `ProtocolCapabilities`, never `protocol === '...'`. Sections with no visible panel are hidden.
- Adding a panel: slot in `TAB_SLOT_IDS`, requirement in `TAB_CAPABILITY_REQUIREMENTS`, section in `SECTION_SLOT_ORDER` (`navSections.ts`).
- Badges: unread `bg-red-600`, pending rncp offers `bg-orange-800`, both with white text (`lib/navBadges.ts`); counts cap at `99+`; the accessible name carries the count.

## Keyboard

Cmd on macOS and iOS, Ctrl on Windows, Linux and Android (`usesCommandModifier` / `formatShortcut` in `lib/panelLauncher.ts`). Pins are stored in `mesh-client:launcherPins`, shared by all protocols, four at most. Nothing is pinned by default (`DEFAULT_LAUNCHER_PINS` is `[]`).

| Shortcut                       | Action                                          |
| ------------------------------ | ----------------------------------------------- |
| Ctrl+K (Cmd+K)                 | Open or close the launcher                      |
| Ctrl+1 to Ctrl+4 (Cmd)         | Open pinned panel 1 to 4                        |
| Arrow keys, Home, End          | Move within tablists, segmented controls, menus |
| Up and Down in the launcher    | Move between results                            |
| Enter in the launcher          | Open the focused or first result                |
| Ctrl+P (Cmd+P) in the launcher | Pin or unpin the focused panel                  |
| Esc                            | Close the launcher, menu or dialog              |

Dialogs trap Tab, close on Esc and return focus to their trigger.

## Controls

Use the class strings and primitives; do not restyle native elements per panel.

- Buttons (`Button`, `buttonClassName`): `rounded-control`, 30 or 32px tall, 13px medium label, optional 14 to 16px icon.
  - Primary: accent fill with `text-app-bg`. One per view.
  - Secondary: `bg-sidebar-active-bg` with `border-secondary-dark`.
  - Danger: red outline sized to its label. Never a full-width red bar. A stacked list of destructive actions with a second line uses `DANGER_ROW_CLASS`.
  - Ghost and icon-only (`IconButton`): transparent, `text-muted`, `aria-label` and `title`.
- A main action with rare variants: `SplitButton`. Row actions: one `MenuButton` overflow menu.
- Single choice (filters, modes, protocol): `SegmentedControl` (`role="radiogroup"`, arrow keys). Toggle chips with `aria-pressed`: `chipClass()`.
- Fields: `INPUT_CLASS` / `SELECT_CLASS` / `TEXTAREA_CLASS` (full width) or the `*_BOX_CLASS` variants sized by their row (`w-24`, `flex-1`); `*_BOX_SM_CLASS` for dense rows. 32px (28px compact), 40px on touch. Invalid state comes from `aria-invalid`. Every field has a label (visually hidden is fine).
- On/off settings: `Switch`. Small integers: `Stepper`. Read-only values: `CopyField`.
- Label and value pairs: `LabelValueGrid` inside their card, about 560px wide at most.
- Cards: `Panel` (`bg-deep-black`, `border-ink-800`, `rounded-card`, level 1). Settings sections: `bg-deep-black rounded-xl border border-ink-800`.
- Notices: `NOTICE_CLASS.info|warn|error|success`.
- Map overlays: `MAP_CONTROL_CLASS`, `MAP_CHIP_CLASS`, `MAP_OVERLAY_PANEL_CLASS` (`map/mapControlClasses.ts`); Leaflet's own controls are restyled in `styles.css`.
- Status: `StatusDot` only where it carries state; pulses on a separate `aria-hidden` element, never on small text.

| Need                                          | Use                                                         |
| --------------------------------------------- | ----------------------------------------------------------- |
| Buttons, icon buttons                         | `Button`, `IconButton`, `buttonClassName` (`ui/Button.tsx`) |
| Split button, overflow menu                   | `SplitButton`, `MenuButton`, `Menu` (`ui/Menu.tsx`)         |
| Single choice                                 | `SegmentedControl`                                          |
| Switch, stepper                               | `Switch`, `Stepper`                                         |
| Card with header                              | `Panel`                                                     |
| Link status                                   | `StatusTile`, `StatusDot`                                   |
| Label and value pairs                         | `LabelValueGrid`, `LabelValue`                              |
| Copyable value                                | `CopyField`                                                 |
| Horizontal strip of chips                     | `ScrollStrip`                                               |
| Shortcut hint                                 | `Kbd`                                                       |
| Fields, chips, notices                        | `ui/formClasses.ts`                                         |
| Conversation layout                           | `chat/ConversationLayout`                                   |
| Channel or DM switcher (thousands of entries) | `chat/ChatChannelSwitcher`                                  |

Menus render in a portal above modals (`Z_POPOVER_MENU`), close on Esc or outside click and return focus to the trigger.

## Chat

- Bubbles: incoming `--color-chat-incoming-*` (ink-800 at 38%), own messages `--color-chat-outgoing-*` (accent 700 at 22% with a 300 border at 25%), max width 94% of the row on phones and 80% wider, with no rem cap so wide windows keep long messages on one line.
- Sender initials (`lib/senderInitials.ts`) or the Reticulum face in a gutter on the first message of a run; the sender line carries name, time and hop or RF metadata.
- The composer is one field with the send button inside the row; the hint about Enter and Shift+Enter hides on touch.
- The channel and DM switchers are searchable and built for thousands of entries.
- Message action colors (bar background, button hover, "Always show message actions") are themeable in App > Appearance > Colors.

## Motion and battery

- App > Appearance > Reduce motion (seeded from the OS setting) stops decorative pulses and shortens transitions app-wide (`html[data-reduce-motion='true']` in `styles.css`).
- Status motion that carries meaning (connecting, logging in, sending, MAYDAY / URGENT) keeps moving: give it the `motion-status` class.
- No network fonts, emoji data or images: they are bundled (`assets/fonts/plex`, and the English emoji data from `emoji-picker-element-data` at build time).

## Copy

- Sentence case for labels, buttons and headings. No uppercase letter-spaced micro labels.
- No em or en dashes; use a comma, period or hyphen. No emoji. At most one middle dot per line.
- Name things the way the rest of the app does (Contacts on MeshCore, Nodes on Meshtastic, Peers on Reticulum).
- Every string goes through `t()` with an English key in `src/renderer/locales/en/translation.json`; see [`docs/agents/i18n.md`](agents/i18n.md).

## Accessibility

- Real `<button type="button">` and labelled inputs; `aria-label` on icon-only buttons.
- `aria-current="page"` on the active rail section; section tabs are a `tablist` with roving `tabIndex`; single choices are radio groups.
- Text contrast 4.5:1; large text and non-text 3:1. `readable-green` keeps 4.5:1 under white, the accent keeps 4.5:1 on `app-bg` (`themeColors.ts` guards reset overrides that fail).
- Component tests assert `toHaveNoViolations()` after `hydrateAxeThemeColors()`; never mock `themeColors` in axe tests.
- Everything scales with App > Appearance > Text size; test at 150%.
- More in [`docs/accessibility-checklist.md`](accessibility-checklist.md).

## Enforcement

Source-policy rules in `src/architecture/sourcePolicyRules.ts` (Vitest, pre-commit):

| Rule                                     | Rejects                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `renderer-font-size-in-rem`              | `text-[Npx]` font sizes                                                  |
| `renderer-ink-neutrals`                  | `slate-*`, `zinc-*` and `gray-*` palette classes                         |
| `renderer-elevation-levels`              | stock `shadow-xs` to `shadow-2xl` classes                                |
| `renderer-bundled-font-weights`          | `font-bold`, `font-extrabold`, `font-black` (only Plex 400 to 600 ship)  |
| `renderer-no-muted-text-on-control-fill` | muted text on a resting `bg-secondary-dark` (under 4.5:1 in every theme) |
| `renderer-no-low-contrast-gray-text`     | `text-ink-500` (and slate, zinc, gray-500) text                          |
| `renderer-no-uppercase-micro-labels`     | `uppercase` with `tracking-wide*`                                        |
| `renderer-icons-not-glyphs`              | a JSX line that is only ⚠ ✕ ✓ ✗ ★ ☆ 📍 ↻ ⌂ ⌀ ℹ                           |
| `axe-tests-hydrate-theme-colors`         | axe tests that skip `hydrateAxeThemeColors()`                            |

## Open items

- From the designer's Figma: the status Light-BG and Dark-Text steps, and the exact Level 1 to 4 shadows. Protocol scales, status Main colors and type are already exact.
- Neutrals: Midnight Serenity gives three dark steps. The light steps used for text (ink-50 to ink-600) are derived; exact values from the designer drop into `--color-ink-*`.
- Protocol colors outside `protocolTheme.ts` (for example some Reticulum panels and data ramps) still use Tailwind's `emerald` / `cyan` / `yellow` classes; move the ones that mark a protocol to the scale tokens.
- Status text still uses Tailwind's `-400` steps (v4 oklch values) next to the exact Main tokens used by dots.
- The Main success green (`#34d399`) sits close to the Meshtastic base (`#67e8b4`); status dots always come with text, so "online" is never color alone.
- The dark end of the Reticulum scale (700 and 900) leans toward orange; worth a look so it never reads as a dark warning.
- Field borders (`border-secondary-dark` on panels) are about 1.7:1 in every surface except High contrast, under the 3:1 WCAG 1.4.11 asks of a control boundary. Raising them changes the look, so it is a design call.
- A night vision field mode for eyes adjusted to the dark: red color surfaces rather than a whole-window filter (a filter costs CPU and battery on every repaint), with MAYDAY, URGENT and info badges still telling apart by more than brightness.
- A light theme.
- Per-protocol automatic theming (today the protocol accents are opt-in presets).
