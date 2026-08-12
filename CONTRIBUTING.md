# Contributing to Mesh Client

Thank you for your interest in contributing.

| Topic                                                         | Document                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| Clone, prerequisites, commands, test harness, git hooks, i18n | [docs/development-environment.md](docs/development-environment.md) |
| Code style, testing, architecture, security (AI assistants)   | [AGENTS.md](AGENTS.md)                                             |
| Protocol additions (RF mesh only)                             | [Protocol scope](#protocol-scope)                                  |
| PR flow and contribution expectations                         | **This file**                                                      |

## Code style & standards

- **Prettier:** Semi always, single quotes, trailing commas, print width 100, tab 2, LF.
- **TypeScript:** Strict; avoid `any`; prefer `unknown` + guards; export types; prefer interfaces over type aliases.
- **React:** Function components only; `exhaustive-deps` is errors; `?.` in JSX; **every interactive control needs `aria-label`**.
- **Colors:** Use Tailwind CSS utility classes (e.g., `text-green-400`, `bg-slate-700`). Custom theme colors via CSS custom properties from `styles.css` (`--color-brand-green`, `--color-deep-black`, etc.). Avoid inline hex colors in JSX. End users can also customize theme tokens (including message action colors) under **App → Appearance → Colors**.
- **Zustand:** Module-level defaults for stable refs; prefer `useStore(s => s.field)` over broad subscriptions; avoid subscribing to whole Maps when one id suffices; `persist` for localStorage, IPC from an effect for SQLite; extract time constants to `src/renderer/lib/timeConstants.ts` (e.g. `MS_PER_SECOND`).
- **Performance:** No hot-path O(n); lazy cleanup when collections grow large.

## Testing protocols

See [Test harness setup and local quality checks](docs/development-environment.md#4-test-harness-setup-and-local-quality-checks) for Vitest projects, pre-PR commands, and browser dev stub behavior.

- Renderer: jsdom (`src/renderer/**/*.test.{ts,tsx}`). Main (node project): `src/main/**/*.test.ts`, plus `src/shared/**`, `src/preload/**`, `src/architecture/**`, `scripts/**/*.test.mjs`, and `vitest.harness.test.ts` (see `vitest.config.mts`).
- **Reticulum sidecar (Rust):** when editing `reticulum-sidecar/**`, run `pnpm run reticulum:sidecar:clippy:full` before PR; CI enforces line coverage in `tests.yaml` when sidecar paths change (see [docs/development-environment.md](docs/development-environment.md#lint-and-coverage-sidecar)).
- Mock console before spying logged errors (e.g. `vi.spyOn(console, 'warn').mockImplementation(() => {})`; use `beforeEach` when shared).
- Update `src/main/index.contract.test.ts` when CSP, build config, IPC limits, or log filters change.
- Accessibility: vitest-axe in component tests; see **Accessibility / axe** in [AGENTS.md](AGENTS.md#5-testing).

## Protocol scope

Mesh-Client focuses on **RF mesh** networking (LoRa and related radio meshes). Additional protocols are in scope when they support that kind of RF mesh path. Internet-only messaging is out of scope. Ham protocols are welcome under the same RF-mesh criteria; Mesh-Client is for everyone, everywhere, and is not gated or targeted specifically at people with a ham radio license. Protocols that already ship may still use internet transports _alongside_ RF. Product framing: [README — Why](README.md#why).

## PR process

1. Describe your changes and what you tested
2. Update docs if needed
3. Run the checks you need before review — at minimum the [local quality checks](docs/development-environment.md#4-test-harness-setup-and-local-quality-checks) and what the [pre-commit hook](docs/development-environment.md#6-git-hooks-and-pre-commit-behavior) runs
4. Keep PR scope tight
5. A maintainer will review

## AI-assisted contributions

Follow [AGENTS.md](AGENTS.md) for mesh-specific and security expectations, and this file for code style and testing conventions. Review every line of AI-generated code before merging. Do not accept AI-generated IPC or preload changes without understanding them (Electron IPC is a common weak spot). You may note briefly in the PR if you used an AI tool.

Avoid duplicating always-on Cursor or editor rules with this repo's docs; merge overlaps and prefer **requestable** rules over always-on where possible to reduce fixed context size.

---

By contributing, you agree to license under the [MIT License](LICENSE).
