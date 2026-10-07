/**
 * Declarative source-policy rules for the Vitest registry walker.
 * Prefer this over a new `scripts/check-*.mjs` for file-local / small-glob invariants.
 * Suppress with `// source-policy-ok <rule-id> <reason>` on the violating line (forbid)
 * or anywhere in the file (require).
 *
 * Cross-file “every lazy export must mount in App.tsx” is not expressible as a
 * per-file regex; that invariant lives in `lazyPanelsMounted.test.ts`.
 */
export interface SourcePolicyRule {
  id: string;
  /** Paths relative to repo root (glob or exact). */
  include: string[];
  exclude?: string[];
  /** When set, forbid/require apply only if this matches the file contents. */
  when?: RegExp;
  /** Fail if this matches (unless suppressed on that line). */
  forbid?: RegExp;
  /** Fail if this does not match when the file is included (and `when` passes). */
  require?: RegExp;
  message: string;
}

export const SOURCE_POLICY_RULES: SourcePolicyRule[] = [
  {
    id: 'runtime-tests-use-loadRuntimeSource',
    include: ['src/renderer/runtime/**/*.test.ts', 'src/renderer/runtime/**/*.contract.test.ts'],
    forbid: /readFileSync\s*\(\s*join\([^)]*use(?:Meshtastic|Meshcore|Reticulum)Runtime\.ts/,
    message: 'Use loadRuntimeSource() from sourceContractTestHelpers',
  },
  {
    id: 'chat-export-incremental-cap',
    include: ['src/main/chatExportFormat.ts'],
    forbid: /formatChatExportLinesWithTotalCap[\s\S]*?formatChatExportLines\s*\(/,
    require: /byteLength \+ nextBytes/,
    message: 'Total export cap must be enforced per line before append',
  },
  {
    id: 'axe-tests-hydrate-theme-colors',
    include: ['src/renderer/**/*.test.tsx'],
    when: /\baxe\s*\(/,
    require: /hydrateAxeThemeColors/,
    message: 'Call hydrateAxeThemeColors() before axe() so contrast checks use real theme tokens',
  },
  {
    id: 'meshtastic-protocol-rxtime-via-helper',
    include: ['src/renderer/lib/protocols/MeshtasticProtocol.ts'],
    require: /meshtasticPacketRxTimeMs/,
    forbid: /rxTime\s*\*\s*1000/,
    message:
      'SDK PacketMetadata.rxTime is Date (ms); use meshtasticPacketRxTimeMs — never rxTime * 1000',
  },
  {
    id: 'pnpm-lockfile-single-document',
    include: ['pnpm-lock.yaml'],
    forbid: /^\s*packageManagerDependencies:/m,
    message:
      'pnpm-lock.yaml must be a single YAML document; the env document hides every dependency from GitHub Dependabot (pnpm/pnpm#13805)',
  },
  {
    id: 'pnpm-workspace-pm-on-fail-ignore',
    include: ['pnpm-workspace.yaml'],
    require: /^pmOnFail:\s*ignore\s*$/m,
    message:
      'Keep pmOnFail: ignore so pnpm does not write the env lockfile document Dependabot cannot parse',
  },
  {
    id: 'emcomm-mecp-compose-default-off',
    include: ['src/renderer/lib/defaultAppSettings.ts'],
    require: /mecpComposeEnabled:\s*false/,
    message: 'mecpComposeEnabled must default false (EMCOMM safety S14)',
  },
  {
    id: 'renderer-font-size-in-rem',
    include: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    exclude: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
    forbid: /(?<![\w-])text-\[[\d.]+px\]/,
    message:
      'Use a rem text token (text-2xs, text-label, text-meta, text-control, text-body, text-title) so App > Appearance > Text size scales it; px font sizes do not scale',
  },
  {
    id: 'renderer-no-low-contrast-gray-text',
    include: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    exclude: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
    forbid: /(?<![\w-])text-(?:ink|zinc|gray|slate)-500(?![\w/-])/,
    message:
      'ink-500 text is under 4.5:1 on the dark surfaces; use text-muted (themeable, passes 4.5:1)',
  },
  {
    id: 'renderer-ink-neutrals',
    include: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    exclude: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
    forbid:
      /\b(?:bg|text|border|border-[trblxyse]|ring|ring-offset|divide|outline|fill|stroke|placeholder|accent|decoration|shadow|from|via|to|caret)-(?:zinc|gray|slate)-\d{2,3}\b/,
    message:
      'Style guide: neutrals use the ink scale (ink-50 to ink-950, from the Midnight Serenity palette) or the theme tokens (app-bg, deep-black, secondary-dark, muted), one neutral family across the app',
  },
  {
    id: 'renderer-elevation-levels',
    include: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    exclude: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
    forbid: /(?<![\w-])shadow-(?:xs|sm|md|lg|xl|2xl)(?![\w-])/,
    message:
      "Style guide: elevation uses shadow-level-1 to shadow-level-4 (styles.css); Tailwind's stock shadows are tuned for light surfaces and vanish on the dark UI",
  },
  {
    id: 'renderer-no-muted-text-on-control-fill',
    include: ['src/renderer/**/*.tsx'],
    exclude: ['src/renderer/**/*.test.tsx'],
    // Resting classes only: hover:/disabled: variants are preceded by a colon and do not match.
    forbid:
      /(?<![\w:-])bg-secondary-dark(?![\w/-])[^'"`\n]*(?<![\w:-])text-(?:muted|ink-400|ink-500)(?![\w/-])|(?<![\w:-])text-(?:muted|ink-400|ink-500)(?![\w/-])[^'"`\n]*(?<![\w:-])bg-secondary-dark(?![\w/-])/,
    message:
      'Muted text on bg-secondary-dark (the control fill) is under 4.5:1 in every theme; use text-ink-300 on the fill, or put muted text on a panel surface (bg-deep-black)',
  },
  {
    id: 'renderer-bundled-font-weights',
    include: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    exclude: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
    forbid: /(?<![\w-])font-(?:bold|extrabold|black)(?![\w-])/,
    message:
      'Only IBM Plex 400, 500 and 600 are bundled (offline), so bold is synthesized and smears; use font-semibold',
  },
  {
    id: 'renderer-no-uppercase-micro-labels',
    include: ['src/renderer/**/*.tsx'],
    exclude: ['src/renderer/**/*.test.tsx'],
    forbid: /uppercase[^'"`\n]*tracking-wide|tracking-wide[^'"`\n]*uppercase/,
    message: 'Style guide: sentence case labels, no uppercase letter-spaced micro labels',
  },
  {
    id: 'renderer-icons-not-glyphs',
    include: ['src/renderer/**/*.tsx'],
    exclude: ['src/renderer/**/*.test.tsx'],
    forbid: /^\s*(?:⚠|✕|✓|✗|★|☆|📍|↻|⌂|⌀|ℹ)\s*$/mu,
    message:
      'Use a lucide-react-motion icon (TriangleAlert, X, Check, Star, MapPin, ...) instead of a text glyph; glyphs render differently per OS',
  },
  {
    id: 'settings-anchor-id-format',
    include: ['src/renderer/components/**/*.tsx'],
    exclude: ['src/renderer/components/**/*.test.tsx'],
    when: /(?:data-setting-anchor|anchorId)\s*=\s*["']/,
    // Two or three lower-camel segments, spelled out as alternatives to avoid nested quantifiers.
    forbid:
      /(?:data-setting-anchor|anchorId)\s*=\s*(["'])(?!(?:connection|chat|games|rrc|nomadNetwork|remote|nodes|map|radio|modules|admin|rooms|telemetry|security|tak|incident|app|diagnostics|stats|sniffer|rf|graph|topology)\.(?:[a-z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*)\1)/,
    message:
      'Setting anchor ids are <slotCamel>.<subsectionCamel>.<settingCamel> and live in the owning panel (see docs/development/settings-search.md)',
  },
];
