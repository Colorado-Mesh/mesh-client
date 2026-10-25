# CodeQL configuration

## Faster advanced workflow and activation

[`.github/workflows/codeql.yaml`](../workflows/codeql.yaml) replaces Swift autobuild with a
single host-architecture `swiftc` invocation of `native/ai/apple/main.swift`. It retains the six
languages currently scanned by default setup (Actions, C#, JavaScript/TypeScript, Python, Rust,
and Swift), the `security-extended` suite, the remote threat model, and the embedded model packs.
It does not load the legacy query-exclusion config below or skip tests/scripts from analysis.

**Default setup remains the authoritative scanner until activation.** With the repository Actions
variable `CODEQL_ADVANCED_ENABLED` unset, the new workflow runs on PRs and manual dispatches with
`upload: never`, retaining per-language SARIF artifacts for seven days. Pushes, merge groups and
weekly scans start uploading only after the variable is set to `true`. This allows the replacement
to be validated without the conflicting uploads GitHub rejects while default setup is enabled.

Activation after the PR is merged:

1. Check all six advanced analysis jobs and their SARIF artifacts on the PR. Compare extracted Swift
   files and the embedded JavaScript model-pack loading with the existing default-setup run.
2. In **Settings → Advanced Security → CodeQL analysis**, switch to advanced setup and disable
   default setup. Keep the committed workflow; do not generate a second workflow.
3. Set the repository **Actions variable** `CODEQL_ADVANCED_ENABLED` to the exact string `true`.
   Never enable this upload switch while default setup is configured.
4. Dispatch **CodeQL (advanced)** on `main`. Verify all six analyses upload and process successfully
   in **Security → Code scanning** before treating the migration as active. Its push, PR,
   `merge_group` and weekly triggers now maintain coverage. Required ruleset checks are unchanged.

Rollback: remove the variable first, then re-enable default setup with the same six languages,
extended query suite and remote threat model. Confirm its verification run succeeds. Enabling
default setup can disable an existing advanced workflow; re-enable **CodeQL (advanced)** in Actions
only if artifact-only PR/manual validation is still wanted. With the variable absent, those runs
cannot upload. A merged workflow alone does not activate the CodeQL speedup; changing the repository
settings is a separate operational step.

GitHub references:

- [Switching to advanced setup](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning)
- [Default setup blocks advanced uploads](https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/results-different-than-expected)
- [Manual Swift builds](https://docs.github.com/en/code-security/tutorials/customize-code-scanning/prepare-code-for-analysis)
- [Embedded model packs also work with advanced setup](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/edit-default-setup)

## Swift (`native/ai/apple`)

The production Apple OS-AI helper uses `swiftc` + `lipo` (`scripts/build-ai-helper.mjs`). Advanced
CodeQL compiles the same source once for the macOS runner with optimization disabled and a fresh
module-cache directory. Compilation occurs after CodeQL initialization, so extraction observes a
real build every run. Neither a cached executable nor a universal binary is needed for analysis.
SDK lookup and compiler failures fail the job.

The root `Package.swift` remains for default-setup discovery and rollback. Production packaging
continues using its existing two-architecture optimized build.

## Timing audit (2026-10-25)

These are observed baselines, not predictions for the replacement:

| Workflow/job                                                                                            | Observed time                                          | Finding / decision                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [CodeQL PR run](https://github.com/Colorado-Mesh/mesh-client/actions/runs/40205510217) / Swift          | 14m 21s job; 12m 44s autobuild                         | Main bottleneck; direct compiler build avoids SwiftPM discovery.                                                      |
| Same run / other languages                                                                              | Actions 44s; C# 87s; JS/TS 158s; Python 50s; Rust 149s | Retain every language and the extended suite.                                                                         |
| [CI Build](https://github.com/Colorado-Mesh/mesh-client/actions/runs/40206966613) / ESLint              | 4m 13s job; 3m 42s lint                                | Retain full type-aware lint; file-only caches can miss cross-file type changes.                                       |
| Same run / quality, typecheck, app build                                                                | 96s, 91s, 35s                                          | Already parallel; dependency setup costs about 20–25s per lane.                                                       |
| [Tests](https://github.com/Colorado-Mesh/mesh-client/actions/runs/40206966604) / renderer UI            | 4m 27s–5m 14s jobs; 3m 56s–4m 42s tests                | Increase three shards to four; retain full/related selection and merged coverage thresholds.                          |
| Same run / coverage merge                                                                               | 66s                                                    | Keep global threshold enforcement.                                                                                    |
| [Reticulum sidecar](https://github.com/Colorado-Mesh/mesh-client/actions/runs/40197636095) / full stack | 4m 31s–6m 44s                                          | Existing dependency caches; retain native host tests and optimized linking.                                           |
| [Daily E2E](https://github.com/Colorado-Mesh/mesh-client/actions/runs/40198406662)                      | Release preflight 24m 26s; three Electron jobs failed  | Preflight runs the comprehensive release gate. E2E failures need separate diagnosis; no checks removed to shorten it. |

Compare future hosted job/step timings on equivalent scopes. Additional sharding trades one runner
setup for less wall time; it is not a claim of reduced total runner minutes. The advanced PR run
will measure extraction/query execution, while upload processing remains unverified until activation.

## `js/insecure-temporary-file` (tests and scripts)

CodeQL flags `writeFile` / `writeFileSync` / similar to a **predictable** path under the OS temp directory (e.g. `path.join(os.tmpdir(), 'fake-sidecar')`). This commonly appears in Vitest fixtures and repeatedly fails PR Code Scanning.

**Fix (required):** create a unique directory first, then write inside it:

```ts
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-fixture-'));
const file = path.join(dir, 'stub');
fs.writeFileSync(file, '');
```

Do **not** rely on dismissals for new findings. Local/pre-commit guard: `pnpm run check:insecure-temp-files` (see AGENTS.md §3).

## `js/http-to-file-access` and `codeql-config.yml`

[`js/http-to-file-access`](https://codeql.github.com/codeql-query-help/javascript/js-http-to-file-access/) is a path-problem query whose sink is the **data argument** to `appendFile` / `writeFileSync` (a narrow source span), not the whole statement. GitHub’s `// codeql[query-id]` suppression logic matches alerts whose location is a **whole line** (`startcolumn`/`endcolumn` zero); it does **not** suppress these argument-level sinks, so inline comments do not clear the alert.

[`codeql-config.yml`](./codeql-config.yml) **excludes** `js/http-to-file-access` because our disk writes are sanitized log lines to a fixed path, not arbitrary remote-to-file backdoors.

**Important:** **Default setup does not read `codeql-config.yml`.** With default setup only, alerts may still appear until you **dismiss** them in the Security / PR UI (false positive, with justification pointing to CONTRIBUTING) **or** switch to **advanced** CodeQL and pass this config.

## Legacy `codeql-config.yml`

The retained config excludes `js/http-to-file-access`. The advanced workflow deliberately does not
load it: this migration preserves the existing default scanner's query coverage. Adopting query
exclusions would be a separate security-policy change.

## Embedded model pack (`extensions/`)

[Default setup](https://docs.github.com/en/code-security/code-scanning/managing-your-code-scanning-configuration/editing-your-configuration-of-default-setup#extending-codeql-coverage-with-codeql-model-packs-in-default-setup) loads **CodeQL model packs** from `.github/codeql/extensions/`.

This repo ships **`mesh-client-models`**: data extensions that mark `sanitizeForLogSink`, `sanitizeLogMessage`, `sanitizeForConsoleEcho`, and `sanitizeLogPayloadForDisk` as **barriers** where applicable. Main-process **terminal echo** uses `sanitizeForConsoleEcho`, which applies CodeQL’s built-in newline sanitizer pattern (empty replacement) before whitespace normalization (see [Log injection query help](https://codeql.github.com/codeql-query-help/javascript/js-log-injection/)).

**Log injection (`js/log-injection`):** `barrierModel` rows with kind **`log-injection`** attach to that query because the library defines `SanitizerFromModel` via `ModelOutput::barrierNode(_, "log-injection")` (see [`LogInjectionQuery.qll`](https://github.com/github/codeql/blob/main/javascript/ql/lib/semmle/javascript/security/dataflow/LogInjectionQuery.qll) on `github/codeql`).

**Network → file (`js/http-to-file-access`):** MaD barrier kinds must be valid **sink** kinds (for example **`file-content-store`** for file-body writes), not the query id. More importantly, [`HttpToFileAccessQuery.qll`](https://github.com/github/codeql/blob/main/javascript/ql/lib/semmle/javascript/security/dataflow/HttpToFileAccessQuery.qll) currently wires barriers only through the abstract `Sanitizer` class and does **not** include a `SanitizerFromModel` for any MaD kind; so **`barrierModel` cannot clear this query until upstream adds that hook** (or you rely on [`codeql-config.yml`](./codeql-config.yml) query filters under **advanced** setup). We still model `sanitizeLogPayloadForDisk` as a **`file-content-store`** barrier for correctness and forward compatibility.

Each pack directory includes **`qlpack.yml`** and a duplicate **`codeql-pack.yml`** so default setup resolves metadata reliably; `extensionTargets` must use a real semver range (not `*`), or GitHub may skip loading the pack.

Layout is enforced locally by `pnpm run check:codeql-extensions`. If alerts persist after changing imports or package name, adjust the first column of the `barrierModel` rows in [`extensions/mesh-client-models/models/log-sanitizer-barriers.yml`](./extensions/mesh-client-models/models/log-sanitizer-barriers.yml) to match how CodeQL labels the module (often `package.json` `name` or the relative `src/main/...` path).
