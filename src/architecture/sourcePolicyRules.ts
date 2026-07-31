/**
 * Declarative source-policy rules for the Vitest registry walker.
 * Prefer this over a new `scripts/check-*.mjs` for file-local / small-glob invariants.
 * Suppress with `// source-policy-ok <rule-id> <reason>` on the violating line (forbid)
 * or anywhere in the file (require).
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
];
