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
 * Secret commands anywhere in free text (the bare `password` admin command is excluded: the word
 * is too common in ordinary log text), and `wifi.pwd: value` / `wifi.pwd = value` in replies.
 * Everything after the key is dropped: to the end of the line for log text, and to the end of the
 * enclosing string value for JSON so the document stays valid.
 */
const LINE_PATTERNS: readonly [RegExp, RegExp] = [
  /\b((?:get|set)\s+(?:guest\.password|prv\.key|wifi\.pwd)|set\s+pin)\b(?!\s*\[redacted\]).*$/gim,
  /\b(wifi\.pwd)\s*[:=]\s*(?!\[redacted\])(?=\S).*$/gim,
];
const JSON_STRING_PATTERNS: readonly [RegExp, RegExp] = [
  /\b((?:get|set)\s+(?:guest\.password|prv\.key|wifi\.pwd)|set\s+pin)\b(?!\s*\[redacted\])(?:[^"\\\r\n]|\\.)*/gi,
  /\b(wifi\.pwd)\s*[:=]\s*(?!\[redacted\])(?=\S)(?:[^"\\\r\n]|\\.)*/gi,
];

function redactWith(text: string, [command, wifiValue]: readonly [RegExp, RegExp]): string {
  return text
    .replace(command, `$1 ${MESHCORE_CLI_REDACTED}`)
    .replace(wifiValue, `$1: ${MESHCORE_CLI_REDACTED}`);
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
  return redactWith(text, LINE_PATTERNS);
}

/** Same scrub inside the string values of a JSON document (debug snapshot). */
export function redactMeshcoreCliSecretsInJsonText(json: string): string {
  return redactWith(json, JSON_STRING_PATTERNS);
}
