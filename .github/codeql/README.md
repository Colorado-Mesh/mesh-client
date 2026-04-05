# CodeQL configuration

## Why there is no `codeql.yml` workflow

This repository uses **CodeQL default setup** (enabled under **Settings → Code security and analysis → Code scanning**). When default setup is on, GitHub **rejects SARIF uploads** from the CodeQL action to avoid duplicate/conflicting alerts. See:

- [Upload was rejected because CodeQL default setup is enabled](https://docs.github.com/en/code-security/code-scanning/troubleshooting-sarif-uploads/default-setup-enabled)

So the previous workflow that ran `github/codeql-action` with a custom `config-file` failed in CI with:

> CodeQL analyses from advanced configurations cannot be processed when the default setup is enabled

Default setup already runs JavaScript/TypeScript analysis on push/PR; no separate workflow is required for scanning to occur.

## `js/http-to-file-access` and `codeql-config.yml`

[`js/http-to-file-access`](https://codeql.github.com/codeql-query-help/javascript/js-http-to-file-access/) is a path-problem query whose sink is the **data argument** to `appendFile` / `writeFileSync` (a narrow source span), not the whole statement. GitHub’s `// codeql[query-id]` suppression logic matches alerts whose location is a **whole line** (`startcolumn`/`endcolumn` zero); it does **not** suppress these argument-level sinks, so inline comments do not clear the alert.

[`codeql-config.yml`](./codeql-config.yml) **excludes** `js/http-to-file-access` because our disk writes are sanitized log lines to a fixed path, not arbitrary remote-to-file backdoors.

**Important:** **Default setup does not read `codeql-config.yml`.** With default setup only, alerts may still appear until you **dismiss** them in the Security / PR UI (false positive, with justification pointing to CONTRIBUTING) **or** switch to **advanced** CodeQL and pass this config.

## Using advanced setup with `codeql-config.yml`

1. In **Settings → Code security and analysis → Code scanning**, disable CodeQL default setup (so SARIF from Actions is accepted).
2. Add a workflow that runs `github/codeql-action/init@v4` with `config-file: ./.github/codeql/codeql-config.yml` and `analyze` as documented.

Do not run both default setup and a CodeQL workflow that uploads SARIF for the same scope—GitHub will reject the upload.
