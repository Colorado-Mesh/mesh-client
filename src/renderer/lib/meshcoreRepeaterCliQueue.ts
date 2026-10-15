import {
  isMeshcoreCliSecretCommand,
  MESHCORE_CLI_REDACTED,
  redactMeshcoreCliSecretCommand,
  redactMeshcoreCliSecretsInText,
} from '@/shared/meshcoreCliSecrets';

/** Serializes complete CLI exchanges, including the reply, without coalescing distinct commands. */
export function createMeshcoreRepeaterCliQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const queued = (tails.get(key) ?? Promise.resolve()).then(operation);
    const tail = queued.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return queued;
  };
}

export function redactMeshcoreCliSecrets(command: string, response?: string): string {
  const trimmed = command.trim();
  if (isMeshcoreCliSecretCommand(trimmed)) {
    return response !== undefined ? MESHCORE_CLI_REDACTED : redactMeshcoreCliSecretCommand(trimmed);
  }
  return response !== undefined ? redactMeshcoreCliSecretsInText(response) : command;
}

/** Keep the argument delimiter when clearing a firmware string preference. */
export function normalizeMeshcoreCliCommand(command: string): string {
  return /^set\s+(?:name|guest\.password|owner\.info) /i.test(command.trimStart())
    ? command.trimStart()
    : command.trim();
}
