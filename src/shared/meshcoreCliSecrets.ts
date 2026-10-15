/**
 * MeshCore CLI commands whose argument or reply is a secret, shared by the renderer CLI history
 * and logging paths and the support-bundle scrubber so the two cannot drift apart.
 *
 * Covered: server admin `password`, `guest.password`, `prv.key`, companion `wifi.pwd` and BLE
 * `set pin`. Commands may carry the two-character `xx|` CLI token prefix.
 */

export const MESHCORE_CLI_REDACTED = '[redacted]';

const TOKEN_PREFIX_RE = /^[0-9A-Za-z]{2}\|/;

const SECRET_COMMAND_RE =
  /^(password|(?:get|set)\s+(?:guest\.password|prv\.key|wifi\.pwd)|set\s+pin)\b/i;

/*
 * Secret commands and replies in free text / JSON string values.
 * - Named secret commands (`set wifi.pwd`, `set pin`, …) anywhere.
 * - Bounded bare `password <arg>` (admin set), excluding common English (`password for` / `is`).
 * - `password now: value` replies.
 * - `wifi.pwd: value` / `wifi.pwd = value` echoed in replies.
 * - JSON object fields whose key is the quoted string `"wifi.pwd"`.
 * Everything after the secret is dropped: to the end of the line for log text, and to the end of
 * the enclosing string value for JSON so the document stays valid.
 */
type RedactPattern = readonly [RegExp, string];

const LINE_PATTERNS: readonly RedactPattern[] = [
  [
    /\b((?:get|set)\s+(?:guest\.password|prv\.key|wifi\.pwd)|set\s+pin)\b(?!\s*\[redacted\]).*$/gim,
    `$1 ${MESHCORE_CLI_REDACTED}`,
  ],
  [/\b(password\s+now)\s*:\s*(?!\[redacted\]).*$/gim, `$1: ${MESHCORE_CLI_REDACTED}`],
  [/\b(wifi\.pwd)\s*[:=]\s*(?!\[redacted\])(?=\S).*$/gim, `$1: ${MESHCORE_CLI_REDACTED}`],
];

const JSON_STRING_PATTERNS: readonly RedactPattern[] = [
  [
    /\b((?:get|set)\s+(?:guest\.password|prv\.key|wifi\.pwd)|set\s+pin)\b(?!\s*\[redacted\])(?:[^"\\\r\n]|\\.)*/gi,
    `$1 ${MESHCORE_CLI_REDACTED}`,
  ],
  [
    /\b(password\s+now)\s*:\s*(?!\[redacted\])(?:[^"\\\r\n]|\\.)*/gi,
    `$1: ${MESHCORE_CLI_REDACTED}`,
  ],
  [
    /\b(wifi\.pwd)\s*[:=]\s*(?!\[redacted\])(?=\S)(?:[^"\\\r\n]|\\.)*/gi,
    `$1: ${MESHCORE_CLI_REDACTED}`,
  ],
];

const PASSWORD_ORDINARY_FIRST = new Set(['for', 'is', 'to', 'was', 'of', 'now']);

/** Head of a bare admin `password` / `xx|password` command (no trailing arg — scanned below). */
const BARE_PASSWORD_HEAD_RE = /\b(?:[0-9A-Za-z][0-9A-Za-z]\|)?password\s+/gi;

/** `"wifi.pwd": "secret"` object fields (key quoted); value may use JSON escapes. */
const JSON_WIFI_PWD_FIELD_RE = /("wifi\.pwd"\s*:\s*)"(?:\\.|[^"\\])*"/gi;

/**
 * Redact bounded bare `password <arg>` commands. Arg scan is index-based so eslint's
 * `detect-unsafe-regex` stays quiet (no nested quantifiers).
 */
function redactBarePasswordCommands(text: string, stopAtJsonStringEnd: boolean): string {
  BARE_PASSWORD_HEAD_RE.lastIndex = 0;
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = BARE_PASSWORD_HEAD_RE.exec(text)) !== null) {
    const head = match[0];
    const argStart = match.index + head.length;
    let i = argStart;
    while (i < text.length) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') break;
      if (stopAtJsonStringEnd && (c === '"' || c === '\\')) break;
      i += 1;
    }
    const firstToken = text.slice(argStart, i);
    if (!firstToken || firstToken.startsWith(MESHCORE_CLI_REDACTED)) continue;
    const word = firstToken.toLowerCase().replace(/:$/, '');
    if (PASSWORD_ORDINARY_FIRST.has(word)) continue;

    let end = i;
    if (stopAtJsonStringEnd) {
      while (end < text.length) {
        const c = text[end];
        if (c === '"') break;
        if (c === '\\' && end + 1 < text.length) {
          end += 2;
          continue;
        }
        if (c === '\r' || c === '\n') break;
        end += 1;
      }
    } else {
      while (end < text.length && text[end] !== '\r' && text[end] !== '\n') end += 1;
    }

    out += text.slice(last, match.index) + head.replace(/\s+$/, ' ') + MESHCORE_CLI_REDACTED;
    last = end;
    BARE_PASSWORD_HEAD_RE.lastIndex = end;
  }
  return out + text.slice(last);
}

function redactWith(text: string, patterns: readonly RedactPattern[]): string {
  let out = text;
  for (const [re, replacement] of patterns) {
    out = out.replace(re, replacement);
  }
  return out;
}

function stripTokenPrefix(command: string): string {
  return command.trim().replace(TOKEN_PREFIX_RE, '');
}

/** Command head that names the secret (e.g. `set wifi.pwd`), or null for an ordinary command. */
export function meshcoreCliSecretCommandHead(command: string): string | null {
  const m = SECRET_COMMAND_RE.exec(stripTokenPrefix(command));
  return m?.[1] ?? null;
}

export function isMeshcoreCliSecretCommand(command: string): boolean {
  return meshcoreCliSecretCommandHead(command) !== null;
}

/** `set wifi.pwd hunter2` becomes `set wifi.pwd [redacted]`; other commands are unchanged. */
export function redactMeshcoreCliSecretCommand(command: string): string {
  const head = meshcoreCliSecretCommandHead(command);
  return head === null ? command : `${head} ${MESHCORE_CLI_REDACTED}`;
}

/** Scrub secret CLI commands and `wifi.pwd` values from free text (log files). */
export function redactMeshcoreCliSecretsInText(text: string): string {
  return redactBarePasswordCommands(redactWith(text, LINE_PATTERNS), false);
}

/** Same scrub inside the string values of a JSON document (debug snapshot), plus keyed wifi.pwd fields. */
export function redactMeshcoreCliSecretsInJsonText(json: string): string {
  return redactBarePasswordCommands(redactWith(json, JSON_STRING_PATTERNS), true).replace(
    JSON_WIFI_PWD_FIELD_RE,
    `$1"${MESHCORE_CLI_REDACTED}"`,
  );
}
