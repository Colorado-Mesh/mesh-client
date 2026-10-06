# Settings search (launcher Settings group)

Agent reference for the **Settings** group in the Ctrl/Cmd+K launcher (`PanelLauncher`). Typing a query lists matching settings; choosing one opens the owning panel, expands any collapsed section, scrolls the row to mid-viewport, flashes it, focuses its first control and announces the jump.

## Layout

| Piece                                   | Path                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Types, build, match, exemption matching | `src/renderer/lib/settingsSearch.ts`                                                        |
| Registry (one file per surface)         | `src/renderer/lib/settingsSearchEntries/*.ts`, each a `SettingsSearchSurface`               |
| Merged entries, files, exemptions       | `src/renderer/lib/settingsSearchEntries/index.ts`                                           |
| Lazy registry loader (own chunk)        | `src/renderer/lib/settingsSearchEntriesLoader.ts`; never import the registry from `App.tsx` |
| Reveal (details, scroll, flash, focus)  | `src/renderer/lib/settingsAnchor.ts`                                                        |
| rAF retry hook                          | `src/renderer/hooks/usePendingSettingAnchor.ts`                                             |
| Launcher group                          | `src/renderer/components/shell/PanelLauncher.tsx` (`settings` / `onOpenSetting`)            |
| App wiring                              | `src/renderer/App.tsx` (`buildLauncherSettings`, `openSettingFromLauncher`)                 |
| Anchor props                            | `Panel` `anchorId`, RadioPanel's local `ConfigSection` `anchorId`, or `data-setting-anchor` |
| Flash style                             | `src/renderer/styles.css` (`[data-setting-anchor][data-setting-flash]`)                     |

## Adding a searchable setting (checklist)

1. **Anchor the row** in the panel that renders it: `data-setting-anchor="<id>"` on the row wrapper (or on the control itself, e.g. a `<select>`), or `anchorId="<id>"` on `Panel` / `ConfigSection`. The value must be a **string literal** so the guards can read it.
2. **Add a registry entry** in `settingsSearchEntries/<surface>.ts`: `id`, `slot`, `labelKey` (the key the row renders), optional `sectionKey` (card heading, shown as the crumb), `keywords` (English synonyms) and `visible` (capability predicate) only when needed.
3. **New surface file?** Export a `SettingsSearchSurface` (`entries`, `files`, `exempt`) and add it to the surfaces list in `settingsSearchEntries/index.ts`. List every component file that holds a literal anchor in `files` with `sweepAllKeys: true`.
4. **Sweep the file's other keys:** every static `t('...')` key in a swept file is either a registry `labelKey` / `sectionKey` or matches an exemption (the surface's `exempt` map, merged into `SETTINGS_SEARCH_EXEMPT`) with a reason. Add an exact key or a pattern; never leave a stale exemption.
5. **Run** `pnpm exec vitest run src/renderer/lib/settingsSearch*.test.ts src/architecture/sourcePolicy.test.ts`.

## Id convention

`<slotCamel>.<subsectionCamel>.<settingCamel>` (two segments allowed), e.g. `app.gps.shareLocation`, `radio.lora.region`. The first segment is the owning `TabSlotId` with a lowercase first letter. Ids are globally unique and appear **once** per component file. Rows rendered in mutually exclusive protocol branches get distinct ids (`app.retention.meshcoreMessageCap` vs `app.retention.reticulumMessageCap`) with matching capability predicates.

## Visibility rule

- An entry is listed when its `slot` is a visible tab for the **active** protocol (`visibleSlots`) and its optional `visible(ctx)` passes.
- `SettingsSearchContext` holds only `capabilities` and `visibleSlots`. Predicates read capability flags, never `protocol === '...'`, stores or connection state; mirror the flag the panel uses to render that row.
- **Connection state never filters.** The active protocol's settings are listed even with no radio connected; other protocols' settings are never listed.
- When a row is not rendered (e.g. hidden until connected), the jump still opens the panel and, after the 600 ms retry, announces `settingsSearch.openedPanel`. No error, no console noise.

## Shared sections

Do **not** put literal anchors inside a component that more than one panel renders: the id would no longer map to one slot and Guard A would see it in the wrong file. Pass `anchorId` down from the owning panel instead.

## Guards

| Guard | Test                                                  | Checks                                                                                             |
| ----- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A / B | `src/renderer/lib/settingsSearchAnchors.test.ts`      | Every registry id is anchored in exactly one component file; every anchor has an entry; no repeats |
| C     | `src/renderer/lib/settingsSearchCoverage.test.ts`     | Swept files: each `t()` key indexed or exempt; exemptions reasoned, namespaced, not stale          |
| D     | `settings-anchor-id-format` in `sourcePolicyRules.ts` | Literal anchor ids start with a known slot prefix and use lower-camel segments                     |
| —     | `src/renderer/lib/settingsSearch.test.ts`             | Ranking, cap, per-protocol gating with real capabilities, id format, label keys exist in English   |

Guards A–C read component sources as text, so `vitest related` cannot reach them. `scripts/precommit-tests.mjs` (also used by PR CI) appends the three settings-search tests whenever a `src/renderer/components/**/*.tsx` file or the English locale changes.

## Exemption patterns

Exemptions are scoped: a surface's `exempt` map only covers the files that surface sweeps (plus the shared `common.*`), so a broad pattern for one panel cannot hide a gap in another. Keys are exact i18n keys or globs where `*` matches any run of characters. Every pattern starts with a literal namespace (`appPanel.*Hint`, never `*Hint`) and carries a non-empty reason (toast, hint, aria variant, dialog copy, option value). Prefer a pattern only when it describes a real category; use exact keys for one-offs.
