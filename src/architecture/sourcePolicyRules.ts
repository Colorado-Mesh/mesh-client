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
    forbid: /(?<![\w-])text-(?:gray|slate)-500(?![\w/-])/,
    message:
      'gray-500 / slate-500 text is under 4.5:1 on the dark surfaces; use text-muted (themeable, passes 4.5:1)',
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
];
