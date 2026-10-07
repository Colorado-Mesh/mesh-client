# Localization & Languages

Mesh-Client is designed to be accessible to mesh users worldwide. The application currently supports **16 languages** and uses static translation bundles to ensure full functionality even when offline.

---

## Supported Languages

The following languages are currently supported:

- **English** (Source of Truth)
- **Spanish** (Español)
- **Ukrainian** (Українська)
- **German** (Deutsch)
- **Chinese (Simplified)** (中文)
- **Portuguese (Brazilian)** (Português do Brasil)
- **French** (Français)
- **Italian** (Italiano)
- **Polish** (Polski)
- **Czech** (Čeština)
- **Japanese** (日本語)
- **Russian** (Русский)
- **Dutch** (Nederlands)
- **Korean** (한국어)
- **Turkish** (Türkçe)
- **Indonesian** (Bahasa Indonesia)

---

## Changing Languages

To change the interface language:

1. Locate the **globe icon** in the application header.
2. Click the icon to open the language selection dropdown.
3. Select your preferred language.

The application will immediately update the UI strings. Your language preference is saved to your local settings and will persist across app restarts.

---

## Contributing Translations

Most translations in Mesh-Client are initially machine-generated using [MyMemory](https://mymemory.translated.net/). We rely on community contributions to improve translation quality and accuracy.

### Reporting an Error

If you find a mistranslation or an awkward phrasing:

1. Go to the [Mesh-Client Issues](https://github.com/Colorado-Mesh/mesh-client/issues) page.
2. Open a new [Translation Error](https://github.com/Colorado-Mesh/mesh-client/issues/new?assignees=&labels=translation&template=translation-error.md&title=Translation+Error) issue.
3. Provide the current text and your suggested correction.

### Adding a New Language

If you would like to help us add support for a new language:

1. Check existing issues to see if someone is already working on it.
2. Open a [Feature Request](https://github.com/Colorado-Mesh/mesh-client/issues/new?template=feature_request.md) specifically for the new language.
3. We will help you set up the initial locale files and guide you through the translation process.

---

## Offline Support

Translations are bundled as static JSON files within the application. Unlike many web apps, Mesh-Client **does not make network calls** to fetch translations at runtime. This ensures that the interface remains in your preferred language even when you are operating off-grid or in environments with no internet access.

---

## Maintainer workflow

For contributors changing UI text. English (`src/renderer/locales/en/translation.json`) is the source of truth; every other locale is filled from it.

### Adding strings

Add the key to `en/translation.json` and use `t('your.key')` in components. `pnpm run check:i18n` enforces that every call site resolves to an English key, and **fails on unused English keys** (a key with no static `t()` call, registered dynamic prefix, quoted literal in `src/`, or `tabs.*` entry from `TAB_SLOT_IDS`).

### Removing strings

Delete the key from `en/translation.json`, then run `pnpm run i18n:prune-unused -- --write` to drop it from every locale (or remove it by hand). `check:i18n` blocks orphaned English keys.

### Auto-translate

`pnpm run i18n:auto-translate` uses MyMemory by default, or LibreTranslate when `LIBRETRANSLATE_URL` is set. Existing translations are never overwritten.

| Mode                   | How to run                                                     | What it fills                                                                                                   |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Default (pre-commit)   | `pnpm run i18n:auto-translate`                                 | Keys that are **new in English vs `HEAD`** and still missing from a locale                                      |
| Backfill               | `pnpm run i18n:auto-translate --all` or `I18N_TRANSLATE_ALL=1` | Every key missing from a locale                                                                                 |
| Audit                  | add `--audit` or `I18N_AUDIT=1`                                | Also retranslates keys whose locale value is still identical to English                                         |
| Limit to a key subtree | add `--prefix a.b,c.d` (or `--prefix=a.b`)                     | Only keys equal to, or nested under, a prefix (`modulePanel` matches `modulePanel.foo`, not `modulePanelExtra`) |

MyMemory sends the contact `info@coloradomesh.org` by default for its 50k words/day quota; override with `MYMEMORY_EMAIL`.

### Key and quality check

`pnpm run check:i18n` hard-fails on missing or unused English keys. It warns (but does not fail) on incomplete locale coverage, so translation rate limits don't block commits. `pnpm run check:i18n:branch` skips the unused-key pass and only checks keys new or changed vs `HEAD`.

CI does **not** run `check:i18n` as a standalone workflow step. Quality rules run via **pre-commit** and indirectly in CI through Vitest (`locale-quality.test.ts` runs it as a subprocess).

### Quality checks (selected categories)

`scripts/check-i18n-quality.mjs` enforces more than missing keys. Notable rule families:

- **Mojibake** — garbled encodings are rejected.
- **Dash placeholders** — any English value that is a single dash (such as `common.emDash` or `signalMeter.noData`) must match exactly.
- **Boot-sequence transport labels** and **RRC slash-command tokens** — kept verbatim; RRC room wording must avoid false friends.
- **Reticulum hub/stack** (`connectionPanel.reticulumInterfaces.*`, `reticulumStack*`, `reticulumPeers.*`) — “hub”, “stack”, “peer”, and “host” must not become unrelated words (pressure, colleague, chimney stack, etc.).
- **TX/RX Texas** — radio `TX`/`RX` must not become the US state (Teksas, Техас, 德克萨斯) on any key.
- **URI / token spacing** — `tcp://`, `Wi-Fi`, and `I2P` must stay contiguous (no CAT `tcp ://` / `Wi - Fi` / `I 2 P`).
- **Flood / advert / room / backbone** — gated by English meaning, not a handful of leaf names (routing Flood, mesh advert, MeshCore/RRC room, network backbone — not water, ads, hotels, or spines).
- **Routing-port identifiers** — `NodeInfo`, `Telemetry`, `NeighborInfo`, `DiscoveryFlood`, `RoomAdvert` must match English verbatim (matched on the English value, not camelCase leaf names).
- **gamesPanel** — resign is forfeit (not quitting a job); draw is a tie (not a sketch/lottery); challenge/threefold are chess terms.
- **Repeaters CLI danger confirm** (`repeatersPanel.cliDangerConfirmAction`) — confirm button must be translated and must not read like “delete” or other false friends.
- **`repeatersPanel.cliMultiHopHint`** — must describe **multi-hop** CLI and automatic **Ping** before the first command, not multi-tab UI wording.

Full rule set: `scripts/check-i18n-quality.mjs` and `scripts/check-i18n-quality.test.mjs`.
